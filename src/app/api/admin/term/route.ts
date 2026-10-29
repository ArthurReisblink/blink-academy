import { isAppError } from "@/lib/errors";
import { adminTermUrl } from "@/server/services/terms";
import { currentAdmin } from "@/server/web";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const admin = await currentAdmin();
  if (!admin) return new Response("Sessão expirada", { status: 401 });
  try {
    return Response.redirect(new URL(await adminTermUrl(admin, new URL(req.url).searchParams.get("id") ?? ""), req.url), 302);
  } catch (e) {
    return new Response(isAppError(e) ? e.message : "Falha ao abrir o termo", { status: isAppError(e) ? e.status : 500 });
  }
}
