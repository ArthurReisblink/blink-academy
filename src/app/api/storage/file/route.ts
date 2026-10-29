import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { env } from "@/lib/env";
import { localFilePath, verifyLocal } from "@/server/storage";

export const runtime = "nodejs";

const TYPES: Record<string, string> = { mp4: "video/mp4", pdf: "application/pdf", png: "image/png" };

/** Entrega arquivos do armazenamento local com URL assinada e suporte a Range (avançar/voltar no vídeo). */
export async function GET(req: Request) {
  if (env.storageDriver !== "local") return new Response("Não encontrado", { status: 404 });
  const q = new URL(req.url).searchParams;
  const key = verifyLocal("get", q);
  if (!key) return new Response("Link expirado ou inválido", { status: 403 });
  const path = localFilePath(key);
  let size: number;
  try { size = (await stat(path)).size; } catch { return new Response("Não encontrado", { status: 404 }); }
  const type = TYPES[key.split(".").pop() ?? ""] ?? "application/octet-stream";
  const headers: Record<string, string> = {
    "Content-Type": type, "Accept-Ranges": "bytes", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    "Content-Disposition": q.get("x") ? `attachment; filename="${q.get("x")!.replace(/[^\w.\- ]/g, "_")}"` : "inline",
  };
  const range = req.headers.get("range");
  const m = range ? /bytes=(\d*)-(\d*)/.exec(range) : null;
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : size - Number(m[2]);
    let end = m[1] && m[2] ? Number(m[2]) : size - 1;
    start = Math.max(0, start); end = Math.min(end, size - 1);
    if (start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    const stream = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream;
    return new Response(stream, { status: 206, headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) } });
  }
  const stream = Readable.toWeb(createReadStream(path)) as ReadableStream;
  return new Response(stream, { status: 200, headers: { ...headers, "Content-Length": String(size) } });
}
