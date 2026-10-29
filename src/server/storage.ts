import "server-only";
import { createHmac } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { safeEqual } from "@/lib/crypto";
import { AppError } from "@/lib/errors";

/**
 * Armazenamento privado de vídeos e PDFs.
 *  - "supabase": bucket privado; leitura e envio só por URLs assinadas de curta duração.
 *  - "local": pasta no servidor, servida pela rota /api/storage com assinatura HMAC (desenvolvimento e testes).
 * Nenhum arquivo tem URL pública permanente.
 */
export type UploadTarget = { url: string; method: "PUT"; headers: Record<string, string> };

export function safeKey(key: string) {
  if (!/^[a-z0-9][a-z0-9/_.-]{3,200}$/i.test(key) || key.includes("..")) throw new AppError("storage", "Chave de arquivo inválida.");
  return key;
}

// ------------------------------------------------------------ local
function localPath(key: string) {
  const root = resolve(env.localStorageDir);
  const p = resolve(join(root, safeKey(key)));
  if (!p.startsWith(root)) throw new AppError("storage", "Caminho inválido.");
  return p;
}

function sign(parts: string) {
  return createHmac("sha256", Buffer.from(env.mediaSecret, "base64")).update(parts).digest("base64url");
}

export function signLocal(op: "get" | "put", key: string, ttlSec: number, extra = "") {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const sig = sign(`${op}|${key}|${exp}|${extra}`);
  const q = new URLSearchParams({ k: key, e: String(exp), s: sig, ...(extra ? { x: extra } : {}) });
  return `/api/storage/${op === "get" ? "file" : "upload"}?${q}`;
}

export function verifyLocal(op: "get" | "put", q: URLSearchParams): string | null {
  const key = q.get("k") ?? ""; const exp = Number(q.get("e")); const sig = q.get("s") ?? ""; const extra = q.get("x") ?? "";
  if (!key || !Number.isFinite(exp) || exp < Date.now() / 1000) return null;
  return safeEqual(sig, sign(`${op}|${key}|${exp}|${extra}`)) ? safeKey(key) : null;
}

export async function localWrite(key: string, data: Buffer) {
  const p = localPath(key);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, data);
}
export const localFilePath = localPath;

// ------------------------------------------------------------ supabase
let sb: SupabaseClient | null = null;
function supa() {
  if (!env.supabaseUrl || !env.supabaseServiceKey) throw new Error("Configure NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY");
  sb ??= createClient(env.supabaseUrl, env.supabaseServiceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return sb.storage.from(env.supabaseBucket);
}

// ------------------------------------------------------------ API
export const storage = {
  async uploadTarget(key: string, contentType: string): Promise<UploadTarget> {
    safeKey(key);
    if (env.storageDriver === "supabase") {
      const { data, error } = await supa().createSignedUploadUrl(key);
      if (error || !data) throw new Error(`Falha ao preparar envio: ${error?.message}`);
      return { url: data.signedUrl, method: "PUT", headers: { "content-type": contentType, "x-upsert": "false", "cache-control": "max-age=3600" } };
    }
    return { url: signLocal("put", key, 2 * 3600), method: "PUT", headers: { "content-type": contentType } };
  },

  async readUrl(key: string, ttlSec: number, downloadName?: string): Promise<string> {
    safeKey(key);
    if (env.storageDriver === "supabase") {
      const { data, error } = await supa().createSignedUrl(key, ttlSec, downloadName ? { download: downloadName } : undefined);
      if (error || !data) throw new Error(`Falha ao gerar link: ${error?.message}`);
      return data.signedUrl;
    }
    return signLocal("get", key, ttlSec, downloadName ?? "");
  },

  async put(key: string, data: Buffer, contentType: string) {
    safeKey(key);
    if (env.storageDriver === "supabase") {
      const { error } = await supa().upload(key, data, { contentType, upsert: false });
      if (error) throw new Error(`Falha ao gravar arquivo: ${error.message}`);
      return;
    }
    await localWrite(key, data);
  },

  async get(key: string): Promise<Buffer> {
    if (env.storageDriver === "supabase") {
      const { data, error } = await supa().download(safeKey(key));
      if (error || !data) throw new Error(`Falha ao ler arquivo: ${error?.message}`);
      return Buffer.from(await data.arrayBuffer());
    }
    return readFile(localPath(key));
  },

  async size(key: string): Promise<number | null> {
    if (env.storageDriver === "supabase") {
      const folder = key.split("/").slice(0, -1).join("/");
      const name = key.split("/").pop()!;
      const { data } = await supa().list(folder, { search: name, limit: 5 });
      const f = data?.find((x) => x.name === name);
      return f ? Number((f.metadata as { size?: number } | null)?.size ?? 0) : null;
    }
    try { return (await stat(localPath(key))).size; } catch { return null; }
  },

  async remove(key: string) {
    if (env.storageDriver === "supabase") { await supa().remove([safeKey(key)]); return; }
    await rm(localPath(key), { force: true });
  },
};
