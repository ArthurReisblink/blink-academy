import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { asAdmin, asDriver, closeDb } from "@/lib/db";
import { canonicalJson, sha256Hex } from "@/lib/crypto";
import { createDriver } from "@/server/services/drivers";
import { createDraftVersion, publishVersion, versionProblems } from "@/server/services/trainings";
import { startAttempt, saveAnswer, submitAttempt } from "@/server/services/exams";
import { requestDriverLogin, verifyDriverLogin, getDriverByToken } from "@/server/auth/driver";
import { createModelTerm, setVersionTerm, uploadTerm } from "@/server/services/terms";
import { initials, listSignatures, requestSignatureCode, revokeCertificate, signTerm, signatureEvidence, signingState, verifyDocument } from "@/server/services/signatures";
import { storage } from "@/server/storage";
import type { AdminPrincipal, DriverPrincipal } from "@/server/context";
import { adminPrincipal, ctx, lastCodeFor, publishedTraining, raw, resetData, uniqueCpf } from "../helpers";

afterAll(async () => { await closeDb(); await raw.end(); });

let admin: AdminPrincipal;
let trainingId: string;
beforeEach(async () => {
  await resetData();
  admin = await adminPrincipal();
  trainingId = (await publishedTraining(admin)).trainingId;
});

let seq = 4000;
/** Motorista convocado e com sessão real (o código da assinatura fica ligado à sessão). */
async function loggedDriver(): Promise<{ drv: DriverPrincipal; convId: string; cpf: string; phone: string; name: string }> {
  const cpf = uniqueCpf();
  const phone = `+55279777${String(++seq).padStart(5, "0")}`;
  const name = "Joana Assinatura da Silva";
  const r = await createDriver(admin, { fullName: name, cpf, phone: phone.slice(3) }, { trainingId, deadline: { mode: "duration", hours: 72, startMode: "activation" } }, ctx());
  const ch = await requestDriverLogin(cpf, ctx());
  const s = await verifyDriverLogin(ch.challengeId, await lastCodeFor(phone), ctx());
  const drv = (await getDriverByToken(s.token))!;
  return { drv, convId: r.convocationId!, cpf, phone, name };
}

async function completeVideos(convId: string) {
  await raw`insert into academy.video_progress (convocation_id, video_id, covered_seconds, duration_seconds, completion_pct, completed_at)
    select ${convId}, vv.video_id, 100, 100, 95, now() from academy.convocations c join academy.version_videos vv on vv.version_id = c.training_version_id where c.id = ${convId}`;
}

async function pass(drv: DriverPrincipal, convId: string) {
  const id = await startAttempt(drv, convId);
  const [a] = await raw<{ questions: { id: string }[]; answer_key: Record<string, { correct: string }> }[]>`select questions, answer_key from academy.exam_attempts where id = ${id}`;
  for (const q of a.questions) await saveAnswer(drv, id, q.id, a.answer_key[q.id].correct);
  await submitAttempt(drv, id);
}

async function ready() {
  const d = await loggedDriver();
  await completeVideos(d.convId);
  await pass(d.drv, d.convId);
  return d;
}

async function sign(d: Awaited<ReturnType<typeof loggedDriver>>, extra: Partial<{ drawing: string }> = {}) {
  const r = await requestSignatureCode(d.drv, d.convId, ctx());
  return signTerm(d.drv, d.convId, { challengeId: r.challengeId, code: await lastCodeFor(d.phone), accepted: true, ...extra }, ctx({ userAgent: "Mozilla/5.0 (Android) teste" }));
}

const PNG_1x1 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

