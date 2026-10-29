"use client";
import { useState } from "react";
import { ActionForm } from "@/components/action-form";
import { Field, Input, Select } from "@/components/ui/form";
import { Submit } from "@/components/submit";
import { blockConvAction, cancelConvAction, extendAction } from "../actions";

export function ExtendForm({ driverId, convId }: { driverId: string; convId: string }) {
  const [mode, setMode] = useState("24");
  return (
    <ActionForm action={extendAction.bind(null, driverId, convId)} className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Prorrogar" htmlFor={`ext-${convId}`}>
          <Select id={`ext-${convId}`} name="extMode" value={mode} onChange={(e) => setMode(e.target.value)} className="h-9 w-48 text-sm">
            <option value="24">+1 dia (24 h)</option><option value="48">+2 dias</option><option value="72">+3 dias</option>
            <option value="168">+7 dias</option><option value="360">+15 dias</option>
            <option value="custom">+ horas personalizadas</option><option value="until">até data e horário</option>
          </Select>
        </Field>
        {mode === "custom" ? <Input name="hours" type="number" min={1} max={8760} placeholder="horas" className="h-9 w-28" required /> : null}
        {mode === "until" ? <Input name="until" type="datetime-local" className="h-9 w-56" required /> : null}
        <Submit size="sm">Prorrogar</Submit>
      </div>
    </ActionForm>
  );
}

export function BlockForm({ driverId, convId, blocked }: { driverId: string; convId: string; blocked: boolean }) {
  return (
    <ActionForm action={blockConvAction.bind(null, driverId, convId, !blocked)} className="flex flex-wrap items-end gap-2">
      {!blocked ? <Input name="reason" placeholder="Motivo do bloqueio" className="h-9 w-56" /> : null}
      <Submit size="sm" variant={blocked ? "success" : "outline"}>{blocked ? "Reativar acesso" : "Bloquear acesso"}</Submit>
    </ActionForm>
  );
}

export function CancelForm({ driverId, convId }: { driverId: string; convId: string }) {
  return (
    <ActionForm action={cancelConvAction.bind(null, driverId, convId)} confirm="Cancelar esta convocação? O histórico é mantido." className="flex flex-wrap items-end gap-2">
      <Input name="reason" placeholder="Motivo do cancelamento" className="h-9 w-56" />
      <Submit size="sm" variant="ghost" className="text-bad-600">Cancelar convocação</Submit>
    </ActionForm>
  );
}
