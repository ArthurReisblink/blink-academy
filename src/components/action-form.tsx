"use client";
import { useActionState } from "react";
import type { ActionState } from "@/server/web";
import { Alert } from "./ui/misc";

/** Formulário com retorno de erro/sucesso de uma server action. */
export function ActionForm({ action, children, className, success, confirm }: {
  action: (s: ActionState, f: FormData) => Promise<ActionState>; children: React.ReactNode; className?: string; success?: string; confirm?: string;
}) {
  const [state, run] = useActionState(action, null);
  return (
    <form action={run} className={className} onSubmit={(e) => { if (confirm && !window.confirm(confirm)) e.preventDefault(); }}>
      {state?.error ? <Alert tone="bad" className="mb-3">{state.error}</Alert> : null}
      {state?.ok && (state.message || success) ? <Alert tone="ok" className="mb-3">{state.message ?? success}</Alert> : null}
      {children}
    </form>
  );
}
