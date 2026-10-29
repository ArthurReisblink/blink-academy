import "server-only";
import { asAdmin, type Tx } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { AdminPrincipal, ReqCtx } from "../context";
import { assertCanWrite } from "../auth/admin";
import { auditLog } from "../auth/log";
import { computeStatus, type StatusInput } from "../domain/status";
import type { DeadlineInput } from "../domain/deadline";
import { currentPublishedVersion } from "./trainings";

export type ConvocationRow = StatusInput & {
  id: string; driver_id: string; training_id: string; training_version_id: string; base_id: string | null; pnr_reference: string | null;
  deadline_mode: "duration" | "until"; duration_hours: number | null; deadline_at: Date | null; start_mode: "activation" | "first_access";
  activated_at: Date; created_at: Date; blocked_reason: string | null;
  driver_name: string; cpf_mask: string; base_name: string | null; training_title: string; training_version: number;
  attempts_used: number; max_attempts: number; best_score: string | null; signed_at: Date | null;
};

export const withStatus = <T extends StatusInput>(r: T, now = new Date()) => ({ ...r, status: computeStatus(r, now) });

export async function convocationEvent(tx: Tx, convocationId: string, adminId: string | null, type: string, details: Record<string, unknown> = {}) {
  await tx`insert into convocation_events (convocation_id, admin_id, type, details) values (${convocationId}, ${adminId}, ${type}, ${tx.json(details as never)})`;
}

/** Existe convocação em aberto (não concluída, não cancelada e ainda no prazo) para este treinamento? */
async function openConvocationFor(tx: Tx, driverId: string, trainingId: string, now: Date) {
  const [c] = await tx<{ id: string }[]>`
    select id from convocations where driver_id = ${driverId} and training_id = ${trainingId}
      and cancelled_at is null and completed_at is null and (expires_at is null or expires_at > ${now})`;
  return c?.id ?? null;
}

export type NewConvocation = { driverId: string; trainingId: string; baseId?: string | null; pnrReference?: string | null; deadline: DeadlineInput };

export async function insertConvocation(tx: Tx, admin: AdminPrincipal, input: NewConvocation, now: Date) {
  const [t] = await tx<{ active: boolean; title: string }[]>`select active, title from trainings where id = ${input.trainingId}`;
  if (!t || !t.active) throw new AppError("training", "Treinamento não encontrado ou inativo.");
  const v = await currentPublishedVersion(tx, input.trainingId);
  if (!v) throw new AppError("training", `O treinamento "${t.title}" ainda não tem versão publicada.`);
  const open = await openConvocationFor(tx, input.driverId, input.trainingId, now);
  if (open) throw new AppError("duplicate", "Este motorista já tem uma convocação em aberto para esse treinamento. Prorrogue ou cancele a atual antes de criar outra.");
  const d = input.deadline;
  const [c] = await tx<{ id: string; expires_at: Date | null }[]>`
    insert into convocations (driver_id, training_id, training_version_id, base_id, pnr_reference, deadline_mode, duration_hours,
      deadline_at, start_mode, activated_at, created_by)
    values (${input.driverId}, ${input.trainingId}, ${v.id}, ${input.baseId ?? null}, ${input.pnrReference ?? null}, ${d.mode},
      ${d.mode === "duration" ? d.hours : null}, ${d.mode === "until" ? d.at : null},
      ${d.mode === "duration" ? d.startMode : "activation"}, ${now}, ${admin.id})
    returning id, expires_at`;
  await convocationEvent(tx, c.id, admin.id, "created", { training_version: v.version, deadline: d.mode === "duration" ? { hours: d.hours, start: d.startMode } : { until: d.at.toISOString() } });
  return c;
}

export async function createConvocation(admin: AdminPrincipal, input: NewConvocation, ctx: ReqCtx) {
  assertCanWrite(admin);
  const now = ctx.now ?? new Date();
  return asAdmin(admin, async (tx) => {
    const c = await insertConvocation(tx, admin, input, now);
    await auditLog(tx, admin.id, "convocation.create", "convocation", c.id, { driver_id: input.driverId, training_id: input.trainingId, pnr: input.pnrReference }, ctx.ip);
    return c;
  });
}

async function loadConv(tx: Tx, id: string) {
  const [c] = await tx<{ id: string; driver_id: string; expires_at: Date | null; blocked_at: Date | null; cancelled_at: Date | null; completed_at: Date | null; deadline_mode: string; duration_hours: number | null }[]>`
    select id, driver_id, expires_at, blocked_at, cancelled_at, completed_at, deadline_mode, duration_hours from convocations where id = ${id} for update`;
  if (!c) throw new AppError("not_found", "Convocação não encontrada.", 404);
  return c;
}

