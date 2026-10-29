import "server-only";
import type { Tx } from "@/lib/db";
import { randomToken, sha256Hex } from "@/lib/crypto";

export const SESSION_TTL = {
  admin: 8 * 3600,      // 8 horas
  admin_mfa: 10 * 60,   // 10 minutos para concluir o segundo fator
  driver: 12 * 3600,    // 12 horas (limitado também pelo prazo da convocação)
} as const;

export type SessionRow = {
  id: string; subject_type: "admin" | "admin_mfa" | "driver"; subject_id: string;
  expires_at: Date; revoked_at: Date | null; otp_challenge_id: string | null;
};

export async function createSession(tx: Tx, subjectType: SessionRow["subject_type"], subjectId: string,
  ctx: { ip: string; userAgent: string; now: Date }, opts: { ttlSec?: number; otpChallengeId?: string } = {}) {
  const token = randomToken(32);
  const expires = new Date(ctx.now.getTime() + (opts.ttlSec ?? SESSION_TTL[subjectType]) * 1000);
  const [s] = await tx<{ id: string }[]>`
    insert into sessions (token_hash, subject_type, subject_id, expires_at, ip, user_agent, otp_challenge_id, created_at, last_seen_at)
    values (${sha256Hex(token)}, ${subjectType}, ${subjectId}, ${expires}, ${ctx.ip}, ${ctx.userAgent.slice(0, 300)},
            ${opts.otpChallengeId ?? null}, ${ctx.now}, ${ctx.now})
    returning id`;
  return { token, sessionId: s.id, expiresAt: expires };
}

export async function findSession(tx: Tx, token: string | undefined | null, type: SessionRow["subject_type"], now: Date) {
  if (!token || token.length < 20) return null;
  const [s] = await tx<SessionRow[]>`
    select id, subject_type, subject_id, expires_at, revoked_at, otp_challenge_id
    from sessions where token_hash = ${sha256Hex(token)} and subject_type = ${type}`;
  if (!s || s.revoked_at || s.expires_at <= now) return null;
  await tx`update sessions set last_seen_at = ${now} where id = ${s.id}`;
  return s;
}

export async function revokeSession(tx: Tx, token: string | undefined | null) {
  if (!token) return;
  await tx`update sessions set revoked_at = now() where token_hash = ${sha256Hex(token)} and revoked_at is null`;
}
