import "server-only";
import type { Tx } from "@/lib/db";

export async function authLog(tx: Tx, e: {
  subjectType?: string | null; subjectId?: string | null; event: string; success: boolean;
  ip?: string; userAgent?: string; details?: Record<string, unknown>;
}) {
  await tx`insert into auth_log (subject_type, subject_id, event, success, ip, user_agent, details)
    values (${e.subjectType ?? null}, ${e.subjectId ?? null}, ${e.event}, ${e.success}, ${e.ip ?? null},
            ${(e.userAgent ?? "").slice(0, 300)}, ${tx.json((e.details ?? {}) as never)})`;
}

export async function auditLog(tx: Tx, adminId: string, action: string, entity: string, entityId: string | null,
  details: Record<string, unknown> = {}, ip?: string) {
  await tx`insert into admin_audit_log (admin_id, action, entity, entity_id, details, ip)
    values (${adminId}, ${action}, ${entity}, ${entityId}, ${tx.json(details as never)}, ${ip ?? null})`;
}
