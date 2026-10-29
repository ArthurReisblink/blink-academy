"use client";
import { useState } from "react";

/** Confere, no próprio navegador, se o PDF em mãos é idêntico ao registrado (o arquivo não é enviado). */
export function FileCheck({ hashes }: { hashes: string[] }) {
  const [result, setResult] = useState<null | boolean>(null);
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    const buf = await f.arrayBuffer();
    const h = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", buf))).map((b) => b.toString(16).padStart(2, "0")).join("");
    setResult(hashes.includes(h));
  };
  return (
    <div className="space-y-2 text-sm">
      <label className="block font-semibold" htmlFor="pdf-check">Conferir o arquivo PDF recebido</label>
      <input id="pdf-check" type="file" accept="application/pdf,.pdf" onChange={(e) => onFile(e.target.files?.[0])} className="block w-full text-sm" />
      {result === true ? <p className="font-semibold text-ok-600">O arquivo é idêntico ao registrado.</p> : null}
      {result === false ? <p className="font-semibold text-bad-600">O arquivo NÃO confere com o registrado (pode ter sido alterado).</p> : null}
      <p className="text-xs text-slate-500">A conferência é feita no seu aparelho; o arquivo não é enviado.</p>
    </div>
  );
}
