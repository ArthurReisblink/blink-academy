import "server-only";
import { randomInt } from "node:crypto";
import { asAdmin, asAuth, asDriver, asSystem, type Tx } from "@/lib/db";
import { canonicalJson, randomToken, sha256Hex } from "@/lib/crypto";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { nowOf, type AdminPrincipal, type DriverPrincipal, type ReqCtx } from "../context";
import { consumeOtp, cpfLookupHash, issueOtp } from "../auth/driver";
import { authLog, auditLog } from "../auth/log";
import { enforceLimit } from "../auth/rateLimit";
import { storage } from "../storage";
import { buildCertificatePdf, buildSignedTermPdf } from "../pdf";
import { withStatus, type ConvocationRow } from "./convocations";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function verificationCode() {
  const s = Array.from({ length: 12 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}
export function normalizeCode(input: string) {
  const s = (input ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (s.length !== 12 || [...s].some((c) => !ALPHABET.includes(c))) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}
/** Nome reduzido às iniciais (para páginas públicas de verificação). */
export function initials(name: string) {
  return name.trim().split(/\s+/).filter((p) => p.length > 2 || /^[A-ZÀ-Ú]/.test(p)).map((p) => `${p[0].toUpperCase()}.`).join(" ");
}

const verifyUrl = (code: string) => `${env.appUrl}/verificar/${code}`;
const UUID = /^[0-9a-f-]{36}$/i;

// =====================================================================
// Portal do motorista
// =====================================================================
type TermInfo = { id: string; title: string; version_label: string; declaration: string; sha256: string; page_count: number | null };
type SigInfo = { id: string; signed_at: Date; verification_code: string; evidence_sha256: string; signed_pdf_sha256: string; otp_destination_mask: string };
type CertInfo = { id: string; code: string; issued_at: Date; pdf_sha256: string; revoked_at: Date | null };

export async function signingState(driver: DriverPrincipal, convocationId: string, now = new Date()) {
  if (!UUID.test(convocationId)) return null;
  return asDriver(driver.id, async (tx) => {
    const [row] = await tx<(ConvocationRow & { certificate_code: string | null })[]>`select * from convocation_overview where id = ${convocationId}`;
    if (!row) return null;
    const conv = withStatus(row, now);
    const [term] = await tx<TermInfo[]>`
      select t.id, t.title, t.version_label, t.declaration, t.sha256, t.page_count from training_versions tv join terms t on t.id = tv.term_id
      where tv.id = ${row.training_version_id}`;
    const [signature] = await tx<SigInfo[]>`select id, signed_at, verification_code, evidence_sha256, signed_pdf_sha256, otp_destination_mask from signatures where convocation_id = ${convocationId}`;
    const [certificate] = await tx<CertInfo[]>`select id, code, issued_at, pdf_sha256, revoked_at from certificates where convocation_id = ${convocationId}`;
    const open = !["expirado", "bloqueado", "cancelado"].includes(conv.status);
    const videosOk = row.required_videos > 0 && row.completed_required_videos >= row.required_videos;
    let reason: string | null = null;
    if (signature) reason = null;
    else if (!term) reason = "O termo deste treinamento ainda não foi configurado. Entre em contato com a administração da BLINK.";
    else if (!open) reason = "Seu prazo de treinamento terminou ou o acesso foi bloqueado. Entre em contato com a administração da BLINK.";
    else if (!videosOk) reason = "Conclua todos os vídeos obrigatórios antes de assinar.";
    else if (!row.passed) reason = "A assinatura é liberada depois da aprovação na avaliação.";
    return { conv, term: term ?? null, signature: signature ?? null, certificate: certificate ?? null, canSign: !signature && !reason, reason };
  });
}

/** Envia o código de confirmação da assinatura ao contato cadastrado. */
export async function requestSignatureCode(driver: DriverPrincipal, convocationId: string, ctx: ReqCtx) {
  const now = nowOf(ctx);
  const st = await signingState(driver, convocationId, now);
  if (!st) throw new AppError("not_found", "Convocação não encontrada.", 404);
  if (!st.canSign) throw new AppError("not_ready", st.reason ?? "A assinatura não está disponível.");
  await asAuth((tx) => enforceLimit(tx, `sig-code:${driver.id}`, 5, 900, now));
  return asAuth(async (tx) => {
    const [d] = await tx<{ id: string; phone: string | null; email: string | null }[]>`select id, phone, email from drivers where id = ${driver.id}`;
    const r = await issueOtp(tx, d, "signature", { ip: ctx.ip, now }, driver.sessionId);
    await authLog(tx, { subjectType: "driver", subjectId: driver.id, event: "signature_code_request", success: true, ip: ctx.ip, userAgent: ctx.userAgent, details: { convocation: convocationId } });
    return r;
  });
}

export type SignInput = { challengeId: string; code: string; accepted: boolean; drawing?: string | null };

function decodeDrawing(dataUrl: string | null | undefined): Buffer | null {
  if (!dataUrl) return null;
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw new AppError("invalid_drawing", "Rubrica inválida. Limpe e desenhe novamente.");
  const buf = Buffer.from(m[1], "base64");
  if (buf.length > 300_000 || buf.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new AppError("invalid_drawing", "Rubrica inválida. Limpe e desenhe novamente.");
  return buf;
}

/**
 * Assinatura: confere a declaração, o código de uso único (ligado a esta sessão) e,
 * no banco, os pré-requisitos. Gera o PDF assinado, conclui o treinamento e emite o comprovante.
 */
export async function signTerm(driver: DriverPrincipal, convocationId: string, input: SignInput, ctx: ReqCtx) {
  const now = nowOf(ctx);
  if (!input.accepted) throw new AppError("not_accepted", "Marque a declaração para assinar.");
  const drawing = decodeDrawing(input.drawing);
  const st = await signingState(driver, convocationId, now);
  if (!st) throw new AppError("not_found", "Convocação não encontrada.", 404);
  if (st.signature) throw new AppError("already", "Este termo já foi assinado.", 409);
  if (!st.canSign) throw new AppError("not_ready", st.reason ?? "A assinatura não está disponível.");

  await asAuth((tx) => enforceLimit(tx, `sig-verify:${driver.id}`, 15, 900, now));
  const otp = await asAuth(async (tx) => {
    const r = await consumeOtp(tx, input.challengeId, input.code, "signature", now, driver.sessionId);
    await authLog(tx, { subjectType: "driver", subjectId: driver.id, event: "signature_code_verify", success: r.ok && r.driverId === driver.id, ip: ctx.ip, userAgent: ctx.userAgent, details: { convocation: convocationId } });
    return r;
  });
  if (!otp.ok) throw otp.error;
  if (otp.driverId !== driver.id) throw new AppError("invalid_code", "Código inválido ou expirado. Peça um novo código.", 401);

  return asSystem(async (tx) => {
    await tx`select id from convocations where id = ${convocationId} for update`;
    const [exists] = await tx`select 1 from signatures where convocation_id = ${convocationId}`;
    if (exists) throw new AppError("already", "Este termo já foi assinado.", 409);
    const [c] = await tx<{ driver_id: string; full_name: string; cpf_mask: string; training_title: string; training_version: number; term_id: string; first_access_at: Date | null; activated_at: Date }[]>`
      select c.driver_id, d.full_name, d.cpf_mask, t.title as training_title, tv.version as training_version, tv.term_id, c.first_access_at, c.activated_at
      from convocations c join drivers d on d.id = c.driver_id join trainings t on t.id = c.training_id join training_versions tv on tv.id = c.training_version_id
      where c.id = ${convocationId}`;
    if (c.driver_id !== driver.id) throw new AppError("not_found", "Convocação não encontrada.", 404);
    const [term] = await tx<{ id: string; title: string; version_label: string; declaration: string; sha256: string; storage_key: string }[]>`
      select id, title, version_label, declaration, sha256, storage_key from terms where id = ${c.term_id}`;
    const [att] = await tx<{ attempt_number: number; score_pct: string; submitted_at: Date; rules: { pass_pct: number } }[]>`
      select attempt_number, score_pct, submitted_at, rules from exam_attempts where convocation_id = ${convocationId} and passed order by attempt_number limit 1`;
    if (!att) throw new AppError("not_ready", "A assinatura é liberada depois da aprovação na avaliação.");
    const videos = await tx<{ title: string; completed_at: Date }[]>`
      select v.title, p.completed_at from version_videos vv join videos v on v.id = vv.video_id
      join convocations c on c.training_version_id = vv.version_id
      left join video_progress p on p.convocation_id = c.id and p.video_id = vv.video_id
      where c.id = ${convocationId} and vv.required order by vv.position`;
    const [ch] = await tx<{ channel: string; destination_mask: string }[]>`select channel, destination_mask from otp_challenges where id = ${otp.challengeId}`;

    // integridade do termo armazenado
    const original = await storage.get(term.storage_key);
    if (sha256Hex(original) !== term.sha256) throw new AppError("term_integrity", "O arquivo do termo não confere com o registrado. A administração foi avisada.", 500);

    const code = verificationCode();
    const drawingKey = drawing ? `assinaturas/rubricas/${randomToken(12)}.png` : null;
    const drawingSha = drawing ? sha256Hex(drawing) : null;
    const evidence = {
      document: "termo_treinamento", version: 1, timezone: "America/Sao_Paulo",
      verification_code: code, signed_at: now.toISOString(),
      convocation_id: convocationId, training_title: c.training_title, training_version: c.training_version,
      signer: { driver_id: driver.id, name: c.full_name, cpf_mask: c.cpf_mask }, holder_masked: initials(c.full_name),
      term: { id: term.id, title: term.title, version: term.version_label, sha256: term.sha256 },
      consent: { declaration: term.declaration, accepted: true },
      prerequisites: {
        videos: videos.map((v) => ({ title: v.title, completed_at: v.completed_at?.toISOString() ?? null })),
        exam: { attempt: att.attempt_number, score_pct: Number(att.score_pct), pass_pct: Number(att.rules.pass_pct), submitted_at: att.submitted_at.toISOString() },
      },
      authentication: {
        method: "CPF + código de uso único (login) e novo código de uso único (assinatura)",
        session_id: driver.sessionId, login_otp_challenge_id: driver.otpChallengeId,
        signature_otp_challenge_id: otp.challengeId, otp_channel: ch.channel, otp_destination_mask: ch.destination_mask,
      },
      client: { ip: ctx.ip, user_agent: (ctx.userAgent ?? "").slice(0, 400) },
      drawing_sha256: drawingSha,
    };
    const evidenceSha = sha256Hex(canonicalJson(evidence));
    const signedPdf = await buildSignedTermPdf(original, {
      verificationCode: code, verifyUrl: verifyUrl(code), signedAt: now, signerName: c.full_name, signerCpfMask: c.cpf_mask,
      trainingTitle: c.training_title, trainingVersion: c.training_version, termTitle: term.title, termVersion: term.version_label,
      termSha256: term.sha256, declaration: term.declaration, examScore: Number(att.score_pct), examAttempt: att.attempt_number,
      otpChannel: ch.channel, otpDestinationMask: ch.destination_mask, ip: ctx.ip, userAgent: ctx.userAgent ?? "", evidenceSha256: evidenceSha, drawingPng: drawing,
    });
    const signedKey = `assinaturas/${now.toISOString().slice(0, 7)}/${code}.pdf`;
    if (drawing && drawingKey) await storage.put(drawingKey, drawing, "image/png");
    await storage.put(signedKey, signedPdf, "application/pdf");
    const signedSha = sha256Hex(signedPdf);
    try {
      await tx`insert into signatures ${tx({
        convocation_id: convocationId, driver_id: driver.id, term_id: term.id, term_sha256: term.sha256, signed_at: now,
        signer_name: c.full_name, signer_cpf_mask: c.cpf_mask, ip: ctx.ip, user_agent: (ctx.userAgent ?? "").slice(0, 400),
        otp_challenge_id: otp.challengeId, otp_channel: ch.channel, otp_destination_mask: ch.destination_mask, session_id: driver.sessionId,
        drawing_key: drawingKey, drawing_sha256: drawingSha, evidence: tx.json(evidence as never), evidence_sha256: evidenceSha,
        signed_pdf_key: signedKey, signed_pdf_sha256: signedSha, verification_code: code,
      } as never)}`;
    } catch (e) {
      throw new AppError("sign_refused", (e as Error).message.replace(/^.*?: /, ""), 403);
    }
    await tx`insert into convocation_events (convocation_id, type, details) values (${convocationId}, 'signed', ${tx.json({ code, evidence_sha256: evidenceSha } as never)})`;
    const cert = await completeAndCertify(tx, convocationId, now, {
      holderName: c.full_name, holderCpfMask: c.cpf_mask, trainingTitle: c.training_title, trainingVersion: c.training_version,
      startedAt: c.first_access_at, videosCompleted: videos.length, examScore: Number(att.score_pct), examAttempt: att.attempt_number,
      passPct: Number(att.rules.pass_pct), signedAt: now, signatureCode: code, driverId: driver.id,
    });
    return { verificationCode: code, evidenceSha256: evidenceSha, signedPdfSha256: signedSha, certificateCode: cert.code };
  });
}

/** Conclui a convocação (o banco confere vídeos + aprovação + assinatura) e emite o comprovante. */
async function completeAndCertify(tx: Tx, convocationId: string, now: Date, d: {
  holderName: string; holderCpfMask: string; trainingTitle: string; trainingVersion: number; startedAt: Date | null; videosCompleted: number;
  examScore: number; examAttempt: number; passPct: number; signedAt: Date; signatureCode: string; driverId: string }) {
  await tx`update convocations set completed_at = ${now} where id = ${convocationId}`;
  await tx`insert into convocation_events (convocation_id, type, details) values (${convocationId}, 'completed', '{}'::jsonb)`;
  const code = verificationCode();
  const pdf = await buildCertificatePdf({ code, verifyUrl: verifyUrl(code), issuedAt: now, holderName: d.holderName, holderCpfMask: d.holderCpfMask,
    trainingTitle: d.trainingTitle, trainingVersion: d.trainingVersion, startedAt: d.startedAt, completedAt: now, videosCompleted: d.videosCompleted,
    examScore: d.examScore, examAttempt: d.examAttempt, passPct: d.passPct, signedAt: d.signedAt, signatureCode: d.signatureCode });
  const key = `comprovantes/${now.toISOString().slice(0, 7)}/${code}.pdf`;
  await storage.put(key, pdf, "application/pdf");
  const data = { training_title: d.trainingTitle, training_version: d.trainingVersion, holder_masked: initials(d.holderName), exam_score: d.examScore,
    videos_completed: d.videosCompleted, signature_code: d.signatureCode, completed_at: now.toISOString() };
  await tx`insert into certificates (convocation_id, driver_id, code, issued_at, data, pdf_key, pdf_sha256)
    values (${convocationId}, ${d.driverId}, ${code}, ${now}, ${tx.json(data as never)}, ${key}, ${sha256Hex(pdf)})`;
  return { code };
}

// =====================================================================
// Arquivos (link temporário, sempre depois de conferir o acesso)
// =====================================================================
export type DocKind = "term" | "signed" | "certificate";

async function keyFor(tx: Tx, kind: DocKind, convocationId: string) {
  if (kind === "term") {
    const [t] = await tx<{ key: string; name: string }[]>`select t.storage_key as key, 'termo-' || t.version_label || '.pdf' as name
      from convocations c join training_versions tv on tv.id = c.training_version_id join terms t on t.id = tv.term_id where c.id = ${convocationId}`;
    return t;
  }
  if (kind === "signed") {
    const [s] = await tx<{ key: string; name: string }[]>`select signed_pdf_key as key, 'termo-assinado-' || verification_code || '.pdf' as name from signatures where convocation_id = ${convocationId}`;
    return s;
  }
  const [c] = await tx<{ key: string; name: string }[]>`select pdf_key as key, 'comprovante-' || code || '.pdf' as name from certificates where convocation_id = ${convocationId} and revoked_at is null`;
  return c;
}

export async function driverDocumentUrl(driver: DriverPrincipal, kind: DocKind, convocationId: string) {
  if (!UUID.test(convocationId)) throw new AppError("not_found", "Documento não encontrado.", 404);
  const [own] = await asDriver(driver.id, (tx) => tx`select id from convocations where id = ${convocationId}`);
  if (!own) throw new AppError("not_found", "Documento não encontrado.", 404);
  const f = await asSystem((tx) => keyFor(tx, kind, convocationId));
  if (!f) throw new AppError("not_found", "Documento não encontrado.", 404);
  return storage.readUrl(f.key, 300, f.name);
}

export async function adminDocumentUrl(admin: AdminPrincipal, kind: DocKind, convocationId: string, ctx: ReqCtx) {
  if (!UUID.test(convocationId)) throw new AppError("not_found", "Documento não encontrado.", 404);
  return asAdmin(admin, async (tx) => {
    const f = kind === "term"
      ? (await tx<{ key: string; name: string }[]>`select t.storage_key as key, 'termo-' || t.version_label || '.pdf' as name from convocations c join training_versions tv on tv.id = c.training_version_id join terms t on t.id = tv.term_id where c.id = ${convocationId}`)[0]
      : kind === "signed"
        ? (await tx<{ key: string; name: string }[]>`select signed_pdf_key as key, 'termo-assinado-' || verification_code || '.pdf' as name from signatures where convocation_id = ${convocationId}`)[0]
        : (await tx<{ key: string; name: string }[]>`select pdf_key as key, 'comprovante-' || code || '.pdf' as name from certificates where convocation_id = ${convocationId}`)[0];
    if (!f) throw new AppError("not_found", "Documento não encontrado.", 404);
    await auditLog(tx, admin.id, `document.download.${kind}`, "convocation", convocationId, {}, ctx.ip);
    return storage.readUrl(f.key, 300, f.name);
  });
}

// =====================================================================
// Painel: assinaturas
// =====================================================================
export type SignatureRow = { id: string; convocation_id: string; driver_id: string; signer_name: string; signer_cpf_mask: string; signed_at: Date;
  verification_code: string; evidence_sha256: string; signed_pdf_sha256: string; otp_channel: string; otp_destination_mask: string; ip: string | null;
  term_title: string; term_version: string; training_title: string; training_version: number; certificate_code: string | null; certificate_revoked: boolean; base_name: string | null };

export async function listSignatures(admin: AdminPrincipal, f: { q?: string; from?: string; to?: string } = {}) {
  const digits = (f.q ?? "").replace(/\D/g, "");
  return asAdmin(admin, (tx) => tx<SignatureRow[]>`
    select s.id, s.convocation_id, s.driver_id, s.signer_name, s.signer_cpf_mask, s.signed_at, s.verification_code, s.evidence_sha256, s.signed_pdf_sha256,
      s.otp_channel, s.otp_destination_mask, s.ip, t.title as term_title, t.version_label as term_version, tr.title as training_title, tv.version as training_version,
      ce.code as certificate_code, ce.revoked_at is not null as certificate_revoked, b.name as base_name
    from signatures s join terms t on t.id = s.term_id join convocations c on c.id = s.convocation_id
    join training_versions tv on tv.id = c.training_version_id join trainings tr on tr.id = c.training_id
    join drivers d on d.id = s.driver_id left join bases b on b.id = coalesce(c.base_id, d.base_id)
    left join certificates ce on ce.convocation_id = s.convocation_id
    where true
      ${f.q ? tx`and (s.signer_name ilike ${"%" + f.q + "%"} or s.verification_code = ${f.q.toUpperCase()} or ce.code = ${f.q.toUpperCase()}
                  ${digits.length === 11 ? tx`or d.cpf_hash = ${cpfLookupHash(digits)}` : tx``})` : tx``}
      ${f.from ? tx`and s.signed_at >= ${new Date(f.from + "T00:00:00-03:00")}` : tx``}
      ${f.to ? tx`and s.signed_at < ${new Date(new Date(f.to + "T00:00:00-03:00").getTime() + 86400000)}` : tx``}
    order by s.signed_at desc limit 500`);
}

export async function signatureEvidence(admin: AdminPrincipal, id: string) {
  if (!UUID.test(id)) return null;
  const [s] = await asAdmin(admin, (tx) => tx<{ evidence: Record<string, unknown>; evidence_sha256: string }[]>`select evidence, evidence_sha256 from signatures where id = ${id}`);
  if (!s) return null;
  return { ...s, recomputed: sha256Hex(canonicalJson(s.evidence)) };
}

export async function revokeCertificate(admin: AdminPrincipal, convocationId: string, reason: string, ctx: ReqCtx) {
  if (admin.role !== "superadmin") throw new AppError("forbidden", "Somente o superadministrador pode revogar comprovantes.", 403);
  const r = reason.trim();
  if (r.length < 5) throw new AppError("reason", "Informe o motivo da revogação.");
  await asAdmin(admin, async (tx) => {
    const res = await tx`update certificates set revoked_at = now(), revoked_reason = ${r}, revoked_by = ${admin.id} where convocation_id = ${convocationId} and revoked_at is null returning id`;
    if (!res.length) throw new AppError("not_found", "Comprovante não encontrado ou já revogado.", 404);
    await auditLog(tx, admin.id, "certificate.revoke", "convocation", convocationId, { reason: r }, ctx.ip);
  });
}

// =====================================================================
// Verificação pública (sem CPF e sem dados de contato)
// =====================================================================
export type Verification = { kind: "certificate" | "signature"; code: string; issued_at: Date; training_title: string; training_version: number;
  holder: string; pdf_sha256: string; revoked: boolean; extra_sha256: string | null };

export async function verifyDocument(input: string, ctx: ReqCtx): Promise<Verification | null> {
  const now = nowOf(ctx);
  await asAuth((tx) => enforceLimit(tx, `verify:${ctx.ip}`, 40, 600, now));
  const code = normalizeCode(input);
  if (!code) return null;
  const [v] = await asAuth((tx) => tx<Verification[]>`select * from academy.verify_document(${code})`);
  return v ?? null;
}
