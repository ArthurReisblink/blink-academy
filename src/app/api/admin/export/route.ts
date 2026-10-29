import { exportReport, type ExportFormat, type ReportFilters } from "@/server/services/reports";
import { currentAdmin, reqCtx } from "@/server/web";
import { STATUS } from "@/server/domain/status";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const admin = await currentAdmin();
  if (!admin) return new Response("Sessão expirada", { status: 401 });
  const q = new URL(req.url).searchParams;
  const format = q.get("formato") as ExportFormat;
  if (!["csv", "xlsx", "pdf"].includes(format)) return new Response("Formato inválido", { status: 400 });
  const status = q.get("situacao") ?? "";
  const f: ReportFilters = {
    q: q.get("q") ?? undefined, status: (status in STATUS ? status : "") as ReportFilters["status"],
    trainingId: q.get("treinamento") ?? undefined, baseId: q.get("base") ?? undefined, from: q.get("de") ?? undefined, to: q.get("ate") ?? undefined,
  };
  const r = await exportReport(admin, format, f, await reqCtx());
  return new Response(new Uint8Array(r.body), { headers: { "Content-Type": r.type, "Content-Disposition": `attachment; filename="${r.name}"`, "Cache-Control": "no-store" } });
}
