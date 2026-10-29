import "server-only";
import { z } from "zod";
import { asAdmin, type Tx } from "@/lib/db";
import { randomToken, sha256Hex } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import type { AdminPrincipal, ReqCtx } from "../context";
import { assertCanWrite } from "../auth/admin";
import { auditLog } from "../auth/log";
import { storage } from "../storage";
import { buildModelTermPdf, pdfPageCount } from "../pdf";
import { optText, parse } from "./common";

export const MAX_TERM_BYTES = 3.5 * 1024 * 1024;

export type TermRow = { id: string; title: string; version_label: string; declaration: string; sha256: string; size_bytes: number; page_count: number | null;
  is_model: boolean; legal_approved_at: Date | null; legal_approver: string | null; legal_note: string | null; active: boolean; created_at: Date; versions: number; signatures: number };

export async function listTerms(admin: AdminPrincipal) {
  return asAdmin(admin, (tx) => tx<TermRow[]>`
    select t.*, a.name as legal_approver,
      (select count(*)::int from training_versions tv where tv.term_id = t.id) as versions,
      (select count(*)::int from signatures s where s.term_id = t.id) as signatures
    from terms t left join admins a on a.id = t.legal_approved_by order by t.created_at desc`);
}

const termSchema = z.object({
  title: z.string().trim().min(3, "Informe o título do termo.").max(200),
  versionLabel: z.string().trim().min(1, "Informe a versão (ex.: 1.0).").max(40),
  declaration: z.string().trim().min(20, "Escreva a declaração que o motorista vai aceitar (mínimo 20 caracteres).").max(4000),
});
export type TermInput = z.input<typeof termSchema>;

async function insertTerm(tx: Tx, admin: AdminPrincipal, d: z.output<typeof termSchema>, file: Buffer, isModel: boolean, ctx: ReqCtx) {
  const [dup] = await tx`select 1 from terms where title = ${d.title} and version_label = ${d.versionLabel}`;
  if (dup) throw new AppError("duplicate", "Já existe um termo com este título e versão. Use outro número de versão.");
  const pages = await pdfPageCount(file).catch(() => { throw new AppError("invalid_pdf", "O arquivo não é um PDF válido (ou está protegido por senha)."); });
  const sha = sha256Hex(file);
  const key = `termos/${new Date().toISOString().slice(0, 10)}-${randomToken(9)}.pdf`;
  await storage.put(key, file, "application/pdf");
  const [t] = await tx<{ id: string }[]>`
    insert into terms (title, version_label, declaration, storage_key, sha256, size_bytes, page_count, is_model, created_by)
    values (${d.title}, ${d.versionLabel}, ${d.declaration}, ${key}, ${sha}, ${file.length}, ${pages}, ${isModel}, ${admin.id}) returning id`;
  await auditLog(tx, admin.id, isModel ? "term.model" : "term.upload", "term", t.id, { title: d.title, version: d.versionLabel, sha256: sha, pages }, ctx.ip);
  return t.id;
}

/** Envio de um novo termo em PDF. O conteúdo fica fixo; mudanças exigem nova versão. */
export async function uploadTerm(admin: AdminPrincipal, input: TermInput, file: Buffer | null, ctx: ReqCtx) {
  assertCanWrite(admin);
  const d = parse(termSchema, input);
  if (!file || !file.length) throw new AppError("no_file", "Selecione o arquivo PDF do termo.");
  if (file.length > MAX_TERM_BYTES) throw new AppError("too_big", "O PDF deve ter no máximo 3,5 MB.");
  return asAdmin(admin, (tx) => insertTerm(tx, admin, d, file, false, ctx));
}

const MODEL_DECLARATION = "Declaro que assisti integralmente aos vídeos obrigatórios do treinamento, fui aprovado na avaliação e compreendi as orientações sobre prova de entrega (POD), identificação do recebedor, qualidade das fotos, documentos e informações da entrega, PNR, acareação e evidências inválidas. Comprometo-me a aplicar essas orientações nas minhas entregas.";