describe("Etapa 5 — termos", () => {
  it("termo em PDF: valida o arquivo, guarda o SHA-256 e não permite alterar o conteúdo", async () => {
    await expect(uploadTerm(admin, { title: "Termo X", versionLabel: "1.0", declaration: "Declaro que li e compreendi o termo." }, Buffer.from("não é pdf"), ctx())).rejects.toThrow(/PDF válido/);
    const doc = await PDFDocument.create(); doc.addPage(); const pdf = Buffer.from(await doc.save());
    const id = await uploadTerm(admin, { title: "Termo X", versionLabel: "1.0", declaration: "Declaro que li e compreendi o termo." }, pdf, ctx());
    const [t] = await raw<{ sha256: string; page_count: number; storage_key: string }[]>`select sha256, page_count, storage_key from academy.terms where id = ${id}`;
    expect(t.sha256).toBe(sha256Hex(pdf));
    expect(t.page_count).toBe(1);
    expect(sha256Hex(await storage.get(t.storage_key))).toBe(t.sha256);
    await expect(raw`update academy.terms set declaration = 'outra coisa qualquer aqui' where id = ${id}`).rejects.toThrow(/não pode ser alterado/);
    await expect(uploadTerm(admin, { title: "Termo X", versionLabel: "1.0", declaration: "Declaro que li e compreendi o termo." }, pdf, ctx())).rejects.toThrow(/outro número de versão/);
  });

  it("versão sem termo não pode ser publicada; nova versão copia o termo", async () => {
    const v = await createDraftVersion(admin, trainingId, ctx());
    expect(await asAdmin(admin, (tx) => versionProblems(tx, v))).toEqual([]);
    await setVersionTerm(admin, v, null, ctx());
    await expect(publishVersion(admin, v, ctx())).rejects.toThrow(/vincule um termo/);
    await setVersionTerm(admin, v, await createModelTerm(admin, "POD e PNR", ctx()), ctx());
    await publishVersion(admin, v, ctx());
  });
});

