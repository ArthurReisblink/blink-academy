"use client";
import { useActionState } from "react";
import { Alert } from "@/components/ui/misc";
import { Field, Input } from "@/components/ui/form";
import { Submit } from "@/components/submit";
import { loginAction, totpAction } from "./actions";

export function LoginForm() {
  const [state, action] = useActionState(loginAction, null);
  return (
    <form action={action} className="space-y-4">
      {state?.error ? <Alert tone="bad">{state.error}</Alert> : null}
      <Field label="E-mail" htmlFor="email"><Input id="email" name="email" type="email" autoComplete="username" required /></Field>
      <Field label="Senha" htmlFor="password"><Input id="password" name="password" type="password" autoComplete="current-password" required /></Field>
      <Submit size="lg" className="w-full">Continuar</Submit>
    </form>
  );
}

export function TotpForm() {
  const [state, action] = useActionState(totpAction, null);
  return (
    <form action={action} className="space-y-4">
      {state?.error ? <Alert tone="bad">{state.error}</Alert> : null}
      <Field label="Código de 6 dígitos do aplicativo autenticador" htmlFor="code">
        <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required className="text-center text-2xl tracking-[0.4em]" />
      </Field>
      <Submit size="lg" className="w-full">Entrar</Submit>
    </form>
  );
}
