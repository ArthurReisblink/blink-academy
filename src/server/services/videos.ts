import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { asAdmin, asDriver, type Tx } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { AdminPrincipal, DriverPrincipal, ReqCtx } from "../context";
import { assertCanWrite } from "../auth/admin";
import { auditLog } from "../auth/log";
import { applyHeartbeat, type Interval } from "../domain/progress";
import { storage } from "../storage";
import { optText, parse } from "./common";

export const MAX_VIDEO_BYTES = 5 * 1024 ** 3; // 5 GB (ajuste também o limite do bucket no Supabase)

// =====================================================================
// Biblioteca (administração)
// =====================================================================
export type VideoRow = { id: string; title: string; description: string | null; storage_key: string; mime: string; size_bytes: number;
  duration_seconds: string; status: string; created_at: Date; used_in: number };

export async function listVideos(admin: AdminPrincipal) {
  return asAdmin(admin, (tx) => tx<VideoRow[]>`
    select v.*, (select count(*)::int from version_videos vv where vv.video_id = v.id) as used_in
    from videos v order by v.created_at desc`);
}

const startSchema = z.object({
  title: z.string().trim().min(3, "Informe o título do vídeo.").max(150),
  description: optText(2000),
  contentType: z.literal("video/mp4", { error: "Envie um arquivo MP4." }),
  size: z.number().int().positive().max(MAX_VIDEO_BYTES, "Arquivo maior que o limite de 5 GB."),
  duration: z.number().positive("Não foi possível ler a duração do vídeo.").max(6 * 3600),
});

/** 1º passo do envio: registra o vídeo e devolve uma URL temporária para o navegador enviar o arquivo direto ao armazenamento. */
export async function startVideoUpload(admin: AdminPrincipal, input: unknown, ctx: ReqCtx) {
  assertCanWrite(admin);
  const d = parse(startSchema, input);
  const key = `videos/${randomUUID()}.mp4`;
  const id = await asAdmin(admin, async (tx) => {
    const [v] = await tx<{ id: string }[]>`
      insert into videos (title, description, storage_key, mime, size_bytes, duration_seconds, created_by)
      values (${d.title}, ${d.description}, ${key}, ${d.contentType}, ${d.size}, ${d.duration}, ${admin.id}) returning id`;
    await auditLog(tx, admin.id, "video.upload_start", "video", v.id, { title: d.title, size: d.size }, ctx.ip);
    return v.id;
  });
  return { videoId: id, upload: await storage.uploadTarget(key, d.contentType) };
}

/** 2º passo: confere se o arquivo chegou ao armazenamento e libera o vídeo. */
export async function finishVideoUpload(admin: AdminPrincipal, videoId: string, ctx: ReqCtx) {
  assertCanWrite(admin);
  return asAdmin(admin, async (tx) => {
    const [v] = await tx<{ storage_key: string; size_bytes: number; status: string }[]>`select storage_key, size_bytes, status from videos where id = ${videoId} for update`;
    if (!v) throw new AppError("not_found", "Vídeo não encontrado.", 404);
    if (v.status === "ready") return;
    const size = await storage.size(v.storage_key);
    if (size === null) throw new AppError("upload", "O arquivo ainda não chegou ao armazenamento. Tente enviar novamente.");
    if (Number(v.size_bytes) && size !== Number(v.size_bytes)) throw new AppError("upload", "O arquivo enviado está incompleto. Envie novamente.");
    await tx`update videos set status = 'ready', size_bytes = ${size} where id = ${videoId}`;
    await auditLog(tx, admin.id, "video.upload_done", "video", videoId, { size }, ctx.ip);
  });
}

export async function updateVideo(admin: AdminPrincipal, id: string, input: unknown, ctx: ReqCtx) {
  assertCanWrite(admin);
  const d = parse(z.object({ title: z.string().trim().min(3).max(150), description: optText(2000) }), input);
  await asAdmin(admin, async (tx) => {
    await tx`update videos set title = ${d.title}, description = ${d.description} where id = ${id}`;
    await auditLog(tx, admin.id, "video.update", "video", id, d, ctx.ip);
  });
}

