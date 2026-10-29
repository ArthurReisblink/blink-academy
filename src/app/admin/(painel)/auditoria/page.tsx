import Link from "next/link";
import { requireAdmin } from "@/server/web";
import { listAudit } from "@/server/services/admin-tools";
import { fmtDateTime } from "@/lib/time";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/misc";
import { Input } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Table, TBody, Td, Th, THead } from "@/components/ui/table";

export const metadata = { title: "Auditoria" };

const short = (o: Record<string, unknown>) => { const s = JSON.stringify(o); return s === "{}" ? "" : s.length > 160 ? s.slice(0, 160) + "…" : s; };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const admin = await requireAdmin();
  const kind = sp.tipo === "acessos" ? "auth" : "admin";
  const page = Math.max(1, Number(sp.pagina) || 1);
  const r = await listAudit(admin, { kind, q: sp.q, from: sp.de, to: sp.ate, page });
  const link = (p: Record<string, string | number | undefined>) => `/admin/auditoria?${new URLSearchParams(Object.entries({ tipo: sp.tipo, q: sp.q, de: sp.de, ate: sp.ate, ...p }).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)]))}`;
  return (
    <>
      <PageHeader title="Auditoria" description="Registros somente de inclusão: não podem ser alterados nem apagados pelo painel." />
      <div className="mb-4 flex gap-2">
        <Link href={link({ tipo: undefined, pagina: undefined })} className={`rounded-full px-4 py-1.5 text-sm font-semibold ${kind === "admin" ? "bg-brand-600 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200"}`}>Ações administrativas</Link>
        <Link href={link({ tipo: "acessos", pagina: undefined })} className={`rounded-full px-4 py-1.5 text-sm font-semibold ${kind === "auth" ? "bg-brand-600 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200"}`}>Acessos e códigos</Link>
      </div>
      <form className="mb-4 flex flex-wrap items-end gap-2">
        {sp.tipo ? <input type="hidden" name="tipo" value={sp.tipo} /> : null}
        <Input name="q" defaultValue={sp.q} placeholder={kind === "admin" ? "Ação, entidade, administrador ou ID" : "Evento, nome ou IP"} className="w-72" />
        <label className="text-xs text-slate-500">de <Input type="date" name="de" defaultValue={sp.de} className="h-10" /></label>
        <label className="text-xs text-slate-500">até <Input type="date" name="ate" defaultValue={sp.ate} className="h-10" /></label>
        <Button type="submit" variant="outline">Filtrar</Button>
      </form>
      {(kind === "admin" ? r.admin.length : r.auth.length) === 0 ? <EmptyState title="Nenhum registro" /> : (
        <Card className="overflow-x-auto">
          <Table>
            {kind === "admin" ? (
              <>
                <THead><tr><Th>Quando</Th><Th>Quem</Th><Th>Ação</Th><Th>Objeto</Th><Th>Detalhes</Th><Th>IP</Th></tr></THead>
                <TBody>{r.admin.map((l) => (
                  <tr key={l.id}><Td className="whitespace-nowrap text-sm">{fmtDateTime(l.at)}</Td><Td className="text-sm">{l.admin_name ?? "Sistema"}</Td>
                    <Td className="font-mono text-xs">{l.action}</Td><Td className="text-xs">{l.entity}{l.entity_id ? <div className="font-mono text-slate-400">{l.entity_id.slice(0, 13)}</div> : null}</Td>
                    <Td className="max-w-md break-all font-mono text-xs text-slate-600">{short(l.details)}</Td><Td className="text-xs">{l.ip ?? ""}</Td></tr>))}</TBody>
              </>
            ) : (
              <>
                <THead><tr><Th>Quando</Th><Th>Quem</Th><Th>Evento</Th><Th>Resultado</Th><Th>Detalhes</Th><Th>IP</Th></tr></THead>
                <TBody>{r.auth.map((l) => (
                  <tr key={l.id}><Td className="whitespace-nowrap text-sm">{fmtDateTime(l.at)}</Td>
                    <Td className="text-sm">{l.subject_name ?? "—"}<div className="text-xs text-slate-400">{l.subject_type === "driver" ? "motorista" : l.subject_type ? "administrador" : ""}</div></Td>
                    <Td className="font-mono text-xs">{l.event}</Td><Td>{l.success ? <Badge tone="ok">ok</Badge> : <Badge tone="bad">falhou</Badge>}</Td>
                    <Td className="max-w-md break-all font-mono text-xs text-slate-600">{short(l.details)}</Td><Td className="text-xs">{l.ip ?? ""}</Td></tr>))}</TBody>
              </>
            )}
          </Table>
        </Card>
      )}
      <div className="mt-4 flex justify-between text-sm font-semibold">
        {page > 1 ? <Link href={link({ pagina: page - 1 })} className="text-brand-600 underline">← Mais recentes</Link> : <span />}
        {r.hasMore ? <Link href={link({ pagina: page + 1 })} className="text-brand-600 underline">Mais antigos →</Link> : null}
      </div>
    </>
  );
}
