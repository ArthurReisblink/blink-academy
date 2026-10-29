"use client";
import { useState } from "react";
import { Field, Input, Select } from "./ui/form";

/** Campos de prazo de acesso: presets em dias, personalizado ou data/hora específica. */
export function DeadlineFields({ defaultPreset = "3" }: { defaultPreset?: string }) {
  const [preset, setPreset] = useState(defaultPreset);
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Prazo de acesso" htmlFor="preset">
        <Select id="preset" name="preset" value={preset} onChange={(e) => setPreset(e.target.value)}>
          <option value="1">1 dia (24 horas)</option>
          <option value="2">2 dias</option>
          <option value="3">3 dias</option>
          <option value="7">7 dias</option>
          <option value="15">15 dias</option>
          <option value="custom">Prazo personalizado</option>
          <option value="until">Data e horário específicos</option>
        </Select>
      </Field>
      {preset === "custom" ? (
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Field label="Duração" htmlFor="customValue"><Input id="customValue" name="customValue" type="number" min={1} max={8760} required /></Field>
          <Field label="Unidade" htmlFor="customUnit">
            <Select id="customUnit" name="customUnit" defaultValue="days"><option value="days">dias</option><option value="hours">horas</option></Select>
          </Field>
        </div>
      ) : null}
      {preset === "until" ? (
        <Field label="Data e horário limite (Brasília)" htmlFor="until"><Input id="until" name="until" type="datetime-local" required /></Field>
      ) : (
        <fieldset className="sm:col-span-2">
          <legend className="mb-1 text-sm font-semibold text-slate-700">O prazo começa a contar</legend>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="radio" name="startMode" value="activation" defaultChecked /> agora, na liberação</label>
            <label className="flex items-center gap-2"><input type="radio" name="startMode" value="first_access" /> no primeiro acesso do motorista</label>
          </div>
        </fieldset>
      )}
    </div>
  );
}
