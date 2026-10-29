"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createTraining, publishVersion, updateTraining } from "@/server/services/trainings";
import { reqCtx, requireAdmin, runAction, type ActionState } from "@/server/web";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function createTrainingAction(_: ActionState, f: FormData): Promise<ActionState> {
  let id = "";
  const r = await runAction(async () => {
    id = (await createTraining(await requireAdmin(), { title: s(f, "title"), description: s(f, "description") }, await reqCtx())).trainingId;
  });
  if (r?.ok && id) redirect(`/admin/treinamentos/${id}`);
  return r;
}

export async function updateTrainingAction(id: string, _: ActionState, f: FormData): Promise<ActionState> {
  return runAction(async () => {
    await updateTraining(await requireAdmin(), id, { title: s(f, "title"), description: s(f, "description"), active: f.get("active") === "on" }, await reqCtx());
    revalidatePath(`/admin/treinamentos/${id}`);
    return { ok: true, message: "Treinamento atualizado." };
  });
}

export async function publishVersionAction(trainingId: string, versionId: string, _: ActionState): Promise<ActionState> {
  return runAction(async () => {
    await publishVersion(await requireAdmin(), versionId, await reqCtx());
    revalidatePath(`/admin/treinamentos/${trainingId}`);
    return { ok: true, message: "Versão publicada. Novas convocações usarão esta versão; as anteriores continuam na versão em que foram feitas." };
  });
}

import { addVideoToVersion, moveVideo, removeVideoFromVersion, setVideoRules } from "@/server/services/videos";
import { createDraftVersion } from "@/server/services/trainings";

export async function newVersionAction(trainingId: string, _: ActionState): Promise<ActionState> {
  return runAction(async () => {
    await createDraftVersion(await requireAdmin(), trainingId, await reqCtx());
    revalidatePath(`/admin/treinamentos/${trainingId}`);
    return { ok: true, message: "Nova versão em rascunho criada com o mesmo conteúdo. Faça as alterações e publique." };
  });
}

export async function addVideoAction(trainingId: string, versionId: string, _: ActionState, f: FormData): Promise<ActionState> {
  return runAction(async () => {
    await addVideoToVersion(await requireAdmin(), versionId, s(f, "videoId"), await reqCtx());
    revalidatePath(`/admin/treinamentos/${trainingId}`);
    return { ok: true };
  });
}

export async function removeVideoAction(trainingId: string, versionId: string, videoId: string): Promise<void> {
  await removeVideoFromVersion(await requireAdmin(), versionId, videoId, await reqCtx());
  revalidatePath(`/admin/treinamentos/${trainingId}`);
}

export async function moveVideoAction(trainingId: string, versionId: string, videoId: string, dir: "up" | "down"): Promise<void> {
  await moveVideo(await requireAdmin(), versionId, videoId, dir, await reqCtx());
  revalidatePath(`/admin/treinamentos/${trainingId}`);
}

export async function videoRulesAction(trainingId: string, versionId: string, videoId: string, _: ActionState, f: FormData): Promise<ActionState> {
  return runAction(async () => {
    await setVideoRules(await requireAdmin(), versionId, videoId, { required: f.get("required") === "on", completionPct: Number(s(f, "pct")) }, await reqCtx());
    revalidatePath(`/admin/treinamentos/${trainingId}`);
    return { ok: true, message: "Regras salvas." };
  });
}

import { setVersionExam } from "@/server/services/exams";

export async function setExamAction(trainingId: string, versionId: string, _: ActionState, f: FormData): Promise<ActionState> {
  return runAction(async () => {
    const examId = String(f.get("examId") ?? "") || null;
    await setVersionExam(await requireAdmin(), versionId, examId, await reqCtx());
    revalidatePath(`/admin/treinamentos/${trainingId}`);
    return { ok: true, message: examId ? "Prova vinculada à versão." : "Prova removida da versão." };
  });
}

import { setVersionTerm } from "@/server/services/terms";

export async function setTermAction(trainingId: string, versionId: string, _: ActionState, f: FormData): Promise<ActionState> {
  return runAction(async () => {
    const termId = String(f.get("termId") ?? "") || null;
    await setVersionTerm(await requireAdmin(), versionId, termId, await reqCtx());
    revalidatePath(`/admin/treinamentos/${trainingId}`);
    return { ok: true, message: termId ? "Termo vinculado à versão." : "Termo removido da versão." };
  });
}
