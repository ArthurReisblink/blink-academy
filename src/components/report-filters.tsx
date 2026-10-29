import Link from "next/link";
import { Input, Select } from "./ui/form";
import { Button } from "./ui/button";
import { STATUS } from "@/server/domain/status";

/** Filtros em uma linha (GET), usados no dashboard e nos relatórios. */
export function ReportFilters({ action, sp, trainings, bases, withStatus, withSearch }: {
  action: string; sp: Record<string, string | undefined>; trainings: { id: string; title: string }[]; bases: { id: string; name: string }[];
  withStatus?: boolean; withSearch?: boolean;
}) {
  const active = ["q", "situacao", "treinamento", "base", "de", "ate"].some((k) => sp[k]);
  return (
    <form action={action} className="mb-6 flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-3">
      {withSearch ? <label className="flex flex-col gap-1 text-xs font-semibold text-slate-500">Busca<Input name="q" defaultValue={sp.q} placeholder="Nome, CPF ou PNR" className="h-10 w-52" /></label> : null}
      {withStatus ? (
        <label className="flex flex-col gap-1 text-xs font-semibold text-slate-500">Situação<Select name="situacao" defaultValue={sp.situacao ?? ""} className="h-10 w-56">
          <option value="">Todas</option>{Object.entries(STATUS).filter(([k]) => k !== "cancelado").map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </Select></label>
      ) : null}
      <label className="flex flex-col gap-1 text-xs font-semibold text-slate-500">Treinamento<Select name="treinamento" defaultValue={sp.treinamento ?? ""} className="h-10 w-56">
        <option value="">Todos</option>{trainings.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</Select></label>
      <label className="flex flex-col gap-1 text-xs font-semibold text-slate-500">Base<Select name="base" defaultValue={sp.base ?? ""} className="h-10 w-56">
        <option value="">Todas</option>{bases.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></label>
      <label className="flex flex-col gap-1 text-xs font-semibold text-slate-500">Convocados de<Input type="date" name="de" defaultValue={sp.de} className="h-10" /></label>
      <label className="flex flex-col gap-1 text-xs font-semibold text-slate-500">até<Input type="date" name="ate" defaultValue={sp.ate} className="h-10" /></label>
      <Button type="submit" variant="outline">Aplicar</Button>
      {active ? <Link href={action} className="self-center text-sm text-brand-600 underline">Limpar</Link> : null}
    </form>
  );
}

export function filtersFrom(sp: Record<string, string | undefined>) {
  return { q: sp.q, status: (sp.situacao && sp.situacao in STATUS ? sp.situacao : "") as keyof typeof STATUS | "", trainingId: sp.treinamento, baseId: sp.base, from: sp.de, to: sp.ate };
}
