"use client";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Submit } from "@/components/submit";
import type { ActionState } from "@/server/web";

export function QuestionForm({ action, topics, initial }: {
  action: (s: ActionState, f: FormData) => Promise<ActionState>;
  topics: { id: string; name: string }[];
  initial?: { topicId: string; statement: string; explanation: string; options: string[]; correctIndex: number };
}) {
  const [opts, setOpts] = useState<string[]>(initial?.options ?? ["", "", "", ""]);
  const [correct, setCorrect] = useState(initial?.correctIndex ?? -1);
  return (
    <ActionForm action={action} className="space-y-3">
      <div className="grid gap-3 md:grid-cols-[1fr_2fr]">
        <Field label="Assunto">
          <Select name="topicId" defaultValue={initial?.topicId ?? ""} required>
            <option value="" disabled>Escolha…</option>
            {topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
        </Field>
        <Field label="Enunciado"><Textarea name="statement" rows={2} defaultValue={initial?.statement} required /></Field>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">Alternativas <span className="font-normal text-slate-500">(marque a correta — mínimo 4)</span></legend>
        {opts.map((o, i) => (
          <div key={i} className="flex items-center gap-2">
            <input type="radio" name="correct" value={i} checked={correct === i} onChange={() => setCorrect(i)} aria-label={`Alternativa ${i + 1} é a correta`} className="h-4 w-4 accent-emerald-600" />
            <Input name="option" value={o} onChange={(e) => setOpts(opts.map((x, j) => (j === i ? e.target.value : x)))} placeholder={`Alternativa ${String.fromCharCode(65 + i)}`} />
            {opts.length > 4 ? (
              <button type="button" onClick={() => { setOpts(opts.filter((_, j) => j !== i)); setCorrect(correct === i ? -1 : correct > i ? correct - 1 : correct); }}
                className="text-slate-400 hover:text-red-600" aria-label="Remover alternativa"><Trash2 className="h-4 w-4" /></button>
            ) : null}
          </div>
        ))}
        {opts.length < 8 ? <button type="button" onClick={() => setOpts([...opts, ""])} className="inline-flex items-center gap-1 text-sm font-semibold text-brand-600"><Plus className="h-4 w-4" /> Adicionar alternativa</button> : null}
      </fieldset>
      <Field label="Explicação da resposta correta" hint="Mostrada ao motorista somente depois do envio da prova, se a configuração permitir.">
        <Textarea name="explanation" rows={2} defaultValue={initial?.explanation} />
      </Field>
      <Submit>{initial ? "Salvar alterações" : "Cadastrar pergunta"}</Submit>
    </ActionForm>
  );
}
