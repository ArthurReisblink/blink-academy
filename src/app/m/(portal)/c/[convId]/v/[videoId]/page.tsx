import Link from "next/link";
import { notFound } from "next/navigation";
import { isAppError } from "@/lib/errors";
import { requireDriver } from "@/server/web";
import { videoPlayback } from "@/server/services/videos";
import { Alert } from "@/components/ui/misc";
import { VideoPlayer } from "@/components/video-player";

export const metadata = { title: "Vídeo do treinamento" };

export default async function Page({ params }: { params: Promise<{ convId: string; videoId: string }> }) {
  const d = await requireDriver();
  const { convId, videoId } = await params;
  let p: Awaited<ReturnType<typeof videoPlayback>>;
  try {
    p = await videoPlayback(d, convId, videoId);
  } catch (e) {
    if (isAppError(e)) return <div className="space-y-4"><Alert tone="bad">{e.message}</Alert><Link href="/m" className="font-semibold text-brand-600 underline">← Voltar</Link></div>;
    throw e;
  }
  if (!p) notFound();
  const idx = p.list.findIndex((v) => v.video_id === videoId);
  const next = p.list[idx + 1];
  const pct = p.video.covered_seconds ? Math.min(100, (Number(p.video.covered_seconds) / Number(p.video.duration_seconds)) * 100) : 0;
  return (
    <div className="space-y-4">
      <Link href="/m" className="text-sm font-semibold text-brand-600">← Minha convocação</Link>
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-brand-600">Vídeo {idx + 1} de {p.list.length}{p.video.required ? " · obrigatório" : " · complementar"}</p>
        <h1 className="text-xl font-extrabold text-brand-900">{p.video.title}</h1>
        {p.video.description ? <p className="mt-1 text-sm text-slate-600">{p.video.description}</p> : null}
      </div>
      <VideoPlayer convocationId={convId} videoId={videoId} src={p.url} startAt={p.video.completed_at ? 0 : Number(p.video.last_position ?? 0)}
        initialPct={pct} completionPct={Number(p.video.completion_pct)} initialCompleted={!!p.video.completed_at}
        nextHref={next ? `/m/c/${convId}/v/${next.video_id}` : "/m"} />
    </div>
  );
}
