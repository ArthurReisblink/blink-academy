"use server";
import { redirect } from "next/navigation";
import { requestDriverLogin, verifyDriverLogin } from "@/server/auth/driver";
import { COOKIES, clearCookie, readCookie, reqCtx, runAction, setCookie, type ActionState } from "@/server/web";

export async function cpfAction(_: ActionState, form: FormData): Promise<ActionState> {
  const res = await runAction(async () => {
    const r = await requestDriverLogin(String(form.get("cpf") ?? ""), await reqCtx());
    await setCookie(COOKIES.otp, r.challengeId, new Date(Date.now() + 15 * 60000));
    return { ok: true };
  });
  if (res?.ok) redirect("/m/codigo");
  return res;
}

export async function codeAction(_: ActionState, form: FormData): Promise<ActionState> {
  const res = await runAction(async () => {
    const challenge = await readCookie(COOKIES.otp);
    if (!challenge) return { error: "O código expirou. Volte e informe o CPF novamente." };
    const r = await verifyDriverLogin(challenge, String(form.get("code") ?? ""), await reqCtx());
    await clearCookie(COOKIES.otp);
    await setCookie(COOKIES.driver, r.token, r.expiresAt);
    return { ok: true };
  });
  if (res?.ok) redirect("/m");
  return res;
}
