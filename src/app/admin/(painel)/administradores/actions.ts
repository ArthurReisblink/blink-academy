"use server";
import { revalidatePath } from "next/cache";
import { createAdminBySuperadmin } from "@/server/auth/admin";
import { resetAdminAccess, setAdminActive, updateAdminRole } from "@/server/services/admin-tools";
import { reqCtx, requireAdmin, runAction, type ActionState } from "@/server/web";

export async function createAdminAction(_: ActionState, f: FormData): Promise<ActionState> {
  return runAction(async () => {
    await createAdminBySuperadmin(await requireAdmin(), { email: String(f.get("email") ?? ""), name: String(f.get("name") ?? ""), role: String(f.get("role") ?? "admin") as "admin", password: String(f.get("password") ?? "") }, await reqCtx());
    revalidatePath("/admin/administradores");
    return { ok: true, message: "Administrador criado. No primeiro acesso ele cadastra o autenticador (verificação em duas etapas)." };
  });
}
export async function roleAction(id: string, _: ActionState, f: FormData): Promise<ActionState> {
  return runAction(async () => {
    await updateAdminRole(await requireAdmin(), id, String(f.get("role") ?? ""), await reqCtx());
    revalidatePath("/admin/administradores");
    return { ok: true, message: "Perfil alterado. As sessões dele foram encerradas." };
  });
}
export async function activeAction(id: string, active: boolean, _: ActionState): Promise<ActionState> {
  return runAction(async () => {
    await setAdminActive(await requireAdmin(), id, active, await reqCtx());
    revalidatePath("/admin/administradores");
    return { ok: true, message: active ? "Administrador reativado." : "Administrador desativado e desconectado." };
  });
}
export async function resetAction(id: string, _: ActionState, f: FormData): Promise<ActionState> {
  return runAction(async () => {
    const password = String(f.get("password") ?? "");
    const resetTotp = f.get("totp") === "on";
    if (!password && !resetTotp) return { error: "Informe uma nova senha e/ou marque a redefinição do autenticador." };
    await resetAdminAccess(await requireAdmin(), id, { password: password || undefined, resetTotp }, await reqCtx());
    revalidatePath("/admin/administradores");
    return { ok: true, message: "Acesso redefinido. As sessões dele foram encerradas." };
  });
}
