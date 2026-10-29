"use client";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Clock } from "lucide-react";
import { Alert, Progress } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { saveAnswerAction, submitExamAction } from "../actions";

type Q = { id: string; topic: string; statement: string; options: { id: string; text: string }[] };

export function ExamRunner({ convId, attemptId, title, mode, questions, initialAnswers, deadline }: {
  convId: string; attemptId: string; title: string; mode: "one" | "all"; questions: Q[]; initialAnswers: Record<string, string>; deadline: string | null;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>(initialAnswers ?? {});
  const [idx, setIdx] = useState(() => Math.max(0, questions.findIndex((q) => !initialAnswers?.[q.id])));
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const [left, setLeft] = useState<number | null>(deadline ? new Date(deadline).getTime() - Date.now() : null);
  const sentRef = useRef(false);
  const answered = useMemo(() => questions.filter((q) => answers[q.id]).length, [answers, questions]);

  const submit = () => {
    if (sentRef.current) return;
    sentRef.current = true;
    start(async () => {
      const r = await submitExamAction(convId, attemptId, answers);
      if (r && !r.ok) { sentRef.current = false; setError(r.error ?? "Erro ao enviar."); }
    });
  };

  useEffect(() => {
    if (!deadline) return;
    const t = window.setInterval(() => {
      const ms = new Date(deadline).getTime() - Date.now();
      setLeft(ms);
      if (ms <= 0) { window.clearInterval(t); submit(); }
    }, 1000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deadline]);

  const choose = (qid: string, oid: string) => {
    setAnswers((a) => ({ ...a, [qid]: oid }));
    void saveAnswerAction(attemptId, qid, oid).then((r) => {
      if (!r.ok) { setError(r.error ?? "Erro ao salvar."); if (r.closed) window.location.reload(); } else setError(null);
    });
  };

  const renderQ = (q: Q, i: number) => (
    <fieldset key={q.id} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <legend className="sr-only">Pergunta {i + 1}</legend>
      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Pergunta {i + 1} de {questions.length}</p>
      <p className="text-lg font-semibold leading-snug">{q.statement}</p>
      <div className="space-y-2">
        {q.options.map((o, j) => {
          const sel = answers[q.id] === o.id;
          return (
            <label key={o.id} className={cn("flex min-h-12 cursor-pointer items-start gap-3 rounded-lg border-2 px-3 py-3 text-base",
              sel ? "border-brand-600 bg-brand-50" : "border-slate-200 hover:border-slate-300")}>
              <input type="radio" name={q.id} value={o.id} checked={sel} onChange={() => choose(q.id, o.id)} className="mt-1 h-5 w-5 shrink-0 accent-brand-600" />
              <span><b className="mr-1">{String.fromCharCode(65 + j)})</b>{o.text}</span>
            </label>);
        })}
      </div>
    </fieldset>
  );

  const fmt = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-10 -mx-4 space-y-2 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate font-extrabold text-brand-900">{title}</p>
          {left !== null ? <span className={cn("flex items-center gap-1 rounded-full px-2 py-1 text-sm font-bold", left < 60000 ? "bg-red-100 text-red-700" : "bg-slate-100")}><Clock className="h-4 w-4" aria-hidden />{fmt(left)}</span> : null}
        </div>
        <Progress value={(answered / questions.length) * 100} />
        <p className="text-xs text-slate-500">{answered} de {questions.length} respondidas</p>
      </div>
      {error ? <Alert tone="bad">{error}</Alert> : null}
      {mode === "all" ? questions.map(renderQ) : (
        <>
          {renderQ(questions[idx], idx)}
          <div className="flex gap-2">
            <Button variant="outline" size="lg" className="flex-1" disabled={idx === 0} onClick={() => setIdx(idx - 1)}>Anterior</Button>
            {idx < questions.length - 1 ? <Button size="lg" className="flex-1" onClick={() => setIdx(idx + 1)}>Próxima</Button> : null}
          </div>
          <div className="flex flex-wrap gap-1.5" aria-label="Ir para a pergunta">
            {questions.map((q, i) => (
              <button key={q.id} type="button" onClick={() => setIdx(i)} aria-label={`Pergunta ${i + 1}`}
                className={cn("h-9 w-9 rounded-lg text-sm font-bold", i === idx ? "bg-brand-600 text-white" : answers[q.id] ? "bg-brand-100 text-brand-800" : "bg-slate-100 text-slate-500")}>{i + 1}</button>))}
          </div>
        </>
      )}
      {!confirming ? (
        <Button size="xl" variant="accent" onClick={() => setConfirming(true)} disabled={pending}>ENVIAR AVALIAÇÃO</Button>
      ) : (
        <Alert tone={answered < questions.length ? "warn" : "brand"} title="Confirmar envio">
          {answered < questions.length ? `Você respondeu ${answered} de ${questions.length}. Perguntas em branco contam como erro. ` : "Todas as perguntas foram respondidas. "}
          Depois de enviar não é possível alterar.
          <div className="mt-3 flex gap-2">
            <Button variant="outline" onClick={() => setConfirming(false)} disabled={pending}>Voltar</Button>
            <Button variant="accent" onClick={submit} disabled={pending}>{pending ? "Enviando…" : "Confirmar envio"}</Button>
          </div>
        </Alert>
      )}
    </div>
  );
}
