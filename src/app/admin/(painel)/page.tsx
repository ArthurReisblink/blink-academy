import Link from "next/link";
import { requireAdmin } from "@/server/web";
import { dashboard } from "@/server/services/reports";
import { listTrainings } from "@/server/services/trainings";
import { listBases } from "@/server/services/bases";
import { STATUS, type StatusKey } from "@/server/domain/status";
import { fmtDateTime, fmtDay, remainingText } from "@/lib/time";
import { Card, CardBody, CardTitle, PageHeader } from "@/components/ui/misc";
import { StatusBadge } from "@/components/status-badge";
import { ReportFilters, filtersFrom } from "@/components/report-filters";

export const metadata = { title: "Dashboard" };

const ORDER: StatusKey[] = ["aguardando_acesso", "iniciado", "assistindo", "videos_concluidos", "prova_disponivel", "prova_em_andamento", "reprovado", "aprovado_aguardando_assinatura", "concluido", "expirado", "bloqueado"];
const BAR: Record<string, string> = { slate: "bg-slate-400", brand: "bg-brand-600", accent: "bg-accent-500", bad: "bg-bad-600", warn: "bg-amber-500", ok: "bg-ok-600" };

function Tile({ label, value, hint, href }: { label: string; value: string | number; hint?: string; href?: string }) {
  const body = (
    <Card className="h-full"><CardBody>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-3xl font-extrabold tabular-nums text-slate-900">{value}</p>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </CardBody></Card>
  );
  return href ? <Link href={href} className="block hover:opacity-90">{body}</Link> : body;
}

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const admin = await requireAdmin();
  const f = filtersFrom(sp);
  const [d, trainings, bases] = await Promise.all([dashboard(admin, f), listTrainings(admin), listBases(admin, true)]);
  const qs = new URLSearchParams(Object.entries({ treinamento: sp.treinamento, base: sp.base, de: sp.de, ate: sp.ate }).filter(([, v]) => v) as [string, string][]);
  const rel = (situacao?: string) => `/admin/relatorios?${new URLSearchParams([...qs, ...(situacao ? [["situacao", situacao]] : [])])}`;
  const maxStatus = Math.max(1, ...ORDER.map((k) => d.byStatus[k]));
  const maxDay = Math.max(1, ...d.daily.map((x) => x.completed));
  const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : "—");
  return (
    <>
      <PageHeader title={`Olá, ${admin.name.split(" ")[0]}`} description="Visão geral das convocações. Clique nos números para ver a lista." />
      <ReportFilters action="/admin" sp={sp} trainings={trainings} bases={bases} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tile label="Convocações" value={d.total} hint={`${d.pending} em andamento`} href={rel()} />
        <Tile label="Concluídos" value={d.completed} hint={`${d.completionRate}% das convocações`} href={rel("concluido")} />
        <Tile label="Vencem em 24 h" value={d.expiringCount} hint={`${d.notStarted} ainda sem acesso`} href={rel()} />
        <Tile label="Prazo expirado" value={d.expired} hint={`${d.failed} reprovado(s) · ${d.awaitingSignature} aguardando assinatura`} href={rel("expirado")} />
        <Tile label="Aprovação na 1ª tentativa" value={pct(d.firstTryPass, d.withExam)} hint={`${d.withExam} motorista(s) já fizeram a prova`} />
        <Tile label="Nota média" value={d.avgScore === null ? "—" : `${d.avgScore}%`} hint={`${d.attempts} prova(s) enviada(s)`} />
        <Tile label="Aprovação por prova" value={pct(d.passedAttempts, d.attempts)} hint={`${d.passedAttempts} aprovadas`} />
        <Tile label="Vídeos obrigatórios concluídos" value={d.videoPct === null ? "—" : `${d.videoPct}%`} hint="sobre todos os vídeos exigidos" />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card><CardBody>
          <CardTitle>Situação das convocações</CardTitle>
          <ul className="mt-4 space-y-2">
            {ORDER.map((k) => (
              <li key={k}>
                <Link href={rel(k)} className="group grid grid-cols-[13rem_1fr_3rem] items-center gap-3 text-sm" title={`${STATUS[k].label}: ${d.byStatus[k]}`}>
                  <span className="truncate text-slate-700 group-hover:underline">{STATUS[k].label}</span>
                  <span className="h-3 rounded-r bg-slate-100"><span className={`block h-3 rounded-r ${BAR[STATUS[k].tone]}`} style={{ width: `${(100 * d.byStatus[k]) / maxStatus}%`, minWidth: d.byStatus[k] ? 4 : 0 }} /></span>
                  <span className="text-right font-semibold tabular-nums">{d.byStatus[k]}</span>
                </Link>
              </li>
            ))}
          </ul>
        </CardBody></Card>

        <Card><CardBody>
          <CardTitle>Treinamentos concluídos — últimos 30 dias</CardTitle>
          <div className="mt-4 flex h-44 items-end gap-[2px] border-b border-slate-200" role="img" aria-label="Conclusões por dia nos últimos 30 dias">
            {d.daily.map((x) => (
              <div key={x.day} className="group relative flex h-full flex-1 items-end">
                <div className="w-full rounded-t bg-brand-600 group-hover:bg-brand-700" style={{ height: `${(100 * x.completed) / maxDay}%`, minHeight: x.completed ? 3 : 0 }} />
                <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-xs text-white group-hover:block">
                  {fmtDay(x.day + "T12:00:00-03:00")}: {x.completed} concluído(s), {x.exams} prova(s)
                </div>
              </div>
            ))}
          </div>
          <div className="mt-1 flex justify-between text-xs text-slate-500"><span>{fmtDay(d.daily[0]?.day + "T12:00:00-03:00")}</span><span>hoje</span></div>
          <p className="mt-2 text-xs text-slate-500">Total no período: {d.daily.reduce((n, x) => n + x.completed, 0)} conclusão(ões). Passe o mouse sobre as barras para ver o dia.</p>
        </CardBody></Card>

        <Card><CardBody>
          <CardTitle>Vencem nas próximas 24 horas</CardTitle>
          {d.expiring.length === 0 ? <p className="mt-3 text-sm text-slate-500">Nenhuma convocação vencendo.</p> : (
            <ul className="mt-3 divide-y divide-slate-100">
              {d.expiring.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <Link href={`/admin/motoristas/${c.driver_id}`} className="font-semibold text-brand-700 hover:underline">{c.driver_name}</Link>
                  <span className="flex items-center gap-2"><StatusBadge status={c.status} /><span className="text-xs text-slate-500">{remainingText(c.expires_at)} · {fmtDateTime(c.expires_at)}</span></span>
                </li>))}
            </ul>
          )}
        </CardBody></Card>

        <Card><CardBody>
          <CardTitle>Perguntas com mais erros</CardTitle>
          {d.hardest.length === 0 ? <p className="mt-3 text-sm text-slate-500">Ainda não há provas enviadas.</p> : (
            <ol className="mt-3 space-y-3">
              {d.hardest.map((h, i) => (
                <li key={i} className="text-sm">
                  <div className="flex justify-between gap-3"><span>{h.statement}</span><span className="shrink-0 font-bold tabular-nums">{h.error_rate}%</span></div>
                  <div className="text-xs text-slate-500">{h.topic} · {h.answered} resposta(s)</div>
                </li>))}
            </ol>
          )}
          <Link href="/admin/questoes" className="mt-3 inline-block text-sm font-semibold text-brand-600 underline">Revisar banco de questões</Link>
        </CardBody></Card>
      </div>
    </>
  );
}
