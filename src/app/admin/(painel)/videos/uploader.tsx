"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Progress } from "@/components/ui/misc";
import { Field, Input, Textarea } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { finishUploadAction, startUploadAction } from "./actions";

function readDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => { URL.revokeObjectURL(v.src); resolve(v.duration); };
    v.onerror = () => reject(new Error("Não foi possível ler o vídeo. Use um MP4 (H.264)."));
    v.src = URL.createObjectURL(file);
  });
}

/** Envio direto do navegador para o armazenamento privado (sem passar o arquivo pelo servidor). */
export function VideoUploader() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [pct, setPct] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  async function upload() {
    const file = fileRef.current?.files?.[0];
    setMsg(null);
    if (!file) return setMsg({ tone: "bad", text: "Selecione o arquivo MP4." });
    if (file.type !== "video/mp4") return setMsg({ tone: "bad", text: "Envie um arquivo MP4." });
    try {
      const duration = await readDuration(file);
      const start = await startUploadAction({ title: title || file.name.replace(/\.mp4$/i, ""), description, contentType: file.type, size: file.size, duration });
      if (start?.error) return setMsg({ tone: "bad", text: start.error });
      const { videoId, upload } = start!.data as { videoId: string; upload: { url: string; method: string; headers: Record<string, string> } };
      setPct(0);
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open(upload.method, upload.url);
        for (const [k, v] of Object.entries(upload.headers)) xhr.setRequestHeader(k, v);
        xhr.upload.onprogress = (e) => e.lengthComputable && setPct((e.loaded / e.total) * 100);
        xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(`Falha no envio (${xhr.status}).`)));
        xhr.onerror = () => reject(new Error("Falha de conexão durante o envio."));
        xhr.send(file);
      });
      const fin = await finishUploadAction(videoId);
      if (fin?.error) return setMsg({ tone: "bad", text: fin.error });
      setMsg({ tone: "ok", text: "Vídeo enviado e disponível na biblioteca." });
      setTitle(""); setDescription(""); if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    } catch (e) {
      setMsg({ tone: "bad", text: (e as Error).message });
    } finally {
      setPct(null);
    }
  }

  return (
    <div className="space-y-4">
      {msg ? <Alert tone={msg.tone}>{msg.text}</Alert> : null}
      <Field label="Arquivo de vídeo (MP4)" htmlFor="video-file"><Input id="video-file" ref={fileRef} type="file" accept="video/mp4" className="pt-2" /></Field>
      <Field label="Título" htmlFor="video-title"><Input id="video-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: O que é POD" /></Field>
      <Field label="Descrição" htmlFor="video-desc"><Textarea id="video-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      {pct !== null ? <div><p className="mb-1 text-sm">Enviando… {Math.floor(pct)}%</p><Progress value={pct} /></div> : null}
      <Button type="button" onClick={upload} disabled={pct !== null}>Enviar vídeo</Button>
    </div>
  );
}