export async function deleteVideo(admin: AdminPrincipal, id: string, ctx: ReqCtx) {
  assertCanWrite(admin);
  const key = await asAdmin(admin, async (tx) => {
    const [used] = await tx`select 1 from version_videos where video_id = ${id} limit 1`;
    if (used) throw new AppError("in_use", "Este vídeo já faz parte de uma versão de treinamento e não pode ser excluído.");
    const [prog] = await tx`select 1 from video_progress where video_id = ${id} limit 1`;
    if (prog) throw new AppError("in_use", "Este vídeo tem progresso registrado e não pode ser excluído.");
    const [v] = await tx<{ storage_key: string }[]>`delete from videos where id = ${id} returning storage_key`;
    if (!v) throw new AppError("not_found", "Vídeo não encontrado.", 404);
    await auditLog(tx, admin.id, "video.delete", "video", id, {}, ctx.ip);
    return v.storage_key;
  });
  await storage.remove(key).catch(() => {});
}

export async function adminVideoPreviewUrl(admin: AdminPrincipal, id: string) {
  const v = await asAdmin(admin, async (tx) => (await tx<{ storage_key: string }[]>`select storage_key from videos where id = ${id} and status = 'ready'`)[0]);
  if (!v) throw new AppError("not_found", "Vídeo não encontrado.", 404);
  return storage.readUrl(v.storage_key, 3600);
}

// =====================================================================
// Vídeos de uma versão (rascunho)
// =====================================================================
export type VersionVideo = { video_id: string; title: string; duration_seconds: string; status: string; position: number; required: boolean; completion_pct: string };

export async function versionVideos(tx: Tx, versionId: string) {
  return tx<VersionVideo[]>`
    select vv.video_id, v.title, v.duration_seconds, v.status, vv.position, vv.required, vv.completion_pct
    from version_videos vv join videos v on v.id = vv.video_id where vv.version_id = ${versionId} order by vv.position`;
}

async function draftGuard(tx: Tx, versionId: string) {
  const [v] = await tx<{ status: string }[]>`select status from training_versions where id = ${versionId}`;
  if (!v) throw new AppError("not_found", "Versão não encontrada.", 404);
  if (v.status !== "draft") throw new AppError("frozen", "Versões publicadas não podem ser alteradas. Crie uma nova versão.");
}

async function renumber(tx: Tx, versionId: string) {
  await tx`update version_videos vv set position = r.n from (
    select video_id, row_number() over (order by position, video_id) as n from version_videos where version_id = ${versionId}) r
    where vv.version_id = ${versionId} and vv.video_id = r.video_id and vv.position <> r.n`;
}

export async function addVideoToVersion(admin: AdminPrincipal, versionId: string, videoId: string, ctx: ReqCtx, opts: { required?: boolean; completionPct?: number } = {}) {
  assertCanWrite(admin);
  await asAdmin(admin, async (tx) => {
    await draftGuard(tx, versionId);
    const [v] = await tx<{ status: string }[]>`select status from videos where id = ${videoId}`;
    if (!v || v.status !== "ready") throw new AppError("video", "Vídeo não encontrado ou envio não concluído.");
    const [dup] = await tx`select 1 from version_videos where version_id = ${versionId} and video_id = ${videoId}`;
    if (dup) throw new AppError("duplicate", "Este vídeo já está na versão.");
    const [def] = await tx<{ value: { video_completion_pct: number } }[]>`select value from settings where key = 'defaults'`;
    const pct = opts.completionPct ?? def?.value.video_completion_pct ?? 95;
    await tx`insert into version_videos (version_id, video_id, position, required, completion_pct)
      values (${versionId}, ${videoId}, (select coalesce(max(position), 0) + 1 from version_videos where version_id = ${versionId}), ${opts.required ?? true}, ${pct})`;
    await auditLog(tx, admin.id, "version.video_add", "training_version", versionId, { video_id: videoId }, ctx.ip);
  });
}