describe("Etapa 5 — assinatura e conclusão", () => {
  it("Treinamento não conclui sem assinatura", async () => {
    const d = await ready();
    const st = await signingState(d.drv, d.convId);
    expect(st!.conv.status).toBe("aprovado_aguardando_assinatura");
    expect(st!.canSign).toBe(true);
    await expect(raw`update academy.convocations set completed_at = now() where id = ${d.convId}`).rejects.toThrow(/termo não assinado/);
  });

  it("assinatura só é liberada após vídeos e aprovação", async () => {
    const d = await loggedDriver();
    await expect(requestSignatureCode(d.drv, d.convId, ctx())).rejects.toThrow(/vídeos obrigatórios/);
    await completeVideos(d.convId);
    await expect(requestSignatureCode(d.drv, d.convId, ctx())).rejects.toThrow(/aprovação/);
  });

  it("assina com código de uso único, gera PDF assinado, conclui e emite comprovante", async () => {
    const d = await ready();
    const r = await requestSignatureCode(d.drv, d.convId, ctx());
    await expect(signTerm(d.drv, d.convId, { challengeId: r.challengeId, code: "000000", accepted: true }, ctx())).rejects.toThrow(/incorreto/);
    await expect(signTerm(d.drv, d.convId, { challengeId: r.challengeId, code: await lastCodeFor(d.phone), accepted: false }, ctx())).rejects.toThrow(/Marque a declaração/);
    const out = await signTerm(d.drv, d.convId, { challengeId: r.challengeId, code: await lastCodeFor(d.phone), accepted: true, drawing: PNG_1x1 }, ctx({ userAgent: "Mozilla/5.0 teste" }));
    expect(out.verificationCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    const st = await signingState(d.drv, d.convId);
    expect(st!.conv.status).toBe("concluido");
    expect(st!.certificate?.code).toBe(out.certificateCode);

    const [s] = await raw<{ evidence: Record<string, unknown>; evidence_sha256: string; signed_pdf_key: string; signed_pdf_sha256: string; term_sha256: string; drawing_key: string }[]>`
      select evidence, evidence_sha256, signed_pdf_key, signed_pdf_sha256, term_sha256, drawing_key from academy.signatures where convocation_id = ${d.convId}`;
    expect(sha256Hex(canonicalJson(s.evidence))).toBe(s.evidence_sha256);
    const pdf = await storage.get(s.signed_pdf_key);
    expect(sha256Hex(pdf)).toBe(s.signed_pdf_sha256);
    const parsed = await PDFDocument.load(pdf);
    expect(parsed.getPageCount()).toBeGreaterThanOrEqual(2); // termo + manifesto
    expect(parsed.getSubject()).toContain(out.verificationCode);
    expect(s.drawing_key).toBeTruthy();
    const ev = s.evidence as { authentication: { session_id: string; otp_destination_mask: string }; client: { ip: string } };
    expect(ev.authentication.session_id).toBe(d.drv.sessionId);
    expect(ev.authentication.otp_destination_mask).not.toContain(d.phone.slice(-8));

    const events = await raw<{ type: string }[]>`select type from academy.convocation_events where convocation_id = ${d.convId} order by id`;
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(["signed", "completed"]));
    const ver = await signatureEvidence(admin, (await raw`select id from academy.signatures where convocation_id = ${d.convId}`)[0].id);
    expect(ver!.recomputed).toBe(ver!.evidence_sha256);
    expect((await listSignatures(admin, { q: d.cpf })).length).toBe(1);
  });

  it("código de assinatura vale só para a sessão que o pediu", async () => {
    const d = await ready();
    const r = await requestSignatureCode(d.drv, d.convId, ctx());
    const other = { ...d.drv, sessionId: "00000000-0000-0000-0000-000000000001" };
    await expect(signTerm(other, d.convId, { challengeId: r.challengeId, code: await lastCodeFor(d.phone), accepted: true }, ctx())).rejects.toThrow(/inválido ou expirado/);
    // código de login também não serve para assinar
    await expect(signTerm(d.drv, d.convId, { challengeId: d.drv.otpChallengeId!, code: "123456", accepted: true }, ctx())).rejects.toThrow(/inválido ou expirado/);
  });

  it("assinatura e conclusão são imutáveis; não há segunda assinatura", async () => {
    const d = await ready();
    await sign(d);
    await expect(raw`update academy.signatures set signer_name = 'Outro' where convocation_id = ${d.convId}`).rejects.toThrow(/protegido/);
    await expect(raw`delete from academy.signatures where convocation_id = ${d.convId}`).rejects.toThrow(/protegido/);
    await expect(raw`update academy.convocations set completed_at = null where id = ${d.convId}`).rejects.toThrow(/não pode ser reaberto/);
    await expect(requestSignatureCode(d.drv, d.convId, ctx())).rejects.toThrow();
    await expect(raw`update academy.certificates set pdf_sha256 = repeat('0', 64) where convocation_id = ${d.convId}`).rejects.toThrow(/revogação/);
  });

  it("prazo vencido impede a assinatura", async () => {
    const d = await ready();
    const r = await requestSignatureCode(d.drv, d.convId, ctx());
    await raw`update academy.convocations set blocked_at = now() where id = ${d.convId}`;
    await expect(signTerm(d.drv, d.convId, { challengeId: r.challengeId, code: await lastCodeFor(d.phone), accepted: true }, ctx())).rejects.toThrow(/prazo|bloqueado/);
    const [n] = await raw`select count(*)::int as n from academy.signatures`;
    expect(n.n).toBe(0);
  });

  it("motorista não lê evidências nem caminhos dos arquivos", async () => {
    const d = await ready();
    await sign(d);
    await expect(asDriver(d.drv.id, (tx) => tx`select evidence from signatures`)).rejects.toThrow(/permission denied/);
    await expect(asDriver(d.drv.id, (tx) => tx`select signed_pdf_key from signatures`)).rejects.toThrow(/permission denied/);
    await expect(asDriver(d.drv.id, (tx) => tx`select storage_key from terms`)).rejects.toThrow(/permission denied/);
    const other = await loggedDriver();
    const seen = await asDriver(other.drv.id, (tx) => tx`select id from signatures`);
    expect(seen.length).toBe(0);
  });
});

describe("Etapa 5 — verificação pública", () => {
  it("valida o comprovante pelo código sem expor CPF, nome completo ou contato", async () => {
    const d = await ready();
    const out = await sign(d);
    const v = await verifyDocument(out.certificateCode.toLowerCase().replace(/-/g, ""), ctx());
    expect(v).toMatchObject({ kind: "certificate", code: out.certificateCode, revoked: false, holder: initials(d.name) });
    const json = JSON.stringify(v);
    expect(json).not.toContain(d.cpf.slice(3, 9));
    expect(json).not.toContain("Assinatura da Silva");
    expect(json).not.toContain(d.phone.slice(-4));
    const s = await verifyDocument(out.verificationCode, ctx());
    expect(s).toMatchObject({ kind: "signature", pdf_sha256: out.signedPdfSha256 });
    expect(await verifyDocument("AAAA-BBBB-CCCC", ctx())).toBeNull();
    expect(await verifyDocument("lixo", ctx())).toBeNull();
    await revokeCertificate(admin, d.convId, "Teste de revogação", ctx());
    expect((await verifyDocument(out.certificateCode, ctx()))!.revoked).toBe(true);
  });
});
