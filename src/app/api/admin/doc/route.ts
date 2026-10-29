import { isAppError } from "@/lib/errors";
import { adminDocumentUrl, type DocKind } from "@/server/services/signatures";
import { currentAdmin, reqCtx } from "@/server/web";

export const runtime = "nodejs";
const KINDS = ["term", "signed", "certificate"];

export async function GET(req: Request) {
  const admin = await currentAdmin();
  if (!admin) return new Response("Sessão expirada", { status: 401 });
  const q = new URL(req.url).searchParams;
  const k = q.get("k") ?? "";
  if (!KINDS.includes(k)) return new Response("Documento inválido", { status: 400 });
  try {
    return Response.redirect(new URL(await adminDocumentUrl(admin, k as DocKind, q.get("c") ?? "", await reqCtx()), req.url), 302);
  } catch (e) {
    return new Response(isAppError(e) ? e.message : "Falha ao abrir o documento", { status: isAppError(e) ? e.status : 500 });
  }
}
