"use server";
import { redirect } from "next/navigation";
import { adminPasswordLogin, adminTotpVerify } from "@/server/auth/admin";
import { COOKIES, clearCookie, readCookie, reqCtx, runAction, setCookie, type ActionState } from "@/server/web";

export async function loginAction(_: ActionState, form: FormData): Promise<ActionState> {
  const res = await runAction(async () => {
    const r = await adminPasswordLogin(String(form.get("email") ?? ""), String(form.get("password") ?? ""), await reqCtx());
    await setCookie(COOKIES.adminMfa, r.mfaToken, new Date(Date.now() + 10 * 60000));
    return { ok: true };
  });
  if (res?.ok) redirect("/admin/verificacao");
  return res;
}

export async function totpAction(_: ActionState, form: FormData): Promise<ActionState> {
  const res = await runAction(async () => {
    const mfa = await readCookie(COOKIES.adminMfa);
    if (!mfa) return { error: "Sua etapa de verificação expirou. Entre novamente." };
    const r = await adminTotpVerify(mfa, String(form.get("code") ?? ""), await reqCtx());
    await clearCookie(COOKIES.adminMfa);
    await setCookie(COOKIES.admin, r.token, r.expiresAt);
    return { ok: true };
  });
  if (res?.ok) redirect("/admin");
  return res;
}
