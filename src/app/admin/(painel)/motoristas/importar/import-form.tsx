"use client";
import { useActionState } from "react";
import type { ImportLine } from "@/server/services/drivers";
import { Alert, Badge } from "@/components/ui/misc";
import { Field, Input, Select } from "@/components/ui/form";
import { Submit } from "@/components/submit";
import { DeadlineFields } from "@/components/deadline-fields";
import { Table, TBody, Td, Th, THead } from "@/components/ui/table";
import { importCsvAction } from "../actions";

export function ImportForm({ trainings }: { trainings: { id: string; title: string; published_version: number | null }[] }) {
  const [state, action] = useActionState(importCsvAction, null);
  const results = (state?.data ?? []) as ImportLine[];
  const count = (k: ImportLine["result"]) => results.filter((r) => r.result === k).length;
  return (
    <div className="space-y-6">
      <form action={action} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
        {state?.error ? <Alert tone="bad">{state.error}</Alert> : null}
        <Field label="Arquivo CSV" htmlFor="file" hint="Separador ; ou , — colunas: nome, cpf, telefone, email, base, ocorrencia_pnr. Arquivos salvos pelo Excel são aceitos.">
          <Input id="file" name="file" type="file" accept=".csv,text/csv" required className="pt-2" />
        </Field>
        <Field label="Convocar para o treinamento" htmlFor="trainingId">
          <Select id="trainingId" name="trainingId" defaultValue={trainings[0]?.id ?? ""}>
            <option value="">Só cadastrar (sem convocação)</option>
            {trainings.map((t) => <option key={t.id} value={t.id}>{t.title} (v{t.published_version})</option>)}
          </Select>
        </Field>
        <DeadlineFields />
        <Submit pendingText="Importando…">Importar</Submit>
      </form>
      {results.length ? (
        <>
          <Alert tone={count("error") ? "warn" : "ok"} title="Importação concluída">
            {count("created")} cadastrado(s), {count("convocated")} já existente(s) reconvocado(s), {count("error")} linha(s) com erro (não importadas).
          </Alert>
          <Table>
            <THead><tr><Th>Linha</Th><Th>Nome</Th><Th>CPF</Th><Th>Resultado</Th></tr></THead>
            <TBody>{results.map((r) => (
              <tr key={r.line}><Td>{r.line}</Td><Td>{r.name}</Td><Td className="font-mono text-xs">{r.cpf}</Td>
                <Td><Badge tone={r.result === "error" ? "bad" : "ok"}>{r.result === "error" ? "Erro" : "OK"}</Badge> <span className="text-sm">{r.message}</span></Td></tr>))}
            </TBody>
          </Table>
        </>
      ) : null}
    </div>
  );
}
