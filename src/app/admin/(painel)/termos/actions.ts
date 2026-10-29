"use server";
import { revalidatePath } from "next/cache";
import { createModelTerm, setLegalApproval, setTermActive, uploadTerm } from "@/server/services/terms";
import { reqCtx, requireAdmin, runAction, type ActionState } from "@/server/web";

export async function uploadTermAction(_: ActionState, f: FormData): Promise<ActionState> {
  return runAction(async () => {
    const file = f.get("file");
    const buf = file instanceof File && file.size ? Buffer.from(await file.arrayBuffer()) : null;
    await uploadTerm(await requireAdmin(), { title: String(f.get("title") ?? ""), versionLabel: String(f.get("versionLabel") ?? ""), declaration: String(f.get("declaration") ?? "") }, buf, await reqCtx());
    revalidatePath("/admin/termos");
    return { ok: true, message: "Termo enviado. O arquivo e o SHA-256 ficam registrados e não podem ser alterados." };
  });
}

export async function modelTermAction(_: ActionState): Promise<ActionState> {
  return runAction(async () => {
    await createModelTerm(await requireAdmin(), "Na rota do treinamento — POD e PNR", await reqCtx());
    revalidatePath("/admin/termos");
    return { ok: true, message: "Termo-modelo gerado. Envie para revisão da área jurídica antes do uso oficial." };
  });
}

export async function toggleTermAction(id: string, active: boolean) {
  await setTermActive(await requireAdmin(), id, active, await reqCtx());
  revalidatePath("/admin/termos");
}

export async function legalAction(id: string, approved: boolean, _: ActionState, f: FormData): Promise<ActionState> {
  return runAction(async () => {
    await setLegalApproval(await requireAdmin(), id, approved, String(f.get("note") ?? ""), await reqCtx());
    revalidatePath("/admin/termos");
    return { ok: true, message: approved ? "Aprovação jurídica registrada." : "Aprovação jurídica removida." };
  });
}
