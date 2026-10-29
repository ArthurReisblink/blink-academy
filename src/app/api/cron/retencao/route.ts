import { safeEqual } from "@/lib/crypto";
import { runRetention } from "@/server/services/admin-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Rotina diária de retenção (Vercel Cron envia "Authorization: Bearer <CRON_SECRET>"). */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (secret.length < 16 || !safeEqual(got, secret)) return new Response("Não autorizado", { status: 401 });
  const deleted = await runRetention();
  return Response.json({ ok: true, deleted });
}
