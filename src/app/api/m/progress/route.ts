import { isAppError } from "@/lib/errors";
import { recordHeartbeat } from "@/server/services/videos";
import { assertSameOrigin, currentDriver } from "@/server/web";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!(await assertSameOrigin(req))) return Response.json({ error: "Origem inválida" }, { status: 403 });
  const driver = await currentDriver();
  if (!driver) return Response.json({ error: "Sessão expirada" }, { status: 401 });
  try {
    const body = await req.json();
    const r = await recordHeartbeat(driver, body);
    return Response.json({ pct: r.pct, completed: r.completed, completedNow: r.completedNow });
  } catch (e) {
    if (isAppError(e)) return Response.json({ error: e.message }, { status: e.status });
    console.error(e);
    return Response.json({ error: "Falha ao registrar progresso" }, { status: 500 });
  }
}
