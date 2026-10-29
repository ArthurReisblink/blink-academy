"use server";
import { revalidatePath } from "next/cache";
import { revokeCertificate } from "@/server/services/signatures";
import { reqCtx, requireAdmin, runAction, type ActionState } from "@/server/web";

export async function revokeAction(convId: string, _: ActionState, f: FormData): Promise<ActionState> {
  return runAction(async () => {
    await revokeCertificate(await requireAdmin(), convId, String(f.get("reason") ?? ""), await reqCtx());
    revalidatePath("/admin/assinaturas");
    return { ok: true, message: "Comprovante revogado. A verificação pública passa a mostrar a revogação." };
  });
}