/** Gera um termo-modelo em PDF para revisão jurídica (não substitui o termo oficial). */
export async function createModelTerm(admin: AdminPrincipal, trainingTitle: string, ctx: ReqCtx) {
  assertCanWrite(admin);
  const d = { title: "Termo de ciência e compromisso — treinamento POD e PNR", versionLabel: `modelo-${new Date().toISOString().slice(0, 10)}-${randomToken(2)}`, declaration: MODEL_DECLARATION };
  const pdf = await buildModelTermPdf({
    title: d.title, versionLabel: d.versionLabel, trainingTitle, declaration: d.declaration,
    body: [
      "Este termo registra a participação do motorista parceiro no treinamento indicado acima, realizado na plataforma BLINK Academy.",
      "O treinamento é composto por vídeos obrigatórios e por uma avaliação. A plataforma registra o tempo efetivamente assistido de cada vídeo, as tentativas da avaliação, a nota obtida e esta assinatura.",
      "Os conteúdos do treinamento seguem o material \"Na rota do treinamento Shopee POD e PNR\". Em caso de dúvida sobre qualquer orientação, o motorista deve procurar a administração da BLINK antes de realizar as entregas.",
      "Os dados pessoais coletados (nome, CPF, contato, registros de acesso e de assinatura) são usados apenas para controle do treinamento e comprovação da sua realização, conforme o aviso de privacidade da plataforma.",
    ],
  });
  return asAdmin(admin, (tx) => insertTerm(tx, admin, d, pdf, true, ctx));
}

export async function setTermActive(admin: AdminPrincipal, id: string, active: boolean, ctx: ReqCtx) {
  assertCanWrite(admin);
  await asAdmin(admin, async (tx) => {
    await tx`update terms set active = ${active} where id = ${id}`;
    await auditLog(tx, admin.id, active ? "term.activate" : "term.deactivate", "term", id, {}, ctx.ip);
  });
}

/** Registro (feito pelo administrador) de que a área jurídica revisou e aprovou o termo. */
export async function setLegalApproval(admin: AdminPrincipal, id: string, approved: boolean, note: string | null, ctx: ReqCtx) {
  assertCanWrite(admin);
  const n = parse(optText(500), note ?? "");
  await asAdmin(admin, async (tx) => {
    await tx`update terms set legal_approved_at = ${approved ? new Date() : null}, legal_approved_by = ${approved ? admin.id : null}, legal_note = ${n} where id = ${id}`;
    await auditLog(tx, admin.id, approved ? "term.legal_approved" : "term.legal_revoked", "term", id, { note: n }, ctx.ip);
  });
}

export async function setVersionTerm(admin: AdminPrincipal, versionId: string, termId: string | null, ctx: ReqCtx) {
  assertCanWrite(admin);
  await asAdmin(admin, async (tx) => {
    const [v] = await tx<{ status: string }[]>`select status from training_versions where id = ${versionId}`;
    if (!v) throw new AppError("not_found", "Versão não encontrada.", 404);
    if (v.status !== "draft") throw new AppError("frozen", "Versões publicadas não podem ser alteradas. Crie uma nova versão.");
    await tx`update training_versions set term_id = ${termId} where id = ${versionId}`;
    await auditLog(tx, admin.id, "version.term", "training_version", versionId, { term_id: termId }, ctx.ip);
  });
}

export async function termProblems(tx: Tx, termId: string | null): Promise<string[]> {
  if (!termId) return ["vincule um termo para assinatura"];
  const [t] = await tx<{ active: boolean }[]>`select active from terms where id = ${termId}`;
  if (!t) return ["termo não encontrado"];
  if (!t.active) return ["o termo vinculado está inativo"];
  return [];
}

export async function adminTermUrl(admin: AdminPrincipal, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError("not_found", "Termo não encontrado.", 404);
  const [t] = await asAdmin(admin, (tx) => tx<{ storage_key: string; title: string; version_label: string }[]>`select storage_key, title, version_label from terms where id = ${id}`);
  if (!t) throw new AppError("not_found", "Termo não encontrado.", 404);
  return storage.readUrl(t.storage_key, 300, `termo-${t.version_label}.pdf`);
}
