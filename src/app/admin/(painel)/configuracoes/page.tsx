import { requireAdmin } from "@/server/web";
import { listBases } from "@/server/services/bases";
import { Badge, Card, CardBody, CardTitle, PageHeader } from "@/components/ui/misc";
import { Input } from "@/components/ui/form";
import { Submit } from "@/components/submit";
import { ActionForm } from "@/components/action-form";
import { createBaseAction, defaultsAction, retentionAction, runRetentionAction, toggleBaseAction } from "./actions";
import { getSettings } from "@/server/services/admin-tools";
import { Field } from "@/components/ui/form";
import { fmtDateTime } from "@/lib/time";

export const metadata = { title: "Configurações" };

export default async function Page() {
  const admin = await requireAdmin();
  const [bases, st] = await Promise.all([listBases(admin, true), getSettings(admin)]);
  const isSuper = admin.role === "superadmin";
  const canWrite = admin.role !== "auditor";
  return (
    <>
      <PageHeader title="Configurações" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card><CardBody>
          <CardTitle>Bases operacionais</CardTitle>
          <ul className="mt-3 divide-y divide-slate-100">
            {bases.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span>{b.name} {!b.active ? <Badge>Inativa</Badge> : null}</span>
                {canWrite ? <form action={toggleBaseAction.bind(null, b.id, !b.active)}><button className="text-xs font-semibold text-brand-600 underline">{b.active ? "Desativar" : "Reativar"}</button></form> : null}
              </li>))}
          </ul>
          {canWrite ? (
            <ActionForm action={createBaseAction} className="mt-4 flex gap-2">
              <Input name="name" placeholder="Ex.: BASE - 01 - Guarapari - ES" required />
              <Submit>Adicionar</Submit>
            </ActionForm>
          ) : null}
        </CardBody></Card>
        <Card><CardBody>
          <CardTitle>Padrões de novos treinamentos</CardTitle>
          <ActionForm action={defaultsAction} className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Reprodução mínima do vídeo (%)" htmlFor="video_completion_pct"><Input id="video_completion_pct" name="video_completion_pct" type="number" min={50} max={100} defaultValue={st.defaults.video_completion_pct} disabled={!canWrite} /></Field>
            <Field label="Nota mínima da prova (%)" htmlFor="pass_pct"><Input id="pass_pct" name="pass_pct" type="number" min={1} max={100} defaultValue={st.defaults.pass_pct} disabled={!canWrite} /></Field>
            <Field label="Tentativas" htmlFor="max_attempts"><Input id="max_attempts" name="max_attempts" type="number" min={1} max={20} defaultValue={st.defaults.max_attempts} disabled={!canWrite} /></Field>
            <Field label="Questões por prova" htmlFor="question_count"><Input id="question_count" name="question_count" type="number" min={1} max={100} defaultValue={st.defaults.question_count} disabled={!canWrite} /></Field>
            {canWrite ? <div className="sm:col-span-2"><Submit>Salvar padrões</Submit></div> : null}
          </ActionForm>
        </CardBody></Card>
        <Card className="lg:col-span-2"><CardBody>
          <CardTitle>Retenção de dados (LGPD)</CardTitle>
          <p className="mt-1 text-sm text-slate-600">Registros técnicos antigos são apagados automaticamente todos os dias. Convocações, tentativas, assinaturas, comprovantes e o histórico de cada treinamento são mantidos como prova da realização do treinamento; para excluir os dados de um motorista use a anonimização na página dele.</p>
          <ActionForm action={retentionAction} className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Registros de acesso (dias)" htmlFor="auth_log_days"><Input id="auth_log_days" name="auth_log_days" type="number" min={30} defaultValue={st.retention.auth_log_days} disabled={!isSuper} /></Field>
            <Field label="Códigos de verificação (dias)" htmlFor="otp_days"><Input id="otp_days" name="otp_days" type="number" min={1} defaultValue={st.retention.otp_days} disabled={!isSuper} /></Field>
            <Field label="Sessões encerradas (dias)" htmlFor="sessions_days"><Input id="sessions_days" name="sessions_days" type="number" min={1} defaultValue={st.retention.sessions_days} disabled={!isSuper} /></Field>
            <Field label="Eventos do player (dias)" htmlFor="video_events_days"><Input id="video_events_days" name="video_events_days" type="number" min={30} defaultValue={st.retention.video_events_days} disabled={!isSuper} /></Field>
            {isSuper ? <div className="sm:col-span-2 lg:col-span-4"><Submit>Salvar prazos</Submit></div> : null}
          </ActionForm>
          <p className="mt-4 text-xs text-slate-500">Última execução: {st.lastRetention ? `${fmtDateTime(st.lastRetention.at)} — ${Object.entries(st.lastRetention.deleted).map(([k, v]) => `${k}: ${v}`).join(", ")}` : "ainda não executada"}</p>
          {isSuper ? <ActionForm action={runRetentionAction} className="mt-2"><Submit variant="outline" size="sm">Executar agora</Submit></ActionForm> : null}
        </CardBody></Card>
      </div>
    </>
  );
}
