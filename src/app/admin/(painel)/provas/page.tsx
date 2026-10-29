import Link from "next/link";
import { requireAdmin } from "@/server/web";
import { listExams } from "@/server/services/exams";
import { listTopics } from "@/server/services/questions";
import { Badge, Card, CardBody, CardTitle, EmptyState, PageHeader } from "@/components/ui/misc";
import { Table, TBody, Td, Th, THead } from "@/components/ui/table";
import { ActionForm } from "@/components/action-form";
import { Submit } from "@/components/submit";
import { ExamFields } from "./exam-fields";
import { createExamAction } from "./actions";
import { getSettings } from "@/server/services/admin-tools";

export const metadata = { title: "Provas" };

export default async function Page() {
  const admin = await requireAdmin();
  const [exams, topics, st] = await Promise.all([listExams(admin), listTopics(admin), getSettings(admin)]);
  const canWrite = admin.role !== "auditor";
  return (
    <>
      <PageHeader title="Provas" description="A prova é vinculada à versão do treinamento. A correção é feita sempre no servidor." />
      {exams.length === 0 ? <EmptyState title="Nenhuma prova cadastrada">Crie a primeira prova abaixo.</EmptyState> : (
        <Card className="mb-6 overflow-x-auto">
          <Table>
            <THead><tr><Th>Prova</Th><Th>Regras</Th><Th>Banco</Th><Th>Tentativas</Th><Th>Aprovação</Th><Th>Média</Th></tr></THead>
            <TBody>
              {exams.map((e) => {
                const available = e.selection_mode === "manual" ? e.manual_questions : e.pool;
                return (
                  <tr key={e.id}>
                    <Td><Link href={`/admin/provas/${e.id}`} className="font-semibold text-brand-700 hover:underline">{e.title}</Link> {!e.active ? <Badge>Inativa</Badge> : null}
                      <div className="text-xs text-slate-500">{e.versions} versão(ões) de treinamento</div></Td>
                    <Td className="text-sm">{e.question_count} questões · mín. {Number(e.pass_pct)}% · {e.max_attempts} tentativa(s){e.time_limit_minutes ? ` · ${e.time_limit_minutes} min` : ""}</Td>
                    <Td>{available >= e.question_count ? <Badge tone="ok">{available} disponíveis</Badge> : <Badge tone="bad">só {available}</Badge>}<div className="text-xs text-slate-500">{e.selection_mode === "manual" ? "manual" : "sorteio"}</div></Td>
                    <Td>{e.attempts}</Td>
                    <Td>{e.attempts ? `${Math.round((100 * e.passed) / e.attempts)}%` : "—"}</Td>
                    <Td>{e.avg_score ? `${Number(e.avg_score)}%` : "—"}</Td>
                  </tr>);
              })}
            </TBody>
          </Table>
        </Card>
      )}
      {canWrite ? (
        <Card><CardBody>
          <CardTitle>Nova prova</CardTitle>
          <ActionForm action={createExamAction} className="mt-4 space-y-4"><ExamFields topics={topics} defaults={st.defaults} /><Submit>Criar prova</Submit></ActionForm>
        </CardBody></Card>
      ) : null}
    </>
  );
}
