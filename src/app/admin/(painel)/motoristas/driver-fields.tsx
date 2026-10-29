import { Field, Input, Select, Textarea } from "@/components/ui/form";

export function DriverFields({ bases, d }: { bases: { id: string; name: string }[]; d?: { full_name: string; cpf?: string; phone: string | null; email: string | null; base_id: string | null; notes: string | null } }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Nome completo" htmlFor="fullName" className="sm:col-span-2"><Input id="fullName" name="fullName" required defaultValue={d?.full_name} /></Field>
      <Field label="CPF" htmlFor="cpf" hint={d ? "Para corrigir o CPF, digite-o novamente completo." : "Validamos os dígitos verificadores."}>
        <Input id="cpf" name="cpf" inputMode="numeric" required placeholder="000.000.000-00" defaultValue={d?.cpf} />
      </Field>
      <Field label="Base operacional" htmlFor="baseId">
        <Select id="baseId" name="baseId" defaultValue={d?.base_id ?? ""}>
          <option value="">— selecione —</option>
          {bases.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </Select>
      </Field>
      <Field label="Celular (recebe o código por SMS)" htmlFor="phone"><Input id="phone" name="phone" inputMode="tel" placeholder="(27) 99999-0000" defaultValue={d?.phone ?? ""} /></Field>
      <Field label="E-mail" htmlFor="email"><Input id="email" name="email" type="email" defaultValue={d?.email ?? ""} /></Field>
      <Field label="Observações internas" htmlFor="notes" className="sm:col-span-2"><Textarea id="notes" name="notes" rows={2} defaultValue={d?.notes ?? ""} /></Field>
    </div>
  );
}
