import "server-only";
import { z } from "zod";
import { asAdmin, type Tx } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { AdminPrincipal, ReqCtx } from "../context";
import { assertCanWrite } from "../auth/admin";
import { auditLog } from "../auth/log";
import { optText, parse } from "./common";
import { versionVideos } from "./videos";
import { examProblems } from "./exams";
import { termProblems } from "./terms";

const trainingSchema = z.object({
  title: z.string().trim().min(3, "Informe o título do treinamento.").max(150),
  description: optText(2000),
});

export type TrainingRow = { id: string; title: string; description: string | null; active: boolean; created_at: Date;
  published_version: number | null; published_version_id: string | null; draft_version_id: string | null; draft_version: number | null; convocations: number };

export async function listTrainings(admin: AdminPrincipal) {
  return asAdmin(admin, (tx) => tx<TrainingRow[]>`
    select t.id, t.title, t.description, t.active, t.created_at,
      pv.version as published_version, pv.id as published_version_id,
      dv.id as draft_version_id, dv.version as draft_version,
      (select count(*)::int from convocations c where c.training_id = t.id) as convocations
    from trainings t
    left join lateral (select id, version from training_versions where training_id = t.id and status = 'published' order by version desc limit 1) pv on true
    left join lateral (select id, version from training_versions where training_id = t.id and status = 'draft' order by version desc limit 1) dv on true
    order by t.active desc, t.title`);
}

export async function createTraining(admin: AdminPrincipal, input: unknown, ctx: ReqCtx) {
  assertCanWrite(admin);
  const d = parse(trainingSchema, input);
  return asAdmin(admin, async (tx) => {
    const [t] = await tx<{ id: string }[]>`insert into trainings (title, description, created_by) values (${d.title}, ${d.description}, ${admin.id}) returning id`;
    const [v] = await tx<{ id: string }[]>`
      insert into training_versions (training_id, version, title, description, created_by)
      values (${t.id}, 1, ${d.title}, ${d.description}, ${admin.id}) returning id`;
    await auditLog(tx, admin.id, "training.create", "training", t.id, { title: d.title }, ctx.ip);
    return { trainingId: t.id, versionId: v.id };
  });
}

export async function updateTraining(admin: AdminPrincipal, id: string, input: unknown, ctx: ReqCtx) {
  assertCanWrite(admin);
  const d = parse(trainingSchema.extend({ active: z.boolean() }), input);
  await asAdmin(admin, async (tx) => {
    await tx`update trainings set title = ${d.title}, description = ${d.description}, active = ${d.active} where id = ${id}`;
    await auditLog(tx, admin.id, "training.update", "training", id, d, ctx.ip);
  });
}

/** Versão publicada mais recente (a usada em novas convocações). */
export async function currentPublishedVersion(tx: Tx, trainingId: string) {
  const [v] = await tx<{ id: string; version: number }[]>`
    select id, version from training_versions where training_id = ${trainingId} and status = 'published'
    order by version desc limit 1`;
  return v ?? null;
}

/** O que falta para a versão poder ser publicada (ampliado nas próximas etapas). */
export async function versionProblems(tx: Tx, versionId: string): Promise<string[]> {
  const p: string[] = [];
  const [v] = await tx<{ required: number; pending: number }[]>`
    select count(*) filter (where vv.required)::int as required, count(*) filter (where vi.status <> 'ready')::int as pending
    from version_videos vv join videos vi on vi.id = vv.video_id where vv.version_id = ${versionId}`;
  if (!v || v.required === 0) p.push("inclua ao menos um vídeo obrigatório");
  if (v && v.pending > 0) p.push("conclua o envio de todos os vídeos");
  const [tv] = await tx<{ exam_id: string | null; term_id: string | null }[]>`select exam_id, term_id from training_versions where id = ${versionId}`;
  if (!tv?.exam_id) p.push("vincule uma prova à versão");
  else p.push(...(await examProblems(tx, tv.exam_id)));
  p.push(...(await termProblems(tx, tv?.term_id ?? null)));
  return p;
}

