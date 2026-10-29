import Link from "next/link";
import { redirect } from "next/navigation";
import { requireDriver } from "@/server/web";
import { examState } from "@/server/services/exams";
import { fmtDateTime } from "@/lib/time";
import { Alert, Badge, Card, CardBody } from "@/components/ui/misc";
import { ActionForm } from "@/components/action-form";
import { Submit } from "@/components/submit";
import { startExamAction } from "./actions";

export const metadata = { title: "Avaliação" };

export default async function Page({ params }: { params: Promise<{ convId: string }> }) {
  const d = await requireDriver();
  const { convId } = await params;
  const st = await examState(d, convId).catch(() => null);
  if (!st) redirect("/m");
  if (st.inProgress && st.open) redirect(`/m/c/${convId}/prova/${st.inProgress.id}`);
  const e = st.exam;
  return (
    <div className="space-y-5">
      <p className="text-sm"><Link href="/m" className="font-semibold text-brand-600">← Voltar</Link></p>
      <h1 className="text-2xl font-extrabold text-brand-900">{e?.title ?? "Avaliação"}</h1>
      {e ? (
        <Card><CardBody className="space-y-2 text-sm">
          {e.description ? <p>{e.description}</p> : null}
          <ul className="space-y-1">
            <li>• <b>{e.question_count}</b> perguntas de múltipla escolha</li>
            <li>• Nota mínima para aprovação: <b>{e.pass_pct}%</b></li>
            <li>• Tentativas: <b>{e.max_attempts}</b> (restam {st.remaining})</li>
            <li>• Tempo: <b>{e.time_limit_minutes ? `${e.time_limit_minutes} minutos` : "sem limite"}</b>{e.time_limit_minutes ? " — ao terminar o tempo, as respostas marcadas são enviadas automaticamente" : ""}</li>
            <li>• Suas respostas ficam salvas a cada clique. A correção é feita só depois do envio.</li>
          </ul>
        </CardBody></Card>
      ) : null}
      {st.reason && !st.passed ? <Alert tone={st.open ? "warn" : "bad"}>{st.reason}</Alert> : null}
      {st.passed ? <Alert tone="ok" title="Você foi aprovado!">Nota {Number(st.passed.score_pct)}%. Próximo passo: assinatura do termo de treinamento.</Alert> : null}
      {st.canStart ? (
        <ActionForm action={startExamAction.bind(null, convId)}>
          <Submit size="xl" variant="accent" pendingText="Preparando a prova…">{st.attempts.length ? "INICIAR NOVA TENTATIVA" : "INICIAR AVALIAÇÃO"}</Submit>
        </ActionForm>
      ) : null}
      {st.attempts.filter((a) => a.submitted_at).length ? (
        <Card><CardBody>
          <p className="mb-2 font-bold">Tentativas</p>
          <ul className="divide-y divide-slate-100">
            {st.attempts.filter((a) => a.submitted_at).map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span>{a.attempt_number}ª · {fmtDateTime(a.submitted_at!)}</span>
                <span className="flex items-center gap-2"><b>{Number(a.score_pct)}%</b><Badge tone={a.passed ? "ok" : "bad"}>{a.passed ? "Aprovado" : "Reprovado"}</Badge>
                  <Link href={`/m/c/${convId}/prova/${a.id}`} className="text-brand-600 underline">ver</Link></span>
              </li>))}
          </ul>
        </CardBody></Card>
      ) : null}
    </div>
  );
}
