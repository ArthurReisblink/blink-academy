import "server-only";
import * as OTPAuth from "otpauth";
import QRCode from "qrcode";
import { asAuth, asAdmin, type Tx } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { nowOf, type AdminPrincipal, type ReqCtx } from "../context";
import { enforceLimit } from "./rateLimit";
import { authLog, auditLog } from "./log";
import { createSession, findSession, revokeSession } from "./sessions";
import { dummyVerify, hashPassword, passwordProblems, verifyPassword } from "./password";

const MAX_FAILS = 8;
const LOCK_MINUTES = 15;
const GENERIC = "E-mail, senha ou código inválidos.";

type AdminRow = {
  id: string; email: string; name: string; role: AdminPrincipal["role"]; password_hash: string;
  totp_secret_enc: string | null; totp_enabled_at: Date | null; totp_last_step: string | null;
  active: boolean; failed_logins: number; locked_until: Date | null;
};

/** 1º fator: e-mail e senha. Devolve um token temporário para o 2º fator. */
export async function adminPasswordLogin(email: string, password: string, ctx: ReqCtx) {
  const now = nowOf(ctx);
  const em = (email ?? "").trim().toLowerCase();
  // Limites em transação própria: precisam valer mesmo quando a tentativa falha.
  await asAuth(async (tx) => {
    await enforceLimit(tx, `adm-ip:${ctx.ip}`, 30, 900, now);
    await enforceLimit(tx, `adm-email:${em}`, 15, 900, now);
  });
  const result = await asAuth(async (tx) => {
    const [a] = await tx<AdminRow[]>`select * from admins where lower(email) = ${em}`;
    if (!a) {
      await dummyVerify(password ?? "");
      await authLog(tx, { subjectType: "admin", event: "admin_password", success: false, ip: ctx.ip, userAgent: ctx.userAgent, details: { reason: "unknown_email" } });
      return { ok: false as const, error: new AppError("invalid_credentials", GENERIC, 401) };
    }
    if (!a.active) {
      await authLog(tx, { subjectType: "admin", subjectId: a.id, event: "admin_password", success: false, ip: ctx.ip, userAgent: ctx.userAgent, details: { reason: "inactive" } });
      return { ok: false as const, error: new AppError("invalid_credentials", GENERIC, 401) };
    }
    if (a.locked_until && a.locked_until > now) {
      await authLog(tx, { subjectType: "admin", subjectId: a.id, event: "admin_password", success: false, ip: ctx.ip, userAgent: ctx.userAgent, details: { reason: "locked" } });
      return { ok: false as const, error: new AppError("locked", "Acesso temporariamente bloqueado por excesso de tentativas. Tente mais tarde.", 423) };
    }
    const ok = await verifyPassword(a.password_hash, password ?? "");
    if (!ok) {
      const fails = a.failed_logins + 1;
      const lock = fails >= MAX_FAILS ? new Date(now.getTime() + LOCK_MINUTES * 60000) : null;
      await tx`update admins set failed_logins = ${lock ? 0 : fails}, locked_until = ${lock} where id = ${a.id}`;
      await authLog(tx, { subjectType: "admin", subjectId: a.id, event: "admin_password", success: false, ip: ctx.ip, userAgent: ctx.userAgent, details: { locked: !!lock } });
      return { ok: false as const, error: new AppError("invalid_credentials", GENERIC, 401) };
    }
    await tx`update admins set failed_logins = 0, locked_until = null where id = ${a.id}`;
    const s = await createSession(tx, "admin_mfa", a.id, { ip: ctx.ip, userAgent: ctx.userAgent, now });
    await authLog(tx, { subjectType: "admin", subjectId: a.id, event: "admin_password", success: true, ip: ctx.ip, userAgent: ctx.userAgent });
    return { ok: true as const, mfaToken: s.token, needsSetup: !a.totp_enabled_at };
  });
  if (!result.ok) throw result.error;
  return { mfaToken: result.mfaToken, needsSetup: result.needsSetup };
}

function totpFor(a: { email: string }, secretB32: string) {
  return new OTPAuth.TOTP({ issuer: "BLINK Academy", label: a.email, algorithm: "SHA1", digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(secretB32) });
}

async function loadMfa(tx: Tx, mfaToken: string, now: Date) {
  const s = await findSession(tx, mfaToken, "admin_mfa", now);
  if (!s) throw new AppError("mfa_expired", "Sua etapa de verificação expirou. Entre novamente.", 401);
  const [a] = await tx<AdminRow[]>`select * from admins where id = ${s.subject_id}`;
  if (!a || !a.active) throw new AppError("mfa_expired", "Sua etapa de verificação expirou. Entre novamente.", 401);
  return a;
}

/** Cadastro do autenticador (Google Authenticator, Microsoft Authenticator etc.) no primeiro acesso. */
export async function adminTotpSetup(mfaToken: string, ctx: ReqCtx) {
  const now = nowOf(ctx);
  return asAuth(async (tx) => {
    const a = await loadMfa(tx, mfaToken, now);
    if (a.totp_enabled_at) throw new AppError("already_enrolled", "O autenticador já está configurado.");
    let secret: string;
    if (a.totp_secret_enc) secret = decrypt(a.totp_secret_enc);
    else {
      secret = new OTPAuth.Secret({ size: 20 }).base32;
      await tx`update admins set totp_secret_enc = ${encrypt(secret)} where id = ${a.id}`;
    }
    const uri = totpFor(a, secret).toString();
    return { secret, uri, qrDataUrl: await QRCode.toDataURL(uri, { margin: 1, width: 240 }) };
  });
}

