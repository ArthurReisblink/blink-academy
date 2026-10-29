import "server-only";
import { z } from "zod";
import { asAdmin, asMaintenance } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { AdminPrincipal, ReqCtx } from "../context";
import { assertCanWrite, assertSuperadmin } from "../auth/admin";
import { hashPassword, passwordProblems } from "../auth/password";
import { auditLog } from "../auth/log";
import { parse } from "./common";

// =====================================================================
// Auditoria
// =====================================================================
export type AuditFilters = { kind?: "admin" | "auth"; q?: string; from?: string; to?: string; page?: number };
const dayStart = (s: string) => new Date(`${s}T00:00:00-03:00`);
const okDay = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export async function listAudit(admin: AdminPrincipal, f: AuditFilters) {
  const page = Math.max(1, f.page ?? 1), size = 100;
  const q = (f.q ?? "").trim();
  return asAdmin(admin, async (tx) => {
    if (f.kind === "auth") {
      const rows = await tx<{ id: number; at: Date; subject_type: string | null; subject_id: string | null; event: string; success: boolean; ip: string | null; user_agent: string | null; details: Record<string, unknown>; subject_name: string | null }[]>`
        select l.*, coalesce(a.name, d.full_name) as subject_name from auth_log l
        left join admins a on l.subject_type in ('admin', 'admin_mfa') and a.id = l.subject_id
        left join drivers d on l.subject_type = 'driver' and d.id = l.subject_id
        where true
          ${okDay(f.from) ? tx`and l.at >= ${dayStart(f.from!)}` : tx``}
          ${okDay(f.to) ? tx`and l.at < ${new Date(dayStart(f.to!).getTime() + 86_400_000)}` : tx``}
          ${q ? tx`and (l.event ilike ${"%" + q + "%"} or l.ip = ${q} or coalesce(a.name, d.full_name, '') ilike ${"%" + q + "%"})` : tx``}
        order by l.at desc limit ${size + 1} offset ${(page - 1) * size}`;
      return { kind: "auth" as const, page, hasMore: rows.length > size, auth: rows.slice(0, size), admin: [] };
    }
    const rows = await tx<{ id: number; at: Date; admin_id: string | null; admin_name: string | null; action: string; entity: string; entity_id: string | null; details: Record<string, unknown>; ip: string | null }[]>`
      select l.*, a.name as admin_name from admin_audit_log l left join admins a on a.id = l.admin_id
      where true
        ${okDay(f.from) ? tx`and l.at >= ${dayStart(f.from!)}` : tx``}
        ${okDay(f.to) ? tx`and l.at < ${new Date(dayStart(f.to!).getTime() + 86_400_000)}` : tx``}
        ${q ? tx`and (l.action ilike ${"%" + q + "%"} or l.entity ilike ${"%" + q + "%"} or coalesce(a.name, '') ilike ${"%" + q + "%"} or l.entity_id = ${q})` : tx``}
      order by l.at desc limit ${size + 1} offset ${(page - 1) * size}`;
    return { kind: "admin" as const, page, hasMore: rows.length > size, admin: rows.slice(0, size), auth: [] };
  });
}

// =====================================================================
// Administradores (somente superadmin altera)
// =====================================================================
export type AdminRow = { id: string; email: string; name: string; role: AdminPrincipal["role"]; active: boolean; totp_enabled_at: Date | null;
  last_login_at: Date | null; locked_until: Date | null; failed_logins: number; created_at: Date };

export async function listAdmins(admin: AdminPrincipal) {
  return asAdmin(admin, (tx) => tx<AdminRow[]>`
    select id, email, name, role, active, totp_enabled_at, last_login_at, locked_until, failed_logins, created_at from admins order by active desc, name`);
}

const roleSchema = z.enum(["superadmin", "admin", "auditor"]);

async function guardLastSuperadmin(admin: AdminPrincipal, targetId: string, change: { role?: string; active?: boolean }) {
  return asAdmin(admin, async (tx) => {
    const [t] = await tx<{ role: string; active: boolean }[]>`select role, active from admins where id = ${targetId}`;
    if (!t) throw new AppError("not_found", "Administrador não encontrado.", 404);
    const losing = t.role === "superadmin" && t.active && ((change.role && change.role !== "superadmin") || change.active === false);
    if (losing) {
      const [{ n }] = await tx<{ n: number }[]>`select count(*)::int as n from admins where role = 'superadmin' and active and id <> ${targetId}`;
      if (n === 0) throw new AppError("last_superadmin", "Deve existir ao menos um superadministrador ativo.");
    }
  });
}

export async function updateAdminRole(admin: AdminPrincipal, id: string, role: string, ctx: ReqCtx) {
  assertSuperadmin(admin);
  const r = parse(roleSchema, role);
  await guardLastSuperadmin(admin, id, { role: r });
  await asAdmin(admin, async (tx) => {
    await tx`update admins set role = ${r} where id = ${id}`;
    await tx`update sessions set revoked_at = now() where subject_id = ${id} and subject_type in ('admin', 'admin_mfa') and revoked_at is null`;
    await auditLog(tx, admin.id, "admin.role", "admin", id, { role: r }, ctx.ip);
  });
}

