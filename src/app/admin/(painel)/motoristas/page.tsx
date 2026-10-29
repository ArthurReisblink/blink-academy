import Link from "next/link";
import { requireAdmin } from "@/server/web";
import { listDrivers } from "@/server/services/drivers";
import { listBases } from "@/server/services/bases";
import { listTrainings } from "@/server/services/trainings";
import { STATUS, type StatusKey } from "@/server/domain/status";
import { fmtDateTime } from "@/lib/time";
import { maskPhone } from "@/lib/contact";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { buttonVariants } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { Table, TBody, Td, Th, THead } from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";

export const metadata = { title: "Motoristas" };

type SP = Promise<Record<string, string | undefined>>;

export default async function Page({ searchParams }: { searchParams: SP }) {
  const admin = await requireAdmin();
  const sp = await searchParams;
  const page = Number(sp.page ?? 1) || 1;
  const [list, bases, trainings] = await Promise.all([
    listDrivers(admin, { q: sp.q, baseId: sp.base || undefined, status: (sp.status as StatusKey) || "", trainingId: sp.training || undefined, page }),
    listBases(admin), listTrainings(admin),
  ]);
  const pages = Math.max(1, Math.ceil(list.total / list.pageSize));
  const qs = (p: number) => new URLSearchParams({ ...Object.fromEntries(Object.entries(sp).filter(([, v]) => v) as [string, string][]), page: String(p) }).toString();
  return (
    <>
      <PageHeader title="Motoristas" description={`${list.total} motorista(s) encontrados`}
        actions={admin.role !== "auditor" ? <>
          <Link href="/admin/motoristas/importar" className={buttonVariants({ variant: "outline" })}>Importar CSV</Link>
          <Link href="/admin/motoristas/novo" className={buttonVariants()}>Novo motorista</Link>
        </> : null} />
      <form className="mb-5 grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-5">
        <Input name="q" defaultValue={sp.q} placeholder="Nome, CPF completo, e-mail ou telefone" className="lg:col-span-2" aria-label="Buscar" />
        <Select name="base" defaultValue={sp.base ?? ""} aria-label="Base">
          <option value="">Todas as bases</option>
          {bases.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </Select>
        <Select name="training" defaultValue={sp.training ?? ""} aria-label="Treinamento">
          <option value="">Todos os treinamentos</option>
          {trainings.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
        </Select>
        <Select name="status" defaultValue={sp.status ?? ""} aria-label="Situação">
          <option value="">Todas as situações</option>
          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </Select>
        <div className="flex gap-2 sm:col-span-2 lg:col-span-5">
          <button className={buttonVariants({ size: "sm" })}>Filtrar</button>
          <Link href="/admin/motoristas" className={buttonVariants({ size: "sm", variant: "ghost" })}>Limpar</Link>
        </div>
      </form>
      {list.rows.length === 0 ? <EmptyState title="Nenhum motorista encontrado">Ajuste os filtros ou cadastre um novo motorista.</EmptyState> : (
        <Table>
          <THead><tr><Th>Motorista</Th><Th>CPF</Th><Th>Base</Th><Th>Treinamento</Th><Th>Situação</Th><Th>Prazo</Th></tr></THead>
          <TBody>
            {list.rows.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <Td><Link href={`/admin/motoristas/${r.id}`} className="font-semibold text-brand-700 hover:underline">{r.full_name}</Link>
                  <div className="text-xs text-slate-500">{r.phone ? maskPhone(r.phone) : r.email}</div></Td>
                <Td className="whitespace-nowrap font-mono text-xs">{r.cpf_mask}</Td>
                <Td>{r.base_name ?? "—"}</Td>
                <Td>{r.conv ? <>{r.conv.training_title} <span className="text-xs text-slate-500">v{r.conv.training_version}</span>{r.conv.pnr_reference ? <div className="text-xs text-slate-500">PNR {r.conv.pnr_reference}</div> : null}</> : <span className="text-slate-400">Sem convocação</span>}</Td>
                <Td>{r.driver_status === "blocked" ? <StatusBadge status="bloqueado" /> : r.conv ? <StatusBadge status={r.conv.status} /> : "—"}</Td>
                <Td className="whitespace-nowrap text-xs">{r.conv?.expires_at ? fmtDateTime(r.conv.expires_at) : r.conv ? "No 1º acesso" : "—"}</Td>
              </tr>
            ))}
          </TBody>
        </Table>
      )}
      {pages > 1 ? (
        <nav className="mt-4 flex items-center justify-center gap-2 text-sm">
          {page > 1 ? <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`?${qs(page - 1)}`}>Anterior</Link> : null}
          <span>Página {page} de {pages}</span>
          {page < pages ? <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`?${qs(page + 1)}`}>Próxima</Link> : null}
        </nav>
      ) : null}
    </>
  );
}
