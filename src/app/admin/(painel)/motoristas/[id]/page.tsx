import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/server/web";
import { getDriverDetail } from "@/server/services/drivers";
import { listBases } from "@/server/services/bases";
import { listTrainings } from "@/server/services/trainings";
import { fmtDateTime, remainingText } from "@/lib/time";
import { maskEmail, maskPhone } from "@/lib/contact";
import { Alert, Badge, Card, CardBody, CardTitle, PageHeader } from "@/components/ui/misc";
import { Field, Input, Select } from "@/components/ui/form";
import { Submit } from "@/components/submit";
import { ActionForm } from "@/components/action-form";
import { DeadlineFields } from "@/components/deadline-fields";
import { StatusBadge } from "@/components/status-badge";
import { DriverFields } from "../driver-fields";
import { driverStatusAction, newConvocationAction, updateDriverAction } from "../actions";
import { BlockForm, CancelForm, ExtendForm } from "./conv-actions";
import { Anonymize, RevealCpf } from "./driver-actions";

export const metadata = { title: "Motorista" };

const EVENT: Record<string, string> = {
  created: "Convocação criada", extended: "Prazo prorrogado", blocked: "Acesso bloqueado", unblocked: "Acesso reativado",
  cancelled: "Convocação cancelada", first_access: "Primeiro acesso do motorista", video_completed: "Vídeo concluído",
  exam_started: "Avaliação iniciada", exam_submitted: "Avaliação enviada", signed: "Termo assinado", completed: "Treinamento concluído",
};
const ACCESS: Record<string, string> = { driver_code_request: "Pedido de código", driver_login: "Login", signature_code_request: "Código de assinatura enviado", signature_code_verify: "Código de assinatura conferido" };

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ criado?: string }> }) {
  const admin = await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;
  const [detail, bases, trainings] = await Promise.all([getDriverDetail(admin, id), listBases(admin), listTrainings(admin)]);
  if (!detail) notFound();
  const { driver: d, convocations, events, access, attempts } = detail;
  const canWrite = admin.role !== "auditor" && !d.anonymized_at;
  const published = trainings.filter((t) => t.active && t.published_version);
  return (
    <>
      <p className="mb-2 text-sm"><Link href="/admin/motoristas" className="text-brand-600 hover:underline">← Motoristas</Link></p>
      <PageHeader title={d.full_name}
        description={<span className="flex flex-wrap items-center gap-2"><span className="font-mono">{d.cpf_mask}</span>{d.base_name ? <Badge tone="brand">{d.base_name}</Badge> : null}
          {d.status === "blocked" ? <Badge tone="bad">Motorista bloqueado</Badge> : <Badge tone="ok">Ativo</Badge>}{d.anonymized_at ? <Badge>Anonimizado</Badge> : null}</span>}
        actions={canWrite ? <form action={driverStatusAction.bind(null, d.id, d.status === "blocked" ? "active" : "blocked")}>
          <Submit variant={d.status === "blocked" ? "success" : "outline"}>{d.status === "blocked" ? "Desbloquear motorista" : "Bloquear motorista"}</Submit></form> : null} />
      {sp.criado ? <Alert tone="ok" className="mb-4">Motorista cadastrado. Envie a ele o link do portal: <strong>/m/entrar</strong>.</Alert> : null}

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <h2 className="text-lg font-bold">Convocações ({convocations.length})</h2>
          {convocations.length === 0 ? <Alert tone="warn">Nenhuma convocação. Use o formulário “Nova convocação”.</Alert> : null}
          {convocations.map((c) => {
            const open = !c.completed_at && !c.cancelled_at;
            return (
              <Card key={c.id}><CardBody className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-bold">{c.training_title} <span className="text-sm font-normal text-slate-500">versão {c.training_version}</span></p>
                    <p className="text-xs text-slate-500">Criada em {fmtDateTime(c.created_at)}{c.pnr_reference ? ` · PNR ${c.pnr_reference}` : ""}</p>
                  </div>
                  <StatusBadge status={c.status} />
                </div>
                <dl className="grid gap-3 text-sm sm:grid-cols-3">
                  <div><dt className="text-xs text-slate-500">Vence em</dt><dd className="font-semibold">{c.expires_at ? fmtDateTime(c.expires_at) : "Conta a partir do 1º acesso"}</dd>
                    {open && c.expires_at ? <dd className="text-xs text-slate-500">{remainingText(c.expires_at)}</dd> : null}</div>
                  <div><dt className="text-xs text-slate-500">Primeiro acesso</dt><dd className="font-semibold">{fmtDateTime(c.first_access_at)}</dd></div>
                  <div><dt className="text-xs text-slate-500">Vídeos obrigatórios</dt><dd className="font-semibold">{c.completed_required_videos}/{c.required_videos}</dd></div>
                  <div><dt className="text-xs text-slate-500">Tentativas da prova</dt><dd className="font-semibold">{c.attempts_used}{c.max_attempts ? `/${c.max_attempts}` : ""}{c.best_score !== null ? ` · melhor nota ${Number(c.best_score).toFixed(0)}%` : ""}</dd></div>
                  <div><dt className="text-xs text-slate-500">Termo</dt><dd className="font-semibold">{c.signed ? `Assinado em ${fmtDateTime(c.signed_at)}` : "Não assinado"}</dd></div>
                  {c.blocked_reason ? <div><dt className="text-xs text-slate-500">Motivo do bloqueio</dt><dd>{c.blocked_reason}</dd></div> : null}
                </dl>
                {canWrite && open ? (
                  <div className="space-y-3 border-t border-slate-100 pt-3">
                    <ExtendForm driverId={d.id} convId={c.id} />
                    <div className="flex flex-wrap gap-4"><BlockForm driverId={d.id} convId={c.id} blocked={!!c.blocked_at} /><CancelForm driverId={d.id} convId={c.id} /></div>
                  </div>
                ) : null}
                {attempts.some((a) => a.convocation_id === c.id) ? (
                  <ul className="space-y-1 text-sm">
                    {attempts.filter((a) => a.convocation_id === c.id).map((a) => (
                      <li key={a.id} className="flex flex-wrap items-center gap-2">
                        <Link href={`/admin/tentativas/${a.id}`} className="font-semibold text-brand-600 hover:underline">Prova — {a.attempt_number}ª tentativa</Link>
                        {a.submitted_at ? <><Badge tone={a.passed ? "ok" : "bad"}>{Number(a.score_pct)}% {a.passed ? "aprovado" : "reprovado"}</Badge><span className="text-xs text-slate-500">{fmtDateTime(a.submitted_at)}{a.submit_reason === "time_limit" ? " · tempo esgotado" : ""}</span></> : <Badge tone="accent">em andamento</Badge>}
                      </li>))}
                  </ul>
                ) : null}
                {c.signed ? (
                  <div className="flex flex-wrap gap-4 text-sm font-semibold">
                    <a href={`/api/admin/doc?k=signed&c=${c.id}`} target="_blank" rel="noopener" className="text-brand-600 hover:underline">Termo assinado (PDF)</a>
                    {c.completed_at ? <a href={`/api/admin/doc?k=certificate&c=${c.id}`} target="_blank" rel="noopener" className="text-brand-600 hover:underline">Comprovante (PDF)</a> : null}
                    <Link href={`/admin/assinaturas?q=${encodeURIComponent(d.full_name)}`} className="text-brand-600 hover:underline">Evidências da assinatura</Link>
                  </div>
                ) : null}
                <details className="text-sm"><summary className="cursor-pointer font-semibold text-slate-600">Histórico ({events[c.id]?.length ?? 0})</summary>
                  <ol className="mt-2 space-y-1 border-l-2 border-slate-200 pl-3">
                    {(events[c.id] ?? []).map((e) => (
                      <li key={e.id}><span className="text-xs text-slate-500">{fmtDateTime(e.at)}</span> — {EVENT[e.type] ?? e.type}
                        {e.admin_name ? <span className="text-xs text-slate-500"> por {e.admin_name}</span> : null}
                        {e.type === "extended" && e.details.to ? <span className="text-xs text-slate-500"> (novo vencimento {fmtDateTime(String(e.details.to))})</span> : null}
                        {e.details.reason ? <span className="text-xs text-slate-500"> — {String(e.details.reason)}</span> : null}</li>
                    ))}
                  </ol></details>
              </CardBody></Card>
            );
          })}

          {canWrite ? (
            <Card><CardBody className="space-y-4">
              <CardTitle>Nova convocação</CardTitle>
              <p className="text-sm text-slate-600">Para um novo treinamento ou para refazer um treinamento já concluído. O histórico anterior é mantido.</p>
              <ActionForm action={newConvocationAction.bind(null, d.id)} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Treinamento" htmlFor="trainingId"><Select id="trainingId" name="trainingId" required>
                    {published.map((t) => <option key={t.id} value={t.id}>{t.title} (v{t.published_version})</option>)}</Select></Field>
                  <Field label="Ocorrência PNR" htmlFor="pnrReference"><Input id="pnrReference" name="pnrReference" placeholder="Opcional" /></Field>
                </div>
                <input type="hidden" name="baseId" value={d.base_id ?? ""} />
                <DeadlineFields />
                <Submit>Convocar</Submit>
              </ActionForm>
            </CardBody></Card>
          ) : null}
        </div>

        <div className="space-y-6">
          <Card><CardBody className="space-y-3">
            <CardTitle>Contato</CardTitle>
            <p className="text-sm">Celular: <strong>{d.phone ? maskPhone(d.phone) : "—"}</strong></p>
            <p className="text-sm">E-mail: <strong>{d.email ? maskEmail(d.email) : "—"}</strong></p>
            <p className="text-xs text-slate-500">Cadastrado em {fmtDateTime(d.created_at)}{d.created_by_name ? ` por ${d.created_by_name}` : ""}</p>
            {!d.anonymized_at ? <RevealCpf id={d.id} /> : null}
          </CardBody></Card>
          {canWrite ? (
            <Card><CardBody>
              <details><summary className="cursor-pointer font-bold">Editar dados</summary>
                <ActionForm action={updateDriverAction.bind(null, d.id)} className="mt-4 space-y-4">
                  <DriverFields bases={bases} d={{ ...d, cpf: "" }} />
                  <p className="text-xs text-slate-500">Por segurança o CPF não é exibido aqui. Clique em “Mostrar CPF completo” e digite-o no campo CPF para salvar.</p>
                  <Submit>Salvar alterações</Submit>
                </ActionForm></details>
            </CardBody></Card>
          ) : null}
          <Card><CardBody>
            <CardTitle>Acessos recentes</CardTitle>
            <ul className="mt-3 space-y-2 text-sm">
              {access.length === 0 ? <li className="text-slate-500">Nenhum acesso ainda.</li> : access.map((a, i) => (
                <li key={i} className="flex justify-between gap-2"><span>{ACCESS[a.event] ?? a.event} {a.success ? <Badge tone="ok">ok</Badge> : <Badge tone="bad">falhou</Badge>}</span>
                  <span className="text-xs text-slate-500">{fmtDateTime(a.at)}</span></li>))}
            </ul>
          </CardBody></Card>
          {admin.role === "superadmin" && !d.anonymized_at ? <Card><CardBody><CardTitle>Privacidade (LGPD)</CardTitle><div className="mt-3"><Anonymize id={d.id} /></div></CardBody></Card> : null}
        </div>
      </div>
    </>
  );
}
