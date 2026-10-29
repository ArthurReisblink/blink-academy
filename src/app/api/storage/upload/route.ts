import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { env } from "@/lib/env";
import { localFilePath, verifyLocal } from "@/server/storage";

export const runtime = "nodejs";

/** Recebe o arquivo (PUT) no armazenamento local, com URL assinada. Só para desenvolvimento/testes. */
export async function PUT(req: Request) {
  if (env.storageDriver !== "local") return new Response("Não encontrado", { status: 404 });
  const key = verifyLocal("put", new URL(req.url).searchParams);
  if (!key) return new Response("Link expirado ou inválido", { status: 403 });
  if (!req.body) return new Response("Arquivo vazio", { status: 400 });
  const path = localFilePath(key);
  await mkdir(dirname(path), { recursive: true });
  await pipeline(Readable.fromWeb(req.body as never), createWriteStream(path, { flags: "wx" })).catch((e) => { throw e; });
  return Response.json({ ok: true });
}
