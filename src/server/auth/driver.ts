import "server-only";
import { asAuth, type Tx } from "@/lib/db";
import { hmacHex, numericCode, randomToken, safeEqual } from "@/lib/crypto";
import { isValidCpf, onlyDigits } from "@/lib/cpf";
import { maskEmail, maskPhone } from "@/lib/contact";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { nowOf, type DriverPrincipal, type ReqCtx } from "../context";
import { sendMessage } from "../messaging";
import { enforceLimit } from "./rateLimit";
import { authLog } from "./log";
import { createSession, findSession, revokeSession, SESSION_TTL } from "./sessions";

export const OTP_TTL_MIN = 10;
export const GENERIC_SENT =
  "Se o CPF estiver cadastrado e com treinamento liberado, enviamos um código de 6 dígitos para o telefone ou e-mail cadastrado.";

export const cpfLookupHash = (cpf: string) => hmacHex(onlyDigits(cpf), "cpf");
const codeHash = (challengeId: string, code: string) => hmacHex(`${challengeId}:${code}`, "otp");

type DriverAuthRow = { id: string; full_name: string; phone: string | null; email: string | null; status: string; anonymized_at: Date | null };

/** Motorista pode entrar se está ativo e tem ao menos uma convocação não bloqueada. */
async function driverHasAccess(tx: Tx, driverId: string): Promise<boolean> {
  const [r] = await tx<{ ok: boolean }[]>`select academy.driver_has_open_convocation(${driverId}) as ok`;
  return !!r?.ok;
}

function pickChannel(d: { phone: string | null; email: string | null }): { channel: "sms" | "email"; to: string; mask: string } | null {
  const pref = env.otpPreferred;
  const sms = d.phone ? { channel: "sms" as const, to: d.phone, mask: maskPhone(d.phone) } : null;
  const mail = d.email ? { channel: "email" as const, to: d.email, mask: maskEmail(d.email) } : null;
  return pref === "email" ? mail ?? sms : sms ?? mail;
}

export async function issueOtp(tx: Tx, driver: { id: string; phone: string | null; email: string | null }, purpose: "login" | "signature",
  ctx: { ip: string; now: Date }, sessionId?: string) {
  const dest = pickChannel(driver);
  if (!dest) throw new AppError("no_contact", "Não há telefone ou e-mail cadastrado. Procure a administração da BLINK.");
  const code = numericCode(6);
  const [c] = await tx<{ id: string }[]>`
    insert into otp_challenges (driver_id, purpose, code_hash, channel, destination_mask, expires_at, ip, session_id, created_at)
    values (${driver.id}, ${purpose}, 'pendente', ${dest.channel}, ${dest.mask},
            ${new Date(ctx.now.getTime() + OTP_TTL_MIN * 60000)}, ${ctx.ip}, ${sessionId ?? null}, ${ctx.now})
    returning id`;
  await tx`update otp_challenges set code_hash = ${codeHash(c.id, code)} where id = ${c.id}`;
  const what = purpose === "login" ? "acessar o treinamento" : "assinar o termo";
  await sendMessage(tx, {
    channel: dest.channel, to: dest.to, subject: "BLINK Academy — código de verificação",
    text: `BLINK Academy: seu código para ${what} é ${code}. Válido por ${OTP_TTL_MIN} minutos. Não compartilhe com ninguém.`,
  });
  return { challengeId: c.id, destinationMask: dest.mask };
}

/** Etapa 1 do login do motorista: CPF. Resposta igual para CPF existente ou não. */
export async function requestDriverLogin(cpfInput: string, ctx: ReqCtx) {
  const now = nowOf(ctx);
  const cpf = onlyDigits(cpfInput);
  if (!isValidCpf(cpf)) throw new AppError("invalid_cpf", "CPF inválido. Confira os números digitados.");
  const hash = cpfLookupHash(cpf);
  await asAuth(async (tx) => {
    await enforceLimit(tx, `drv-ip:${ctx.ip}`, 20, 3600, now);
    await enforceLimit(tx, `drv-cpf:${hash}`, 5, 900, now);
  });
  return asAuth(async (tx) => {
    const [d] = await tx<DriverAuthRow[]>`
      select id, full_name, phone, email, status, anonymized_at from drivers where cpf_hash = ${hash}`;
    const allowed = !!d && d.status === "active" && !d.anonymized_at && (await driverHasAccess(tx, d.id));
    if (!allowed) {
      // Desafio "falso": nenhum código é enviado e nenhum código será aceito.
      const [c] = await tx<{ id: string }[]>`
        insert into otp_challenges (driver_id, purpose, code_hash, channel, destination_mask, expires_at, ip, created_at)
        values (null, 'login', ${"x" + randomToken(16)}, 'sms', '', ${new Date(now.getTime() + OTP_TTL_MIN * 60000)}, ${ctx.ip}, ${now})
        returning id`;
      await authLog(tx, { subjectType: "driver", subjectId: d?.id ?? null, event: "driver_code_request", success: false, ip: ctx.ip, userAgent: ctx.userAgent,
        details: { reason: !d ? "cpf_not_found" : d.status !== "active" ? "blocked" : "no_open_convocation" } });
      return { challengeId: c.id, message: GENERIC_SENT };
    }
    const r = await issueOtp(tx, d, "login", { ip: ctx.ip, now });
    await authLog(tx, { subjectType: "driver", subjectId: d.id, event: "driver_code_request", success: true, ip: ctx.ip, userAgent: ctx.userAgent, details: { channel: r.destinationMask } });
    return { challengeId: r.challengeId, message: GENERIC_SENT };
  });
}