/**
 * Prorroga o prazo sem apagar nada do progresso.
 *  - { hours }: soma horas ao vencimento atual (ou a partir de agora, se já venceu).
 *    Se o prazo ainda não começou (conta a partir do 1º acesso), aumenta a duração.
 *  - { until }: define nova data e hora limite.
 */
export async function extendConvocation(admin: AdminPrincipal, id: string, ext: { hours: number } | { until: Date }, ctx: ReqCtx) {
  assertCanWrite(admin);
  const now = ctx.now ?? new Date();
  return asAdmin(admin, async (tx) => {
    const c = await loadConv(tx, id);
    if (c.completed_at || c.cancelled_at) throw new AppError("invalid", "Convocação concluída ou cancelada não pode ser prorrogada.");
    const before = c.expires_at;
    let row: { expires_at: Date | null };
    if ("until" in ext) {
      if (ext.until.getTime() <= now.getTime()) throw new AppError("deadline", "A nova data limite precisa estar no futuro.");
      [row] = await tx`update convocations set deadline_mode = 'until', deadline_at = ${ext.until} where id = ${id} returning expires_at`;
    } else {
      const h = Math.round(ext.hours);
      if (!(h >= 1 && h <= 8760)) throw new AppError("deadline", "Informe uma prorrogação entre 1 hora e 365 dias.");
      if (!c.expires_at) {
        [row] = await tx`update convocations set duration_hours = duration_hours + ${h} where id = ${id} returning expires_at`;
      } else {
        const base = c.expires_at.getTime() > now.getTime() ? c.expires_at : now;
        [row] = await tx`update convocations set deadline_mode = 'until', deadline_at = ${new Date(base.getTime() + h * 3600_000)} where id = ${id} returning expires_at`;
      }
    }
    await convocationEvent(tx, id, admin.id, "extended", { from: before?.toISOString() ?? null, to: row.expires_at?.toISOString() ?? null, ...("hours" in ext ? { hours: ext.hours } : {}) });
    await auditLog(tx, admin.id, "convocation.extend", "convocation", id, { from: before, to: row.expires_at }, ctx.ip);
    return row.expires_at;
  });
}

export async function setConvocationBlocked(admin: AdminPrincipal, id: string, blocked: boolean, reason: string | null, ctx: ReqCtx) {
  assertCanWrite(admin);
  await asAdmin(admin, async (tx) => {
    const c = await loadConv(tx, id);
    if (c.completed_at || c.cancelled_at) throw new AppError("invalid", "Convocação concluída ou cancelada.");
    await tx`update convocations set blocked_at = ${blocked ? new Date() : null}, blocked_reason = ${blocked ? reason : null} where id = ${id}`;
    await convocationEvent(tx, id, admin.id, blocked ? "blocked" : "unblocked", { reason });
    await auditLog(tx, admin.id, blocked ? "convocation.block" : "convocation.unblock", "convocation", id, { reason }, ctx.ip);
  });
}

export async function cancelConvocation(admin: AdminPrincipal, id: string, reason: string | null, ctx: ReqCtx) {
  assertCanWrite(admin);
  await asAdmin(admin, async (tx) => {
    const c = await loadConv(tx, id);
    if (c.completed_at) throw new AppError("invalid", "Convocação já concluída não pode ser cancelada.");
    if (c.cancelled_at) return;
    await tx`update convocations set cancelled_at = now() where id = ${id}`;
    await convocationEvent(tx, id, admin.id, "cancelled", { reason });
    await auditLog(tx, admin.id, "convocation.cancel", "convocation", id, { reason }, ctx.ip);
  });
}

export async function convocationsOfDriver(tx: Tx, driverId: string, now = new Date()) {
  const rows = await tx<ConvocationRow[]>`select * from convocation_overview where driver_id = ${driverId} order by created_at desc`;
  return rows.map((r) => withStatus(r, now));
}

export async function convocationEvents(tx: Tx, convocationId: string) {
  return tx<{ id: string; at: Date; type: string; details: Record<string, unknown>; admin_name: string | null }[]>`
    select e.id, e.at, e.type, e.details, a.name as admin_name
    from convocation_events e left join admins a on a.id = e.admin_id
    where e.convocation_id = ${convocationId} order by e.at, e.id`;
}
