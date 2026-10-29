import { Field, Input, Select, Textarea } from "@/components/ui/form";

type E = { title: string; description: string | null; question_count: number; pass_pct: string | number; max_attempts: number; time_limit_minutes: number | null;
  selection_mode: string; topic_ids: string[]; shuffle_questions: boolean; shuffle_options: boolean; display_mode: string; active: boolean };

export function ExamFields({ e, topics, defaults }: { e?: E; topics: { id: string; name: string; questions: number }[]; defaults?: { pass_pct: number; max_attempts: number; question_count: number } }) {
  return (
    <div className="space-y-4">
      <Field label="Título da prova" htmlFor="title"><Input id="title" name="title" defaultValue={e?.title ?? "Avaliação — POD e PNR"} required /></Field>
      <Field label="Orientações ao motorista (opcional)" htmlFor="description"><Textarea id="description" name="description" rows={2} defaultValue={e?.description ?? ""} /></Field>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Nº de questões" htmlFor="questionCount"><Input id="questionCount" name="questionCount" type="number" min={1} max={100} defaultValue={e?.question_count ?? defaults?.question_count ?? 10} required /></Field>
        <Field label="Nota mínima (%)" htmlFor="passPct"><Input id="passPct" name="passPct" type="number" min={1} max={100} step="0.01" defaultValue={Number(e?.pass_pct ?? defaults?.pass_pct ?? 80)} required /></Field>
        <Field label="Tentativas" htmlFor="maxAttempts"><Input id="maxAttempts" name="maxAttempts" type="number" min={1} max={20} defaultValue={e?.max_attempts ?? defaults?.max_attempts ?? 3} required /></Field>
        <Field label="Tempo-limite (min)" hint="Vazio = sem limite" htmlFor="timeLimitMinutes"><Input id="timeLimitMinutes" name="timeLimitMinutes" type="number" min={1} max={600} defaultValue={e?.time_limit_minutes ?? ""} /></Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Seleção das questões" htmlFor="selectionMode">
          <Select id="selectionMode" name="selectionMode" defaultValue={e?.selection_mode ?? "random"}>
            <option value="random">Aleatória (sorteio no banco)</option>
            <option value="manual">Manual (perguntas escolhidas)</option>
          </Select>
        </Field>
        <Field label="Exibição" htmlFor="displayMode">
          <Select id="displayMode" name="displayMode" defaultValue={e?.display_mode ?? "one"}>
            <option value="one">Uma pergunta por vez</option>
            <option value="all">Todas na mesma página</option>
          </Select>
        </Field>
      </div>
      <fieldset>
        <legend className="mb-1 text-sm font-semibold">Assuntos do sorteio <span className="font-normal text-slate-500">(nenhum marcado = todos)</span></legend>
        <div className="grid gap-1 sm:grid-cols-2">
          {topics.map((t) => (
            <label key={t.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="topicIds" value={t.id} defaultChecked={e?.topic_ids.includes(t.id)} /> {t.name} <span className="text-slate-400">({t.questions})</span></label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" name="shuffleQuestions" defaultChecked={e?.shuffle_questions ?? true} /> Embaralhar perguntas</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="shuffleOptions" defaultChecked={e?.shuffle_options ?? true} /> Embaralhar alternativas</label>
        {e ? <label className="flex items-center gap-2"><input type="hidden" name="active" value="off" /><input type="checkbox" name="active" defaultChecked={e.active} /> Ativa</label> : null}
      </div>
    </div>
  );
}
