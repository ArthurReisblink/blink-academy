import { NextResponse } from "next/server";
import { adminLogout } from "@/server/auth/admin";
import { COOKIES, assertSameOrigin, clearCookie, readCookie } from "@/server/web";

export async function POST(req: Request) {
  if (await assertSameOrigin(req)) {
    await adminLogout(await readCookie(COOKIES.admin));
    await clearCookie(COOKIES.admin);
  }
  return NextResponse.redirect(new URL("/admin/entrar", req.url), 303);
}
