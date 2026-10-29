import Link from "next/link";
import { requireAdmin } from "@/server/web";
import { listQuestions, listTopics } from "@/server/services/questions";
import { Badge, Card, CardBody, CardTitle, EmptyState, PageHeader } from "@/components/ui/misc";
import { Input, Select } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { ActionForm } from "@/components/action-form";
import { Submit } from "@/components/submit";
import { QuestionForm } from "./question-form";
import { deleteQuestionAction, saveQuestionAction, seedAction, toggleQuestionAction } from "./actions";

export const metadata = { title: "Banco de questões" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const admin = await requireAdmin();
  const canWrite = admin.role !== "auditor";
  const [topics, questions] = await Promise.all([
    listTopics(admin),
    listQuestions(admin, { topicId: sp.assunto || undefined, q: sp.q || undefined, status: (sp.situacao as "active" | "inactive" | "") ?? "" }),
  ]);
  const total = topics.reduce((n, t) => n + t.questions, 0);
  return (
    <>
      <PageHeader title="Banco de questões" description={`${total} perguntas ativas em ${topics.length} assuntos. Editar uma pergunta não altera provas já realizadas.`} />
      {total === 0 && canWrite ? (
        <Card className="mb-6"><CardBody>
          <CardTitle>Banco inicial</CardTitle>
          <p className="mt-1 text-sm text-slate-600">Carrega as perguntas elaboradas a partir do documento “Na rota do treinamento Shopee POD e PNR”. Revise-as antes do uso oficial.</p>
          <ActionForm action={seedAction} className="mt-3"><Submit>Carregar banco inicial</Submit></ActionForm>
        </CardBody></Card>
      ) : null}

      <div className="mb-4 flex flex-wrap gap-2">
        {topics.map((t) => (
          <Link key={t.id} href={`/admin/questoes?assunto=${t.id}`} className={`rounded-full border px-3 py-1 text-xs font-semibold ${sp.assunto === t.id ? "border-brand-600 bg-brand-600 text-white" : "border-slate-200 bg-white text-slate-700"}`}>
            {t.name} · {t.questions}
          </Link>))}
      </div>
      <form className="mb-4 flex flex-wrap gap-2">
        {sp.assunto ? <input type="hidden" name="assunto" value={sp.assunto} /> : null}
        <Input name="q" defaultValue={sp.q} placeholder="Buscar no enunciado" className="max-w-xs" />
        <Select name="situacao" defaultValue={sp.situacao ?? ""} className="max-w-[10rem]">
          <option value="">Todas</option><option value="active">Ativas</option><option value="inactive">Inativas</option>
        </Select>
        <Button type="submit" variant="outline">Filtrar</Button>
        {sp.assunto || sp.q || sp.situacao ? <Link href="/admin/questoes" className="self-center text-sm text-brand-600 underline">Limpar</Link> : null}
      </form>

      {canWrite ? (
        <details className="mb-6 rounded-xl border border-slate-200 bg-white">
          <summary className="cursor-pointer px-5 py-3 font-semibold">+ Nova pergunta</summary>
          <div className="border-t border-slate-100 p-5"><QuestionForm action={saveQuestionAction.bind(null, null)} topics={topics} /></div>
        </details>
      ) : null}

      {questions.length === 0 ? <EmptyState title="Nenhuma pergunta encontrada" /> : (
        <ol className="space-y-3">
          {questions.map((q, n) => (
            <li key={q.id}><Card><CardBody>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
                    <Badge tone="brand">{q.topic}</Badge>
                    {!q.active ? <Badge>Inativa</Badge> : null}
                    {q.answered > 0 ? <Badge tone={q.error_rate! >= 50 ? "bad" : q.error_rate! >= 30 ? "warn" : "ok"}>{q.error_rate}% de erro · {q.answered} respostas</Badge> : <span className="text-slate-400">ainda não respondida</span>}
                  </div>
                  <p className="font-semibold">{n + 1}. {q.statement}</p>
                  <ul className="mt-2 space-y-1 text-sm">
                    {q.options.map((o, i) => (
                      <li key={o.id} className={o.is_correct ? "font-semibold text-emerald-700" : "text-slate-600"}>
                        {String.fromCharCode(65 + i)}) {o.text} {o.is_correct ? "✓" : ""}
                      </li>))}
                  </ul>
                  {q.explanation ? <p className="mt-2 text-xs text-slate-500"><b>Explicação:</b> {q.explanation}</p> : null}
                </div>
                {canWrite ? (
                  <div className="flex shrink-0 gap-3 text-xs font-semibold">
                    <form action={toggleQuestionAction.bind(null, q.id, !q.active)}><button className="text-brand-600 underline">{q.active ? "Desativar" : "Ativar"}</button></form>
                    {q.used_in_attempts === 0 && q.used_in_exams === 0 ? (
                      <ActionForm action={deleteQuestionAction.bind(null, q.id)} confirm="Excluir esta pergunta?"><button className="text-red-600 underline">Excluir</button></ActionForm>
                    ) : null}
                  </div>
                ) : null}
              </div>
              {canWrite ? (
                <details className="mt-3 rounded-lg bg-slate-50">
                  <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-brand-600">Editar</summary>
                  <div className="p-3">
                    <QuestionForm action={saveQuestionAction.bind(null, q.id)} topics={topics}
                      initial={{ topicId: q.topic_id, statement: q.statement, explanation: q.explanation ?? "", options: q.options.map((o) => o.text), correctIndex: q.options.findIndex((o) => o.is_correct) }} />
                  </div>
                </details>
              ) : null}
            </CardBody></Card></li>
          ))}
        </ol>
      )}
    </>
  );
}
