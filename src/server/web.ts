import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { isAppError } from "@/lib/errors";
import { env } from "@/lib/env";
import type { AdminPrincipal, DriverPrincipal, ReqCtx } from "./context";
import { getAdminByToken } from "./auth/admin";
import { getDriverByToken } from "./auth/driver";

export const COOKIES = {
  admin: "ba_adm",
  adminMfa: "ba_mfa",
  driver: "ba_drv",
  otp: "ba_otp",
} as const;

export async function reqCtx(): Promise<ReqCtx> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return { ip: fwd || h.get("x-real-ip") || "0.0.0.0", userAgent: h.get("user-agent") ?? "" };
}

export async function setCookie(name: string, value: string, expires: Date) {
  (await cookies()).set(name, value, {
    httpOnly: true, secure: env.isProduction, sameSite: "lax", path: "/", expires,
  });
}
export async function clearCookie(name: string) {
  (await cookies()).set(name, "", { httpOnly: true, secure: env.isProduction, sameSite: "lax", path: "/", maxAge: 0 });
}
export async function readCookie(name: string) {
  return (await cookies()).get(name)?.value;
}

export async function currentAdmin(): Promise<AdminPrincipal | null> {
  return getAdminByToken(await readCookie(COOKIES.admin));
}
export async function requireAdmin(): Promise<AdminPrincipal> {
  const a = await currentAdmin();
  if (!a) redirect("/admin/entrar");
  return a;
}
export async function currentDriver(): Promise<DriverPrincipal | null> {
  return getDriverByToken(await readCookie(COOKIES.driver));
}
export async function requireDriver(): Promise<DriverPrincipal> {
  const d = await currentDriver();
  if (!d) redirect("/m/entrar");
  return d;
}

export type ActionState = { ok?: boolean; error?: string; message?: string; fieldErrors?: Record<string, string>; data?: unknown } | null;

/** Converte erros de regra de negócio em mensagem para o formulário; erros inesperados viram mensagem genérica. */
export async function runAction(fn: () => Promise<ActionState | void>): Promise<ActionState> {
  try {
    return (await fn()) ?? { ok: true };
  } catch (e) {
    if (isAppError(e)) return { error: e.message };
    // redirect() do Next.js lança um erro especial que precisa seguir adiante
    if (e && typeof e === "object" && "digest" in e && String((e as { digest: string }).digest).startsWith("NEXT_")) throw e;
    console.error(e);
    return { error: "Não foi possível concluir a operação. Tente novamente." };
  }
}

/** Verificação de origem para rotas de API que recebem POST do navegador. */
export async function assertSameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin || !host) return false;
  try { return new URL(origin).host === host; } catch { return false; }
}
