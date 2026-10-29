"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Alert, Progress } from "./ui/misc";

type Seg = [number, number];

/**
 * Player do treinamento.
 * - Registra apenas os trechos efetivamente reproduzidos (pular para frente não conta).
 * - Velocidade travada em 1x, sem download e sem "picture-in-picture".
 * - Envia os trechos ao servidor a cada 5 s e em play/pause/fim; o servidor decide o percentual.
 */
export function VideoPlayer({ convocationId, videoId, src, startAt, initialPct, completionPct, initialCompleted, nextHref }: {
  convocationId: string; videoId: string; src: string; startAt: number; initialPct: number; completionPct: number; initialCompleted: boolean; nextHref: string | null;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const segs = useRef<Seg[]>([]);
  const lastT = useRef<number | null>(null);
  const sending = useRef(false);
  const [pct, setPct] = useState(initialPct);
  const [done, setDone] = useState(initialCompleted);
  const [justDone, setJustDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState(src);

  const send = useCallback(async (event: string) => {
    const v = ref.current;
    if (!v || sending.current) return;
    sending.current = true;
    try {
      const res = await fetch("/api/m/progress", {
        method: "POST", headers: { "Content-Type": "application/json" }, keepalive: true,
        body: JSON.stringify({ convocationId, videoId, event, position: v.currentTime || 0, segments: segs.current.slice(-200) }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error ?? "Não foi possível registrar o progresso."); if (res.status === 401 || res.status === 403) v.pause(); return; }
      setError(null);
      setPct(j.pct);
      if (j.completed) setDone(true);
      if (j.completedNow) setJustDone(true);
    } catch {
      setError("Sem conexão. O progresso será enviado quando a internet voltar.");
    } finally {
      sending.current = false;
    }
  }, [convocationId, videoId]);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const onTime = () => {
      if (v.paused || v.seeking) return;
      const t = v.currentTime;
      const prev = lastT.current;
      if (prev !== null && t >= prev && t - prev <= 2.5) {
        const cur = segs.current[segs.current.length - 1];
        if (cur && Math.abs(cur[1] - prev) < 0.01) cur[1] = t; else segs.current.push([prev, t]);
      }
      lastT.current = t;
    };
    const onSeeking = () => { lastT.current = null; };
    const onRate = () => { if (v.playbackRate !== 1) v.playbackRate = 1; };
    const onPlay = () => { lastT.current = v.currentTime; void send("play"); };
    const onPause = () => { onTime(); void send("pause"); };
    const onEnded = () => { onTime(); void send("ended"); };
    const onVis = () => { if (document.visibilityState === "hidden") void send("heartbeat"); };
    const onMeta = () => { if (startAt > 0 && startAt < v.duration - 5) v.currentTime = startAt; };
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("seeking", onSeeking);
    v.addEventListener("ratechange", onRate);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("ended", onEnded);
    v.addEventListener("loadedmetadata", onMeta, { once: true });
    document.addEventListener("visibilitychange", onVis);
    const timer = window.setInterval(() => { if (!v.paused) { onTime(); void send("heartbeat"); } }, 5000);
    return () => {
      window.clearInterval(timer);
      v.removeEventListener("timeupdate", onTime); v.removeEventListener("seeking", onSeeking); v.removeEventListener("ratechange", onRate);
      v.removeEventListener("play", onPlay); v.removeEventListener("pause", onPause); v.removeEventListener("ended", onEnded);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [send, startAt]);

  // Link do vídeo expirou durante a reprodução: renova e continua do mesmo ponto
  const onError = async () => {
    const v = ref.current;
    const pos = v?.currentTime ?? 0;
    const r = await fetch(`/api/m/video-url?c=${convocationId}&v=${videoId}`).then((x) => x.json()).catch(() => null);
    if (r?.url && r.url !== url) {
      setUrl(r.url);
      requestAnimationFrame(() => { if (ref.current) ref.current.currentTime = pos; });
    } else setError(r?.error ?? "Não foi possível carregar o vídeo. Verifique a internet e recarregue a página.");
  };

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-xl bg-black">
        <video ref={ref} src={url} controls playsInline preload="metadata" controlsList="nodownload noplaybackrate" disablePictureInPicture
          onContextMenu={(e) => e.preventDefault()} onError={onError} className="aspect-video w-full" />
      </div>
      <div className="space-y-1">
        <div className="flex items-center justify-between text-sm">
          <span className="font-semibold">Assistido: {Math.floor(pct)}%</span>
          <span className="text-slate-500">mínimo para concluir: {completionPct}%</span>
        </div>
        <Progress value={pct} tone={done ? "ok" : "brand"} />
      </div>
      {error ? <Alert tone="warn">{error}</Alert> : null}
      {done ? (
        <Alert tone="ok">
          <span className="flex items-center gap-2 font-semibold"><CheckCircle2 className="h-5 w-5" aria-hidden /> {justDone ? "Parabéns! Vídeo concluído." : "Vídeo concluído."}</span>
          {nextHref ? <a href={nextHref} className="mt-2 inline-block font-bold underline">Ir para o próximo →</a> : null}
        </Alert>
      ) : (
        <p className="text-xs text-slate-500">Assista com atenção: o sistema conta somente os trechos realmente reproduzidos. Avançar o vídeo não conta como assistido.</p>
      )}
    </div>
  );
}