export async function setAdminActive(admin: AdminPrincipal, id: string, active: boolean, ctx: ReqCtx) {
  assertSuperadmin(admin);
  if (id === admin.id && !active) throw new AppError("self", "Você não pode desativar a si mesmo.");
  await guardLastSuperadmin(admin, id, { active });
  await asAdmin(admin, async (tx) => {
    await tx`update admins set active = ${active}, failed_logins = 0, locked_until = null where id = ${id}`;
    if (!active) await tx`update sessions set revoked_at = now() where subject_id = ${id} and subject_type in ('admin', 'admin_mfa') and revoked_at is null`;
    await auditLog(tx, admin.id, active ? "admin.activate" : "admin.deactivate", "admin", id, {}, ctx.ip);
  });
}

/** Nova senha provisória e/ou nova configuração do autenticador (ex.: celular perdido). */
export async function resetAdminAccess(admin: AdminPrincipal, id: string, o: { password?: string; resetTotp?: boolean }, ctx: ReqCtx) {
  assertSuperadmin(admin);
  if (o.password) {
    const p = passwordProblems(o.password);
    if (p.length) throw new AppError("weak_password", `A senha precisa ter ${p.join(", ")}.`);
  }
  const hash = o.password ? await hashPassword(o.password) : null;
  await asAdmin(admin, async (tx) => {
    const r = await tx`update admins set
      password_hash = coalesce(${hash}, password_hash),
      totp_secret_enc = case when ${!!o.resetTotp} then null else totp_secret_enc end,
      totp_enabled_at = case when ${!!o.resetTotp} then null else totp_enabled_at end,
      totp_last_step = case when ${!!o.resetTotp} then null else totp_last_step end,
      failed_logins = 0, locked_until = null
      where id = ${id} returning id`;
    if (!r.length) throw new AppError("not_found", "Administrador não encontrado.", 404);
    await tx`update sessions set revoked_at = now() where subject_id = ${id} and subject_type in ('admin', 'admin_mfa') and revoked_at is null`;
    await auditLog(tx, admin.id, "admin.reset_access", "admin", id, { password: !!o.password, totp: !!o.resetTotp }, ctx.ip);
  });
}

// =====================================================================
// Configurações: retenção e padrões
// =====================================================================
export type Retention = { auth_log_days: number; otp_days: number; sessions_days: number; video_events_days: number };
export type Defaults = { video_completion_pct: number; pass_pct: number; max_attempts: number; question_count: number };

export async function getSettings(admin: AdminPrincipal) {
  const rows = await asAdmin(admin, (tx) => tx<{ key: string; value: unknown; updated_at: Date }[]>`select key, value, updated_at from settings`);
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return { retention: m.retention as Retention, defaults: m.defaults as Defaults, lastRetention: (m.retention_last_run ?? null) as { at: string; deleted: Record<string, number> } | null };
}

const retentionSchema = z.object({
  auth_log_days: z.number().int().min(30, "Mínimo de 30 dias.").max(3650),
  otp_days: z.number().int().min(1).max(365),
  sessions_days: z.number().int().min(1).max(365),
  video_events_days: z.number().int().min(30, "Mínimo de 30 dias.").max(3650),
});
const defaultsSchema = z.object({
  video_completion_pct: z.number().int().min(50).max(100),
  pass_pct: z.number().min(1).max(100),
  max_attempts: z.number().int().min(1).max(20),
  question_count: z.number().int().min(1).max(100),
});

export async function updateSettings(admin: AdminPrincipal, key: "retention" | "defaults", value: unknown, ctx: ReqCtx) {
  assertCanWrite(admin);
  if (key === "retention") assertSuperadmin(admin);
  const v = key === "retention" ? parse(retentionSchema, value) : parse(defaultsSchema, value);
  await asAdmin(admin, async (tx) => {
    await tx`insert into settings (key, value, updated_by) values (${key}, ${tx.json(v as never)}, ${admin.id})
      on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by`;
    await auditLog(tx, admin.id, "settings.update", "settings", key, v, ctx.ip);
  });
}

/**
 * Rotina de retenção (agendada diariamente). Remove registros técnicos antigos.
 * Assinaturas, comprovantes, tentativas e histórico das convocações NÃO são apagados:
 * são a prova do treinamento. Códigos usados em assinaturas também são mantidos.
 */
export async function runRetention(now = new Date()) {
  return asMaintenance(async (tx) => {
    const [s] = await tx<{ value: Retention }[]>`select value from settings where key = 'retention'`;
    const r = s?.value ?? { auth_log_days: 365, otp_days: 30, sessions_days: 30, video_events_days: 365 };
    const ago = (days: number) => new Date(now.getTime() - days * 86_400_000);
    const deleted: Record<string, number> = {};
    deleted.auth_log = (await tx`delete from auth_log where at < ${ago(r.auth_log_days)}`).count;
    deleted.otp_challenges = (await tx`delete from otp_challenges o where o.created_at < ${ago(r.otp_days)}
      and not exists (select 1 from signatures s where s.otp_challenge_id = o.id)`).count;
    deleted.sessions = (await tx`delete from sessions where expires_at < ${ago(r.sessions_days)}`).count;
    deleted.rate_limits = (await tx`delete from rate_limits where window_start < ${ago(2)}`).count;
    deleted.video_events = (await tx`delete from video_events where at < ${ago(r.video_events_days)}`).count;
    deleted.dev_outbox = (await tx`delete from dev_outbox where at < ${ago(7)}`).count;
    await tx`insert into settings (key, value) values ('retention_last_run', ${tx.json({ at: now.toISOString(), deleted } as never)})
      on conflict (key) do update set value = excluded.value, updated_at = now()`;
    await tx`insert into admin_audit_log (admin_id, action, entity, details) values (null, 'retention.run', 'system', ${tx.json(deleted as never)})`;
    return deleted;
  });
}