/** 2º fator: código de 6 dígitos do autenticador. Cria a sessão administrativa. */
export async function adminTotpVerify(mfaToken: string, code: string, ctx: ReqCtx) {
  const now = nowOf(ctx);
  const subject = await asAuth(async (tx) => {
    await enforceLimit(tx, `adm-mfa-ip:${ctx.ip}`, 30, 900, now);
    const a = await loadMfa(tx, mfaToken, now);
    await enforceLimit(tx, `adm-mfa:${a.id}`, 6, 300, now);
    return a.id;
  });
  const result = await asAuth(async (tx) => {
    const a = await loadMfa(tx, mfaToken, now);
    if (a.id !== subject) throw new AppError("mfa_expired", "Sua etapa de verificação expirou. Entre novamente.", 401);
    if (!a.totp_secret_enc) return { ok: false as const, error: new AppError("no_totp", "Configure o autenticador antes de continuar.") };
    const totp = totpFor(a, decrypt(a.totp_secret_enc));
    const clean = (code ?? "").replace(/\D/g, "");
    const delta = clean.length === 6 ? totp.validate({ token: clean, timestamp: now.getTime(), window: 1 }) : null;
    const step = delta === null ? null : Math.floor(now.getTime() / 30000) + delta;
    if (step === null || (a.totp_last_step !== null && step <= Number(a.totp_last_step))) {
      await authLog(tx, { subjectType: "admin", subjectId: a.id, event: "admin_totp", success: false, ip: ctx.ip, userAgent: ctx.userAgent });
      return { ok: false as const, error: new AppError("invalid_code", "Código inválido. Confira o horário do celular e tente novamente.", 401) };
    }
    await tx`update admins set totp_last_step = ${step}, totp_enabled_at = coalesce(totp_enabled_at, ${now}),
              last_login_at = ${now} where id = ${a.id}`;
    await revokeSession(tx, mfaToken);
    const s = await createSession(tx, "admin", a.id, { ip: ctx.ip, userAgent: ctx.userAgent, now });
    await authLog(tx, { subjectType: "admin", subjectId: a.id, event: "admin_login", success: true, ip: ctx.ip, userAgent: ctx.userAgent, details: { enrolled_now: !a.totp_enabled_at } });
    return { ok: true as const, token: s.token, expiresAt: s.expiresAt };
  });
  if (!result.ok) throw result.error;
  return { token: result.token, expiresAt: result.expiresAt };
}

export async function getAdminByToken(token: string | undefined | null, now = new Date()): Promise<AdminPrincipal | null> {
  if (!token) return null;
  return asAuth(async (tx) => {
    const s = await findSession(tx, token, "admin", now);
    if (!s) return null;
    const [a] = await tx<AdminRow[]>`select id, email, name, role, active from admins where id = ${s.subject_id}`;
    if (!a || !a.active) return null;
    return { id: a.id, role: a.role, name: a.name, email: a.email, sessionId: s.id };
  });
}

export async function adminLogout(token: string | undefined | null) {
  await asAuth((tx) => revokeSession(tx, token));
}

export function assertCanWrite(admin: AdminPrincipal) {
  if (admin.role === "auditor") throw new AppError("forbidden", "Seu perfil é somente leitura.", 403);
}

export function assertSuperadmin(admin: AdminPrincipal) {
  if (admin.role !== "superadmin") throw new AppError("forbidden", "Apenas o superadministrador pode fazer isso.", 403);
}

/** Criação de administradores (pelo script inicial ou por um superadmin). */
export async function createAdminRecord(tx: Tx, data: { email: string; name: string; role: AdminPrincipal["role"]; password: string; createdBy?: string | null }) {
  const problems = passwordProblems(data.password);
  if (problems.length) throw new AppError("weak_password", `A senha precisa ter ${problems.join(", ")}.`);
  const email = data.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new AppError("invalid_email", "E-mail inválido.");
  const [exists] = await tx`select 1 from admins where lower(email) = ${email}`;
  if (exists) throw new AppError("duplicate", "Já existe um administrador com esse e-mail.");
  const [row] = await tx<{ id: string }[]>`
    insert into admins (email, name, role, password_hash, created_by)
    values (${email}, ${data.name.trim()}, ${data.role}, ${await hashPassword(data.password)}, ${data.createdBy ?? null})
    returning id`;
  return row.id;
}

export async function createAdminBySuperadmin(admin: AdminPrincipal, data: { email: string; name: string; role: AdminPrincipal["role"]; password: string }, ctx: ReqCtx) {
  assertSuperadmin(admin);
  return asAdmin(admin, async (tx) => {
    const id = await createAdminRecord(tx, { ...data, createdBy: admin.id });
    await auditLog(tx, admin.id, "admin.create", "admin", id, { email: data.email, role: data.role }, ctx.ip);
    return id;
  });
}
