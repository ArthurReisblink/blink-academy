"use client";
import { useState } from "react";
import { ActionForm } from "@/components/action-form";
import { Input } from "@/components/ui/form";
import { Submit } from "@/components/submit";
import { Button } from "@/components/ui/button";
import { deleteVideoAction, previewUrlAction, updateVideoAction } from "./actions";

export function VideoPreview({ id }: { id: string }) {
  const [url, setUrl] = useState<string | null>(null);
  if (url) return <video src={url} controls className="mt-2 w-full max-w-md rounded-lg bg-black" />;
  return <Button size="sm" variant="outline" type="button" onClick={async () => { const r = await previewUrlAction(id); if (r?.data) setUrl(String(r.data)); }}>Pré-visualizar</Button>;
}

export function VideoEdit({ id, title, description, canDelete }: { id: string; title: string; description: string | null; canDelete: boolean }) {
  return (
    <details className="text-sm"><summary className="cursor-pointer font-semibold text-brand-600">Editar</summary>
      <ActionForm action={updateVideoAction.bind(null, id)} className="mt-2 space-y-2">
        <Input name="title" defaultValue={title} required />
        <Input name="description" defaultValue={description ?? ""} placeholder="Descrição" />
        <Submit size="sm">Salvar</Submit>
      </ActionForm>
      {canDelete ? <ActionForm action={deleteVideoAction.bind(null, id)} confirm="Excluir este vídeo da biblioteca?" className="mt-2"><Submit size="sm" variant="ghost" className="text-bad-600">Excluir</Submit></ActionForm> : null}
    </details>
  );
}
