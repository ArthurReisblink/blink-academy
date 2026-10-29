import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, XCircle } from "lucide-react";
import { requireDriver } from "@/server/web";
import { attemptForDriver, attemptReview, examState } from "@/server/services/exams";
import { Alert, Card, CardBody } from "@/components/ui/misc";
import { cn } from "@/lib/utils";
import { ExamRunner } from "./runner";

export const metadata = { title: "Avaliação" };

export default async function Page({ params }: { params: Promise<{ convId: string; attemptId: string }> }) {
  const d = await requireDriver();
  const { convId, attemptId } = await params;
  await examState(d, convId).catch(() => null); // envia automaticamente se o tempo acabou
  const a = await attemptForDriver(d, attemptId);
  if (!a || a.convocation_id !== convId) notFound();

  if (!a.submitted_at) {
    return <ExamRunner convId={convId} attemptId={a.id} title={a.rules.exam_title} mode={a.rules.display_mode} questions={a.questions}
      initialAnswers={a.answers} deadline={a.deadline_at ? a.deadline_at.toISOString() : null} />;
  }

  const r = (await attemptReview(d, attemptId))!;
  const at = r.attempt;
  return (
    <div className="space-y-5">
      <p className="text-sm"><Link href="/m" className="font-semibold text-brand-600">← Voltar ao início</Link></p>
      <Card className={at.passed ? "border-ok-600" : "border-bad-600"}><CardBody className="space-y-2 text-center">
        {at.passed ? <CheckCircle2 className="mx-auto h-14 w-14 text-ok-600" aria-hidden /> : <XCircle className="mx-auto h-14 w-14 text-bad-600" aria-hidden />}
        <p className="text-sm font-bold uppercase tracking-wide text-slate-500">{at.attempt_number}ª tentativa{at.submit_reason === "time_limit" ? " · enviada ao fim do tempo" : ""}</p>
        <p className="text-5xl font-extrabold">{at.score_pct}%</p>
        <p className="text-sm">{at.correct_count} de {at.total} acertos · mínimo {at.pass_pct}%</p>
        <p className={cn("text-xl font-extrabold", at.passed ? "text-ok-600" : "text-bad-600")}>{at.passed ? "APROVADO" : "REPROVADO"}</p>
      </CardBody></Card>
      {at.passed ? <Alert tone="ok">Próximo passo: assinatura do termo de treinamento.</Alert>
        : r.remaining > 0 ? <Alert tone="warn">Você ainda tem {r.remaining} tentativa(s). Revise os vídeos se precisar e tente novamente. <Link href={`/m/c/${convId}/prova`} className="font-bold underline">Nova tentativa</Link></Alert>
        : <Alert tone="bad">Você usou todas as tentativas disponíveis. Entre em contato com a administração da BLINK.</Alert>}
      {r.showKey ? (
        <div className="space-y-3">
          <h2 className="text-lg font-extrabold">Revisão</h2>
          {r.items.map((q, i) => (
            <Card key={q.id}><CardBody className="space-y-2 text-sm">
              <p className="font-semibold">{i + 1}. {q.statement}</p>
              <ul className="space-y-1">
                {q.options.map((o) => (
                  <li key={o.id} className={cn("rounded px-2 py-1", o.id === q.rightOption ? "bg-emerald-50 font-semibold text-emerald-800" : o.id === q.chosen ? "bg-red-50 text-red-800" : "text-slate-600")}>
                    {o.text}{o.id === q.chosen ? " ← sua resposta" : ""}
                  </li>))}
              </ul>
              {q.explanation ? <p className="text-xs text-slate-600"><b>Explicação:</b> {q.explanation}</p> : null}
            </CardBody></Card>
          ))}
        </div>
      ) : <p className="text-xs text-slate-500">O gabarito não é exibido enquanto houver novas tentativas, porque as perguntas podem se repetir.</p>}
    </div>
  );
}