export async function publishVersion(admin: AdminPrincipal, versionId: string, ctx: ReqCtx) {
  assertCanWrite(admin);
  return asAdmin(admin, async (tx) => {
    const [v] = await tx<{ id: string; training_id: string; status: string; version: number }[]>`
      select id, training_id, status, version from training_versions where id = ${versionId} for update`;
    if (!v) throw new AppError("not_found", "Versão não encontrada.", 404);
    if (v.status !== "draft") throw new AppError("invalid", "Só é possível publicar uma versão em rascunho.");
    const problems = await versionProblems(tx, versionId);
    if (problems.length) throw new AppError("incomplete", `Antes de publicar: ${problems.join("; ")}.`);
    await tx`update training_versions set status = 'archived' where training_id = ${v.training_id} and status = 'published'`;
    await tx`update training_versions set status = 'published', published_at = now() where id = ${v.id}`;
    await auditLog(tx, admin.id, "training.publish", "training_version", v.id, { training_id: v.training_id, version: v.version }, ctx.ip);
  });
}

/** Nova versão em rascunho copiando a última versão (vídeos e regras). As convocações antigas não mudam. */
export async function createDraftVersion(admin: AdminPrincipal, trainingId: string, ctx: ReqCtx) {
  assertCanWrite(admin);
  return asAdmin(admin, async (tx) => {
    const [draft] = await tx`select id from training_versions where training_id = ${trainingId} and status = 'draft'`;
    if (draft) throw new AppError("duplicate", "Já existe uma versão em rascunho. Edite-a ou publique-a.");
    const [last] = await tx<{ id: string; version: number; title: string; description: string | null }[]>`
      select id, version, title, description from training_versions where training_id = ${trainingId} order by version desc limit 1`;
    if (!last) throw new AppError("not_found", "Treinamento não encontrado.", 404);
    const [t] = await tx<{ title: string; description: string | null }[]>`select title, description from trainings where id = ${trainingId}`;
    const [nv] = await tx<{ id: string }[]>`
      insert into training_versions (training_id, version, title, description, created_by)
      values (${trainingId}, ${last.version + 1}, ${t.title}, ${t.description}, ${admin.id}) returning id`;
    await tx`insert into version_videos (version_id, video_id, position, required, completion_pct)
      select ${nv.id}, video_id, position, required, completion_pct from version_videos where version_id = ${last.id}`;
    await copyVersionExtras(tx, last.id, nv.id);
    await auditLog(tx, admin.id, "training.new_version", "training_version", nv.id, { training_id: trainingId, from_version: last.version }, ctx.ip);
    return nv.id;
  });
}

/** Copia prova e termo vinculados à versão anterior (preenchido nas etapas 4 e 5). */
async function copyVersionExtras(tx: Tx, from: string, to: string) {
  await tx`update training_versions set (exam_id, term_id) = (select exam_id, term_id from training_versions where id = ${from}) where id = ${to}`;
}

export async function getTrainingDetail(admin: AdminPrincipal, id: string) {
  return asAdmin(admin, async (tx) => {
    const [training] = await tx<{ id: string; title: string; description: string | null; active: boolean }[]>`select id, title, description, active from trainings where id = ${id}`;
    if (!training) return null;
    const versions = await tx<{ id: string; version: number; status: string; created_at: Date; published_at: Date | null; convocations: number; exam_id: string | null; exam_title: string | null; term_id: string | null; term_title: string | null }[]>`
      select v.id, v.version, v.status, v.created_at, v.published_at, v.exam_id, (select title from exams e where e.id = v.exam_id) as exam_title, v.term_id, (select t.title || ' — v' || t.version_label from terms t where t.id = v.term_id) as term_title,
        (select count(*)::int from convocations c where c.training_version_id = v.id) as convocations
      from training_versions v where v.training_id = ${id} order by v.version desc`;
    const videos = Object.fromEntries(await Promise.all(versions.map(async (v) => [v.id, await versionVideos(tx, v.id)] as const)));
    const problems = Object.fromEntries(await Promise.all(versions.filter((v) => v.status === "draft").map(async (v) => [v.id, await versionProblems(tx, v.id)] as const)));
    return { training, versions, videos, problems };
  });
}
