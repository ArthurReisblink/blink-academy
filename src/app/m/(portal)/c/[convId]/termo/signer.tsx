"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { sendCodeAction, signAction } from "./actions";

/** Fluxo de assinatura: declaração → código de uso único → assinar. A rubrica é opcional. */
export function Signer({ convId, declaration }: { convId: string; declaration: string }) {
  const router = useRouter();
  const [accepted, setAccepted] = useState(false);
  const [challenge, setChallenge] = useState<{ id: string; dest: string } | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawn = useRef(false);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.clientWidth * ratio; c.height = c.clientHeight * ratio;
    ctx.scale(ratio, ratio); ctx.lineWidth = 2.2; ctx.lineCap = "round"; ctx.strokeStyle = "#0f172a";
    let down = false;
    const pos = (e: PointerEvent) => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] as const; };
    const onDown = (e: PointerEvent) => { down = true; c.setPointerCapture(e.pointerId); const [x, y] = pos(e); ctx.beginPath(); ctx.moveTo(x, y); };
    const onMove = (e: PointerEvent) => { if (!down) return; const [x, y] = pos(e); ctx.lineTo(x, y); ctx.stroke(); drawn.current = true; };
    const onUp = () => { down = false; };
    c.addEventListener("pointerdown", onDown); c.addEventListener("pointermove", onMove); c.addEventListener("pointerup", onUp); c.addEventListener("pointercancel", onUp);
    return () => { c.removeEventListener("pointerdown", onDown); c.removeEventListener("pointermove", onMove); c.removeEventListener("pointerup", onUp); c.removeEventListener("pointercancel", onUp); };
  }, []);

  const clear = () => { const c = canvas.current!; c.getContext("2d")!.clearRect(0, 0, c.width, c.height); drawn.current = false; };

  const sendCode = () => start(async () => {
    setError(null);
    const r = await sendCodeAction(convId);
    if (!r.ok) setError(r.error ?? "Erro"); else setChallenge({ id: r.challengeId!, dest: r.destination! });
  });

  const sign = () => start(async () => {
    setError(null);
    const drawing = drawn.current ? canvas.current!.toDataURL("image/png") : null;
    const r = await signAction(convId, { challengeId: challenge!.id, code, accepted, drawing });
    if (!r.ok) setError(r.error ?? "Erro"); else router.refresh();
  });

  return (
    <div className="space-y-4">
      <label className="flex cursor-pointer items-start gap-3 rounded-xl border-2 border-slate-200 bg-white p-4 has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50">
        <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-brand-600" />
        <span className="text-base">{declaration}</span>
      </label>
      <div>
        <div className="mb-1 flex items-center justify-between text-sm"><span className="font-semibold">Rubrica (opcional)</span><button type="button" onClick={clear} className="text-brand-600 underline">Limpar</button></div>
        <canvas ref={canvas} className="h-32 w-full touch-none rounded-xl border-2 border-dashed border-slate-300 bg-white" aria-label="Área para desenhar a rubrica" />
        <p className="mt-1 text-xs text-slate-500">A rubrica é complementar. A sua identificação é feita pelo CPF e pelo código enviado ao seu contato cadastrado.</p>
      </div>
      {error ? <Alert tone="bad">{error}</Alert> : null}
      {!challenge ? (
        <Button size="xl" onClick={sendCode} disabled={!accepted || pending}>{pending ? "Enviando…" : "RECEBER CÓDIGO PARA ASSINAR"}</Button>
      ) : (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm">Enviamos um código para <b>{challenge.dest}</b>. Digite abaixo para assinar.</p>
          <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            className="h-14 text-center text-2xl font-bold tracking-[0.5em]" aria-label="Código de 6 dígitos" id="sign-code" />
          <Button size="xl" variant="success" onClick={sign} disabled={code.length !== 6 || !accepted || pending}>{pending ? "Assinando…" : "ASSINAR TERMO"}</Button>
          <button type="button" onClick={sendCode} disabled={pending} className="w-full text-sm font-semibold text-brand-600 underline">Não recebi — enviar outro código</button>
        </div>
      )}
    </div>
  );
}
