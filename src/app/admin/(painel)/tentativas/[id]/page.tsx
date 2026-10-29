import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/server/web";
import { attemptForAdmin } from "@/server/services/exams";
import { fmtDateTime } from "@/lib/time";
import { Badge, Card, CardBody, PageHeader } from "@/components/ui/misc";
import { cn } from "@/lib/utils";

export const metadata = { title: "Tentativa da prova" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const a = await attemptForAdmin(admin, id);
  if (!a) notFound();
  return (
    <>
      <p className="mb-2 text-sm"><Link href="/admin/motoristas" className="text-brand-600 hover:underline">← Motoristas</Link></p>
      <PageHeader title={`${a.rules.exam_title} — ${a.attempt_number}ª tentativa`}
        description={<span className="flex flex-wrap items-center gap-2">Iniciada em {fmtDateTime(a.started_at)} · {a.submitted_at ? `enviada em ${fmtDateTime(a.submitted_at)}${a.submit_reason === "time_limit" ? " (tempo esgotado)" : ""}` : "em andamento"}
          {a.submitted_at ? <Badge tone={a.passed ? "ok" : "bad"}>{a.correct_count}/{a.questions.length} · {Number(a.score_pct)}% · {a.passed ? "aprovado" : "reprovado"}</Badge> : null}</span>} />
      <p className="mb-4 text-sm text-slate-600">Cópia exata das perguntas, alternativas e regras no momento da prova (mínimo {a.rules.pass_pct}%). Alterações posteriores no banco de questões não mudam este registro.</p>
      <div className="space-y-3">
        {a.questions.map((q, i) => {
          const chosen = a.answers[q.id];
          const right = a.answer_key[q.id]?.correct;
          return (
            <Card key={q.id}><CardBody className="space-y-2 text-sm">
              <div className="flex items-start justify-between gap-2"><p className="font-semibold">{i + 1}. {q.statement}</p>
                {a.submitted_at ? <Badge tone={chosen === right ? "ok" : "bad"}>{chosen === right ? "acertou" : chosen ? "errou" : "em branco"}</Badge> : null}</div>
              <p className="text-xs text-slate-500">{q.topic}</p>
              <ul className="space-y-1">
                {q.options.map((o, j) => (
                  <li key={o.id} className={cn("rounded px-2 py-1", o.id === right ? "bg-emerald-50 font-semibold text-emerald-800" : o.id === chosen ? "bg-red-50 text-red-800" : "text-slate-600")}>
                    {String.fromCharCode(65 + j)}) {o.text}{o.id === right ? " (correta)" : ""}{o.id === chosen ? " ← resposta do motorista" : ""}
                  </li>))}
              </ul>
            </CardBody></Card>
          );
        })}
      </div>
    </>
  );
}
