import { NextResponse } from "next/server";
import { driverLogout } from "@/server/auth/driver";
import { COOKIES, assertSameOrigin, clearCookie, readCookie } from "@/server/web";

export async function POST(req: Request) {
  if (await assertSameOrigin(req)) {
    await driverLogout(await readCookie(COOKIES.driver));
    await clearCookie(COOKIES.driver);
  }
  return NextResponse.redirect(new URL("/m/entrar", req.url), 303);
}
