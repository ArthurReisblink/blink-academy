"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseDeadlineForm } from "@/server/domain/deadline";
import { parseSaoPauloLocal } from "@/lib/time";
import { AppError } from "@/lib/errors";
import { anonymizeDriver, createDriver, importDriversCsv, revealCpf, setDriverStatus, updateDriver } from "@/server/services/drivers";
import { cancelConvocation, createConvocation, extendConvocation, setConvocationBlocked } from "@/server/services/convocations";
import { reqCtx, requireAdmin, runAction, type ActionState } from "@/server/web";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const driverData = (f: FormData) => ({ fullName: s(f, "fullName"), cpf: s(f, "cpf"), phone: s(f, "phone"), email: s(f, "email"), baseId: s(f, "baseId"), notes: s(f, "notes") });
const deadline = (f: FormData) => parseDeadlineForm({ preset: s(f, "preset"), customValue: s(f, "customValue"), customUnit: s(f, "customUnit"), until: s(f, "until"), startMode: s(f, "startMode") });

export async function createDriverAction(_: ActionState, f: FormData): Promise<ActionState> {
  let id = "";
  const r = await runAction(async () => {
    const admin = await requireAdmin();
    const convocate = s(f, "trainingId");
    const res = await createDriver(admin, driverData(f), convocate ? { trainingId: convocate, pnrReference: s(f, "pnrReference") || null, deadline: deadline(f) } : null, await reqCtx());
    id = res.id;
  });
  if (r?.ok && id) redirect(`/admin/motoristas/${id}?criado=1`);
  return r;
}

export async function updateDriverAction(id: string, _: ActionState, f: FormData): Promise<ActionState> {
  return runAction(async () => {
    await updateDriver(await requireAdmin(), id, driverData(f), await reqCtx());
    revalidatePath(`/admin/motoristas/${id}`);
    return { ok: true, message: "Dados atualizados." };
  });
}

export async function driverStatusAction(id: string, status: "active" | "blocked"): Promise<void> {
  await setDriverStatus(await requireAdmin(), id, status, await reqCtx());
  revalidatePath(`/admin/motoristas/${id}`);
}

export async function revealCpfAction(id: string, _: ActionState): Promise<ActionState> {
  return runAction(async () => ({ ok: true, message: `CPF: ${await revealCpf(await requireAdmin(), id, await reqCtx())} (consulta registrada na auditoria)` }));
}

export async function anonymizeAction(id: string, _: ActionState, f: FormData): Promise<ActionState> {
  return runAction(async () => {
    if (s(f, "confirm") !== "ANONIMIZAR") throw new AppError("confirm", "Digite ANONIMIZAR para confirmar.");
    await anonymizeDriver(await requireAdmin(), id, await reqCtx());
    revalidatePath(`/admin/motoristas/${id}`);
    return { ok: true, message: "Dados pessoais removidos. Os registros de treinamento foram mantidos." };
  });
}

export async function newConvocationAction(driverId: string, _: ActionState, f: FormData): Promise<ActionState> {
  return runAction(async () => {
    await createConvocation(await requireAdmin(), { driverId, trainingId: s(f, "trainingId"), baseId: s(f, "baseId") || null, pnrReference: s(f, "pnrReference") || null, deadline: deadline(f) }, await reqCtx());
    revalidatePath(`/admin/motoristas/${driverId}`);
    return { ok: true, message: "Convocação criada." };
  });
}

export async function extendAction(driverId: string, convId: string, _: ActionState, f: FormData): Promise<ActionState> {
  return runAction(async () => {
    const mode = s(f, "extMode");
    const ext = mode === "until" ? { until: parseSaoPauloLocal(s(f, "until")) } : { hours: Number(mode === "custom" ? s(f, "hours") : mode) };
    await extendConvocation(await requireAdmin(), convId, ext, await reqCtx());
    revalidatePath(`/admin/motoristas/${driverId}`);
    return { ok: true, message: "Prazo prorrogado. O progresso do motorista foi mantido." };
  });
}

export async function blockConvAction(driverId: string, convId: string, blocked: boolean, _: ActionState, f: FormData): Promise<ActionState> {
  return runAction(async () => {
    await setConvocationBlocked(await requireAdmin(), convId, blocked, s(f, "reason") || null, await reqCtx());
    revalidatePath(`/admin/motoristas/${driverId}`);
    return { ok: true, message: blocked ? "Acesso bloqueado." : "Acesso reativado." };
  });
}

export async function cancelConvAction(driverId: string, convId: string, _: ActionState, f: FormData): Promise<ActionState> {
  return runAction(async () => {
    await cancelConvocation(await requireAdmin(), convId, s(f, "reason") || null, await reqCtx());
    revalidatePath(`/admin/motoristas/${driverId}`);
    return { ok: true, message: "Convocação cancelada." };
  });
}

export async function importCsvAction(_: ActionState, f: FormData): Promise<ActionState> {
  return runAction(async () => {
    const admin = await requireAdmin();
    const file = f.get("file");
    if (!(file instanceof File) || file.size === 0) throw new AppError("csv", "Selecione o arquivo CSV.");
    if (file.size > 2_000_000) throw new AppError("csv", "Arquivo muito grande (máximo 2 MB).");
    const buf = Buffer.from(await file.arrayBuffer());
    let text = buf.toString("utf8");
    if (text.includes("�")) text = new TextDecoder("windows-1252").decode(buf); // CSV salvo pelo Excel
    const trainingId = s(f, "trainingId");
    const results = await importDriversCsv(admin, text, trainingId ? { trainingId, deadline: deadline(f) } : null, await reqCtx());
    revalidatePath("/admin/motoristas");
    return { ok: true, data: results };
  });
}
