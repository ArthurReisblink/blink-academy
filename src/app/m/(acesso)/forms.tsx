"use client";
import { useActionState, useState } from "react";
import { Alert } from "@/components/ui/misc";
import { Field, Input } from "@/components/ui/form";
import { Submit } from "@/components/submit";
import { codeAction, cpfAction } from "./actions";

function maskCpfInput(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 11);
  return d.replace(/^(\d{3})(\d)/, "$1.$2").replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3").replace(/\.(\d{3})(\d{1,2})$/, ".$1-$2");
}

export function CpfForm() {
  const [state, action] = useActionState(cpfAction, null);
  const [cpf, setCpf] = useState("");
  return (
    <form action={action} className="space-y-5">
      {state?.error ? <Alert tone="bad">{state.error}</Alert> : null}
      <Field label="Seu CPF" htmlFor="cpf">
        <Input id="cpf" name="cpf" inputMode="numeric" autoComplete="off" placeholder="000.000.000-00" required
          value={cpf} onChange={(e) => setCpf(maskCpfInput(e.target.value))} className="h-14 text-xl tracking-wider" />
      </Field>
      <Submit size="xl" pendingText="Enviando código…">Receber código de acesso</Submit>
    </form>
  );
}

export function CodeForm() {
  const [state, action] = useActionState(codeAction, null);
  return (
    <form action={action} className="space-y-5">
      {state?.error ? <Alert tone="bad">{state.error}</Alert> : null}
      <Field label="Código de 6 dígitos" htmlFor="code">
        <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]{6}" required autoFocus
          className="h-16 text-center text-3xl font-bold tracking-[0.5em]" />
      </Field>
      <Submit size="xl" pendingText="Verificando…">Entrar</Submit>
    </form>
  );
}
