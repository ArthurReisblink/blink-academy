"use server";
import { revalidatePath } from "next/cache";
import { createBase, setBaseActive } from "@/server/services/bases";
import { reqCtx, requireAdmin, runAction, type ActionState } from "@/server/web";

export async function createBaseAction(_: ActionState, f: FormData): Promise<ActionState> {
  return runAction(async () => {
    await createBase(await requireAdmin(), String(f.get("name") ?? ""), await reqCtx());
    revalidatePath("/admin/configuracoes");
    return { ok: true, message: "Base cadastrada." };
  });
}

export async function toggleBaseAction(id: string, active: boolean): Promise<void> {
  await setBaseActive(await requireAdmin(), id, active, await reqCtx());
  revalidatePath("/admin/configuracoes");
}

import { runRetention, updateSettings } from "@/server/services/admin-tools";
import { AppError } from "@/lib/errors";

const num = (f: FormData, k: string) => Number(String(f.get(k) ?? "").replace(",", "."));

export async function retentionAction(_: ActionState, f: FormData): Promise<ActionState> {
  return runAction(async () => {
    await updateSettings(await requireAdmin(), "retention", { auth_log_days: num(f, "auth_log_days"), otp_days: num(f, "otp_days"), sessions_days: num(f, "sessions_days"), video_events_days: num(f, "video_events_days") }, await reqCtx());
    revalidatePath("/admin/configuracoes");
    return { ok: true, message: "Prazos de retenção salvos." };
  });
}

export async function defaultsAction(_: ActionState, f: FormData): Promise<ActionState> {
  return runAction(async () => {
    await updateSettings(await requireAdmin(), "defaults", { video_completion_pct: num(f, "video_completion_pct"), pass_pct: num(f, "pass_pct"), max_attempts: num(f, "max_attempts"), question_count: num(f, "question_count") }, await reqCtx());
    revalidatePath("/admin/configuracoes");
    return { ok: true, message: "Padrões salvos. Valem para novos vídeos em versões e novas provas." };
  });
}

export async function runRetentionAction(_: ActionState): Promise<ActionState> {
  return runAction(async () => {
    const a = await requireAdmin();
    if (a.role !== "superadmin") throw new AppError("forbidden", "Apenas o superadministrador.", 403);
    const d = await runRetention();
    revalidatePath("/admin/configuracoes");
    return { ok: true, message: `Retenção executada: ${Object.entries(d).map(([k, v]) => `${k}=${v}`).join(", ")}.` };
  });
}
