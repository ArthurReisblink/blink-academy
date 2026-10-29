import { NextResponse, type NextRequest } from "next/server";

// Barreira leve: sem cookie de sessão, nem chega a renderizar áreas restritas.
// A validação real da sessão acontece no servidor em cada página e ação.
const ADMIN_PUBLIC = ["/admin/entrar", "/admin/verificacao"];
const DRIVER_PUBLIC = ["/m/entrar", "/m/codigo"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/admin") && !ADMIN_PUBLIC.some((p) => pathname.startsWith(p)) && pathname !== "/admin/sair") {
    if (!req.cookies.get("ba_adm")) return NextResponse.redirect(new URL("/admin/entrar", req.url));
  }
  if (pathname.startsWith("/m") && !DRIVER_PUBLIC.some((p) => pathname.startsWith(p)) && pathname !== "/m/sair") {
    if (!req.cookies.get("ba_drv")) return NextResponse.redirect(new URL("/m/entrar", req.url));
  }
  const res = NextResponse.next();
  if (pathname.startsWith("/admin") || pathname.startsWith("/m") || pathname.startsWith("/api")) {
    res.headers.set("Cache-Control", "no-store, max-age=0");
  }
  return res;
}

export const config = { matcher: ["/admin/:path*", "/m/:path*", "/api/:path*"] };
