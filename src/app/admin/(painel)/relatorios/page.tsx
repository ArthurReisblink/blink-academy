import Link from "next/link";
import { Download } from "lucide-react";
import { requireAdmin } from "@/server/web";
import { reportRows } from "@/server/services/reports";
import { listTrainings } from "@/server/services/trainings";
import { listBases } from "@/server/services/bases";
import { fmtDateTime } from "@/lib/time";
import { Card, EmptyState, PageHeader } from "@/components/ui/misc";
import { Table, TBody, Td, Th, THead } from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import { ReportFilters, filtersFrom } from "@/components/report-filters";

export const metadata = { title: "Relatórios" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const admin = await requireAdmin();
  const [rows, trainings, bases] = await Promise.all([reportRows(admin, filtersFrom(sp)), listTrainings(admin), listBases(admin, true)]);
  const qs = new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && ["q", "situacao", "treinamento", "base", "de", "ate"].includes(k)) as [string, string][]);
  const exp = (f: string) => `/api/admin/export?${new URLSearchParams([...qs, ["formato", f]])}`;
  const shown = rows.slice(0, 300);
  return (
    <>
      <PageHeader title="Relatórios" description={`${rows.length} convocação(ões) com os filtros atuais.`}
        actions={<div className="flex flex-wrap gap-2">
          {[["csv", "CSV"], ["xlsx", "Excel"], ["pdf", "PDF"]].map(([f, l]) => (
            <a key={f} href={exp(f)} className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold hover:bg-slate-50"><Download className="h-4 w-4" aria-hidden />{l}</a>))}
        </div>} />
      <ReportFilters action="/admin/relatorios" sp={sp} trainings={trainings} bases={bases} withStatus withSearch />
      {rows.length === 0 ? <EmptyState title="Nenhuma convocação encontrada" /> : (
        <Card className="overflow-x-auto">
          <Table>
            <THead><tr><Th>Motorista</Th><Th>Base</Th><Th>Treinamento</Th><Th>Situação</Th><Th>Prazo</Th><Th>Vídeos</Th><Th>Prova</Th><Th>Concluído</Th></tr></THead>
            <TBody>
              {shown.map((r) => (
                <tr key={r.id}>
                  <Td><Link href={`/admin/motoristas/${r.driver_id}`} className="font-semibold text-brand-700 hover:underline">{r.driver_name}</Link><div className="font-mono text-xs text-slate-500">{r.cpf_mask}{r.pnr_reference ? ` · PNR ${r.pnr_reference}` : ""}</div></Td>
                  <Td className="text-sm">{r.base_name ?? "—"}</Td>
                  <Td className="text-sm">{r.training_title} <span className="text-slate-500">v{r.training_version}</span></Td>
                  <Td><StatusBadge status={r.status} /></Td>
                  <Td className="text-sm">{r.expires_at ? fmtDateTime(r.expires_at) : "1º acesso"}</Td>
                  <Td className="tabular-nums">{r.completed_required_videos}/{r.required_videos}</Td>
                  <Td className="text-sm tabular-nums">{r.best_score !== null ? `${Number(r.best_score)}%` : "—"} <span className="text-slate-500">({r.attempts_used}/{r.max_attempts})</span></Td>
                  <Td className="text-sm">{r.completed_at ? fmtDateTime(r.completed_at) : "—"}</Td>
                </tr>))}
            </TBody>
          </Table>
          {rows.length > shown.length ? <p className="p-4 text-sm text-slate-500">Mostrando {shown.length} de {rows.length}. Use a exportação para ver todas.</p> : null}
        </Card>
      )}
      <p className="mt-4 text-xs text-slate-500">As exportações contêm dados pessoais (nome e CPF mascarado). Cada exportação fica registrada na auditoria.</p>
    </>
  );
}
