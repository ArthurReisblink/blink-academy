import { isAppError } from "@/lib/errors";
import { videoPlayback } from "@/server/services/videos";
import { currentDriver } from "@/server/web";

export const runtime = "nodejs";

/** Renova a URL temporária do vídeo (quando expira durante a reprodução). */
export async function GET(req: Request) {
  const driver = await currentDriver();
  if (!driver) return Response.json({ error: "Sessão expirada" }, { status: 401 });
  const q = new URL(req.url).searchParams;
  try {
    const p = await videoPlayback(driver, q.get("c") ?? "", q.get("v") ?? "");
    if (!p) return Response.json({ error: "Vídeo não encontrado" }, { status: 404 });
    return Response.json({ url: p.url });
  } catch (e) {
    if (isAppError(e)) return Response.json({ error: e.message }, { status: e.status });
    return Response.json({ error: "Falha" }, { status: 500 });
  }
}