type OtpResult = { ok: true; driverId: string; challengeId: string } | { ok: false; error: AppError };

/** Confere o código. Não lança erro: o contador de tentativas precisa ser gravado. */
export async function consumeOtp(tx: Tx, challengeId: string, code: string, purpose: "login" | "signature", now: Date, sessionId?: string): Promise<OtpResult> {
  const fail = (m = "Código inválido ou expirado. Peça um novo código.") => ({ ok: false as const, error: new AppError("invalid_code", m, 401) });
  if (!/^[0-9a-f-]{36}$/i.test(challengeId ?? "")) return fail();
  const [c] = await tx<{ id: string; driver_id: string | null; purpose: string; code_hash: string; expires_at: Date; attempts: number; max_attempts: number; consumed_at: Date | null; session_id: string | null }[]>`
    select id, driver_id, purpose, code_hash, expires_at, attempts, max_attempts, consumed_at, session_id
    from otp_challenges where id = ${challengeId} for update`;
  if (!c || c.purpose !== purpose || c.consumed_at || c.expires_at <= now || c.attempts >= c.max_attempts) return fail();
  if (purpose === "signature" && c.session_id !== (sessionId ?? null)) return fail();
  await tx`update otp_challenges set attempts = attempts + 1 where id = ${c.id}`;
  const clean = (code ?? "").replace(/\D/g, "");
  if (!c.driver_id || clean.length !== 6 || !safeEqual(c.code_hash, codeHash(c.id, clean))) {
    const left = c.max_attempts - c.attempts - 1;
    return fail(left > 0 ? `Código incorreto. Você ainda tem ${left} tentativa(s).` : "Código bloqueado por excesso de tentativas. Peça um novo código.");
  }
  await tx`update otp_challenges set consumed_at = ${now} where id = ${c.id}`;
  return { ok: true, driverId: c.driver_id, challengeId: c.id };
}

/** Etapa 2 do login do motorista: código recebido. */
export async function verifyDriverLogin(challengeId: string, code: string, ctx: ReqCtx) {
  const now = nowOf(ctx);
  await asAuth((tx) => enforceLimit(tx, `drv-verify-ip:${ctx.ip}`, 40, 3600, now));
  const r = await asAuth(async (tx) => {
    const otp = await consumeOtp(tx, challengeId, code, "login", now);
    if (!otp.ok) {
      await authLog(tx, { subjectType: "driver", event: "driver_login", success: false, ip: ctx.ip, userAgent: ctx.userAgent, details: { reason: "invalid_code" } });
      return otp;
    }
    const [d] = await tx<DriverAuthRow[]>`select id, full_name, phone, email, status, anonymized_at from drivers where id = ${otp.driverId}`;
    if (!d || d.status !== "active" || d.anonymized_at || !(await driverHasAccess(tx, d.id))) {
      await authLog(tx, { subjectType: "driver", subjectId: otp.driverId, event: "driver_login", success: false, ip: ctx.ip, userAgent: ctx.userAgent, details: { reason: "blocked" } });
      return { ok: false as const, error: new AppError("blocked", "Seu acesso não está liberado. Entre em contato com a administração da BLINK.", 403) };
    }
    const s = await createSession(tx, "driver", d.id, { ip: ctx.ip, userAgent: ctx.userAgent, now }, { ttlSec: SESSION_TTL.driver, otpChallengeId: otp.challengeId });
    await authLog(tx, { subjectType: "driver", subjectId: d.id, event: "driver_login", success: true, ip: ctx.ip, userAgent: ctx.userAgent });
    return { ok: true as const, token: s.token, expiresAt: s.expiresAt, driverId: d.id };
  });
  if (!r.ok) throw r.error;
  return { token: r.token, expiresAt: r.expiresAt, driverId: r.driverId };
}

export async function getDriverByToken(token: string | undefined | null, now = new Date()): Promise<DriverPrincipal | null> {
  if (!token) return null;
  return asAuth(async (tx) => {
    const s = await findSession(tx, token, "driver", now);
    if (!s) return null;
    const [d] = await tx<DriverAuthRow[]>`select id, full_name, status, anonymized_at from drivers where id = ${s.subject_id}`;
    if (!d || d.status !== "active" || d.anonymized_at) return null;
    return { id: d.id, name: d.full_name, sessionId: s.id, otpChallengeId: s.otp_challenge_id };
  });
}

export async function driverLogout(token: string | undefined | null) {
  await asAuth((tx) => revokeSession(tx, token));
}
