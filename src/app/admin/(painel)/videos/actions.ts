"use server";
import { revalidatePath } from "next/cache";
import { adminVideoPreviewUrl, deleteVideo, finishVideoUpload, startVideoUpload, updateVideo } from "@/server/services/videos";
import { reqCtx, requireAdmin, runAction, type ActionState } from "@/server/web";

export async function startUploadAction(input: { title: string; description: string; contentType: string; size: number; duration: number }): Promise<ActionState> {
  return runAction(async () => ({ ok: true, data: await startVideoUpload(await requireAdmin(), input, await reqCtx()) }));
}

export async function finishUploadAction(videoId: string): Promise<ActionState> {
  return runAction(async () => {
    await finishVideoUpload(await requireAdmin(), videoId, await reqCtx());
    revalidatePath("/admin/videos");
    return { ok: true };
  });
}

export async function updateVideoAction(id: string, _: ActionState, f: FormData): Promise<ActionState> {
  return runAction(async () => {
    await updateVideo(await requireAdmin(), id, { title: String(f.get("title") ?? ""), description: String(f.get("description") ?? "") }, await reqCtx());
    revalidatePath("/admin/videos");
    return { ok: true, message: "Salvo." };
  });
}

export async function deleteVideoAction(id: string, _: ActionState): Promise<ActionState> {
  return runAction(async () => {
    await deleteVideo(await requireAdmin(), id, await reqCtx());
    revalidatePath("/admin/videos");
    return { ok: true, message: "Vídeo excluído." };
  });
}

export async function previewUrlAction(id: string): Promise<ActionState> {
  return runAction(async () => ({ ok: true, data: await adminVideoPreviewUrl(await requireAdmin(), id) }));
}