export async function removeVideoFromVersion(admin: AdminPrincipal, versionId: string, videoId: string, ctx: ReqCtx) {
  assertCanWrite(admin);
  await asAdmin(admin, async (tx) => {
    await draftGuard(tx, versionId);
    await tx`delete from version_videos where version_id = ${versionId} and video_id = ${videoId}`;
    await renumber(tx, versionId);
    await auditLog(tx, admin.id, "version.video_remove", "training_version", versionId, { video_id: videoId }, ctx.ip);
  });
}

export async function moveVideo(admin: AdminPrincipal, versionId: string, videoId: string, dir: "up" | "down", ctx: ReqCtx) {
  assertCanWrite(admin);
  await asAdmin(admin, async (tx) => {
    await draftGuard(tx, versionId);
    const list = await versionVideos(tx, versionId);
    const i = list.findIndex((v) => v.video_id === videoId);
    const j = dir === "up" ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= list.length) return;
    await tx`update version_videos set position = ${list[j].position} where version_id = ${versionId} and video_id = ${videoId}`;
    await tx`update version_videos set position = ${list[i].position} where version_id = ${versionId} and video_id = ${list[j].video_id}`;
    await auditLog(tx, admin.id, "version.video_move", "training_version", versionId, { video_id: videoId, dir }, ctx.ip);
  });
}

export async function setVideoRules(admin: AdminPrincipal, versionId: string, videoId: string, rules: { required: boolean; completionPct: number }, ctx: ReqCtx) {
  assertCanWrite(admin);
  const r = parse(z.object({ required: z.boolean(), completionPct: z.number().min(50, "O mínimo é 50%.").max(100, "O máximo é 100%.") }), rules);
  await asAdmin(admin, async (tx) => {
    await draftGuard(tx, versionId);
    await tx`update version_videos set required = ${r.required}, completion_pct = ${r.completionPct} where version_id = ${versionId} and video_id = ${videoId}`;
    await auditLog(tx, admin.id, "version.video_rules", "training_version", versionId, { video_id: videoId, ...r }, ctx.ip);
  });
}

// =====================================================================
// Portal do motorista
// =====================================================================
export type DriverVideo = { video_id: string; title: string; description: string | null; duration_seconds: string; position: number; required: boolean;
  completion_pct: string; covered_seconds: string | null; completed_at: Date | null; last_position: string | null };

export async function driverVideosOf(tx: Tx, convocationId: string) {
  return tx<DriverVideo[]>`
    select vv.video_id, v.title, v.description, v.duration_seconds, vv.position, vv.required, vv.completion_pct,
      p.covered_seconds, p.completed_at, p.last_position
    from convocations c
    join version_videos vv on vv.version_id = c.training_version_id
    join videos v on v.id = vv.video_id
    left join video_progress p on p.convocation_id = c.id and p.video_id = vv.video_id
    where c.id = ${convocationId}
    order by vv.position`;
}

async function openConvocation(tx: Tx, convocationId: string) {
  const [r] = await tx<{ ok: boolean }[]>`select academy.convocation_is_open(${convocationId}) as ok`;
  return !!r?.ok;
}

