import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/server/web";
import { getExam } from "@/server/services/exams";
import { listQuestions, listTopics } from "@/server/services/questions";
import { Alert, Badge, Card, CardBody, CardTitle, PageHeader } from "@/components/ui/misc";
import { ActionForm } from "@/components/action-form";
import { Submit } from "@/components/submit";
import { ExamFields } from "../exam-fields";
import { examQuestionsAction, updateExamAction } from "../actions";

export const metadata = { title: "Prova" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  const { id } = await params;
  const [d, topics, questions] = await Promise.all([getExam(admin, id), listTopics(admin), listQuestions(admin, { status: "active" })]);
  if (!d) notFound();
  const { exam: e, manual } = d;
  const canWrite = admin.role !== "auditor";
  const pool = e.selection_mode === "manual" ? manual.length : questions.filter((q) => !e.topic_ids.length || e.topic_ids.includes(q.topic_id)).length;
  return (
    <>
      <p className="mb-2 text-sm"><Link href="/admin/provas" className="text-brand-600 hover:underline">← Provas</Link></p>
      <PageHeader title={e.title} description={`${e.question_count} questões · nota mínima ${Number(e.pass_pct)}% · ${e.max_attempts} tentativa(s)`} />
      {pool < e.question_count ? <Alert tone="warn" className="mb-4" title="Banco insuficiente">A prova pede {e.question_count} questões e há {pool} disponíveis na seleção atual. Ela não poderá ser aplicada até ajustar.</Alert> : null}
      <div className="grid gap-6 xl:grid-cols-2">
        <Card><CardBody>
          <CardTitle>Configurações</CardTitle>
          {canWrite ? (
            <ActionForm action={updateExamAction.bind(null, e.id)} className="mt-4 space-y-4"><ExamFields e={e} topics={topics} /><Submit>Salvar</Submit></ActionForm>
          ) : <p className="mt-2 text-sm text-slate-500">Somente leitura.</p>}
        </CardBody></Card>
        <Card><CardBody>
          <CardTitle>Seleção manual de perguntas</CardTitle>
          <p className="mt-1 text-sm text-slate-500">{e.selection_mode === "manual" ? `Usada nesta prova. ${manual.length} selecionadas.` : "Esta prova usa sorteio. A lista abaixo só vale se mudar para seleção manual."}</p>
          <ActionForm action={examQuestionsAction.bind(null, e.id)} className="mt-3 space-y-3">
            <div className="max-h-[32rem] space-y-4 overflow-y-auto pr-2">
              {topics.map((t) => {
                const qs = questions.filter((q) => q.topic_id === t.id);
                if (!qs.length) return null;
                return (
                  <fieldset key={t.id}>
                    <legend className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">{t.name}</legend>
                    {qs.map((q) => (
                      <label key={q.id} className="flex items-start gap-2 py-1 text-sm">
                        <input type="checkbox" name="q" value={q.id} defaultChecked={manual.includes(q.id)} disabled={!canWrite} className="mt-1" />
                        <span>{q.statement} {q.answered ? <Badge tone="slate">{q.error_rate}% erro</Badge> : null}</span>
                      </label>))}
                  </fieldset>);
              })}
            </div>
            {canWrite ? <Submit variant="outline">Salvar seleção</Submit> : null}
          </ActionForm>
        </CardBody></Card>
      </div>
    </>
  );
}
