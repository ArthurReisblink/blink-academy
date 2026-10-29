"use client";
import { ActionForm } from "@/components/action-form";
import { Input } from "@/components/ui/form";
import { Submit } from "@/components/submit";
import { anonymizeAction, revealCpfAction } from "../actions";

export function RevealCpf({ id }: { id: string }) {
  return <ActionForm action={revealCpfAction.bind(null, id)}><Submit size="sm" variant="outline">Mostrar CPF completo</Submit></ActionForm>;
}

export function Anonymize({ id }: { id: string }) {
  return (
    <ActionForm action={anonymizeAction.bind(null, id)} className="space-y-2">
      <p className="text-xs text-slate-600">Remove nome, CPF, telefone e e-mail (pedido do titular, LGPD). Os registros de treinamento ficam, sem identificação. Não pode ser desfeito.</p>
      <div className="flex gap-2"><Input name="confirm" placeholder="Digite ANONIMIZAR" className="h-9 w-48" /><Submit size="sm" variant="danger">Anonimizar</Submit></div>
    </ActionForm>
  );
}