/** Dados para tocar um vídeo: URL assinada de curta duração + progresso atual. */
export async function videoPlayback(driver: DriverPrincipal, convocationId: string, videoId: string) {
  return asDriver(driver.id, async (tx) => {
    if (!/^[0-9a-f-]{36}$/i.test(convocationId) || !/^[0-9a-f-]{36}$/i.test(videoId)) return null;
    const list = await driverVideosOf(tx, convocationId);
    const v = list.find((x) => x.video_id === videoId);
    if (!v) return null;
    if (!(await openConvocation(tx, convocationId))) throw new AppError("closed", "Seu prazo de treinamento terminou ou o acesso foi bloqueado. Entre em contato com a administração da BLINK.", 403);
    const [row] = await tx<{ storage_key: string; status: string; mime: string }[]>`select storage_key, status, mime from videos where id = ${videoId}`;
    if (!row || row.status !== "ready") throw new AppError("video", "Vídeo indisponível no momento.");
    const [prog] = await tx<{ intervals: Interval[] }[]>`select intervals from video_progress where convocation_id = ${convocationId} and video_id = ${videoId}`;
    const ttl = Math.min(4 * 3600, Math.max(1800, Math.ceil(Number(v.duration_seconds) * 3)));
    return { video: v, list, url: await storage.readUrl(row.storage_key, ttl), mime: row.mime, intervals: prog?.intervals ?? [] };
  });
}

const beatSchema = z.object({
  convocationId: z.string().uuid(), videoId: z.string().uuid(),
  event: z.enum(["play", "pause", "seeked", "ended", "heartbeat", "error"]),
  position: z.number().min(0).max(24 * 3600),
  segments: z.array(z.tuple([z.number(), z.number()])).max(200),
});

/** Registro de progresso enviado pelo player (a cada poucos segundos e em play/pause/fim). */
export async function recordHeartbeat(driver: DriverPrincipal, input: unknown, now = new Date()) {
  const d = parse(beatSchema, input);
  return asDriver(driver.id, async (tx) => {
    const list = await driverVideosOf(tx, d.convocationId);
    const v = list.find((x) => x.video_id === d.videoId);
    if (!v) throw new AppError("not_found", "Vídeo não encontrado.", 404);
    if (!(await openConvocation(tx, d.convocationId))) throw new AppError("closed", "Seu prazo de treinamento terminou ou o acesso foi bloqueado.", 403);
    const duration = Number(v.duration_seconds);
    const [cur] = await tx<{ intervals: Interval[]; last_heartbeat_at: Date | null; completed_at: Date | null }[]>`
      select intervals, last_heartbeat_at, completed_at from video_progress
      where convocation_id = ${d.convocationId} and video_id = ${d.videoId} for update`;
    const r = applyHeartbeat({ existing: cur?.intervals ?? [], segments: d.segments, durationSec: duration, lastHeartbeatAt: cur?.last_heartbeat_at ?? null, now });
    const done = r.pct >= Number(v.completion_pct);
    const completedNow = done && !cur?.completed_at;
    if (cur) {
      await tx`update video_progress set intervals = ${tx.json(r.intervals as never)}, covered_seconds = ${r.covered},
        last_position = ${Math.min(d.position, duration)}, last_heartbeat_at = ${now},
        completed_at = coalesce(completed_at, ${done ? now : null})
        where convocation_id = ${d.convocationId} and video_id = ${d.videoId}`;
    } else {
      await tx`insert into video_progress (convocation_id, video_id, intervals, covered_seconds, duration_seconds, completion_pct, last_position, last_heartbeat_at, completed_at)
        values (${d.convocationId}, ${d.videoId}, ${tx.json(r.intervals as never)}, ${r.covered}, ${duration}, ${Number(v.completion_pct)},
                ${Math.min(d.position, duration)}, ${now}, ${done ? now : null})`;
    }
    await tx`insert into video_events (convocation_id, video_id, at, type, position, details)
      values (${d.convocationId}, ${d.videoId}, ${now}, ${d.event}, ${d.position}, ${tx.json({ credited: r.credited, rejected: r.rejected, pct: r.pct } as never)})`;
    if (completedNow) {
      await tx`insert into video_events (convocation_id, video_id, at, type, position) values (${d.convocationId}, ${d.videoId}, ${now}, 'completed', ${d.position})`;
      await tx`insert into convocation_events (convocation_id, type, details) values (${d.convocationId}, 'video_completed', ${tx.json({ video_id: d.videoId, title: v.title } as never)})`;
    }
    return { pct: r.pct, covered: r.covered, completed: done, completedNow, intervals: r.intervals };
  });
}
