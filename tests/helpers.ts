import postgres from "postgres";
import * as OTPAuth from "otpauth";
import { encrypt, hmacHex } from "@/lib/crypto";
import { generateCpf, maskCpf } from "@/lib/cpf";

/** Conexão "dona" do banco, usada só para preparar cenários de teste. */
export const raw = postgres(process.env.DATABASE_URL!, { max: 2, onnotice: () => {} });

export const ctx = (over: Partial<{ ip: string; userAgent: string; now: Date }> = {}) => ({
  ip: over.ip ?? `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
  userAgent: over.userAgent ?? "vitest",
  now: over.now,
});

let seq = 1000;
export function uniqueCpf() {
  seq += 7;
  return generateCpf(Date.now() % 1e6 * 1000 + seq);
}

export async function resetData() {
  await raw.unsafe(`
    do $$ declare r record; begin
      for r in select tablename from pg_tables where schemaname = 'academy'
               and tablename not in ('settings', 'question_topics') loop
        execute format('alter table academy.%I disable trigger user', r.tablename);
        execute format('truncate academy.%I restart identity cascade', r.tablename);
        execute format('alter table academy.%I enable trigger user', r.tablename);
      end loop;
    end $$;`);
}

/** Insere motorista diretamente (as etapas seguintes testam o cadastro pelo painel). */
export async function insertDriver(opts: { cpf?: string; name?: string; phone?: string | null; email?: string | null; status?: string; convocation?: boolean } = {}) {
  const cpf = opts.cpf ?? uniqueCpf();
  const [d] = await raw<{ id: string }[]>`
    insert into academy.drivers (full_name, cpf_hash, cpf_enc, cpf_mask, phone, email, status)
    values (${opts.name ?? "Motorista Teste"}, ${hmacHex(cpf, "cpf")}, ${encrypt(cpf)}, ${maskCpf(cpf)},
            ${opts.phone === undefined ? "+5527999990000" : opts.phone}, ${opts.email ?? null}, ${opts.status ?? "active"})
    returning id`;
  if (opts.convocation !== false) await rawConvocation(d.id);
  return { id: d.id, cpf };
}

/** Convocação mínima inserida direto no banco (para testes de login). */
export async function rawConvocation(driverId: string) {
  let [t] = await raw<{ id: string; vid: string }[]>`select t.id, v.id as vid from academy.trainings t join academy.training_versions v on v.training_id = t.id where t.title = '__raw__' limit 1`;
  if (!t) {
    const [nt] = await raw<{ id: string }[]>`insert into academy.trainings (title) values ('__raw__') returning id`;
    const [nv] = await raw<{ id: string }[]>`insert into academy.training_versions (training_id, version, title, status, published_at) values (${nt.id}, 1, '__raw__', 'published', now()) returning id`;
    t = { id: nt.id, vid: nv.id };
  }
  const [c] = await raw<{ id: string }[]>`insert into academy.convocations (driver_id, training_id, training_version_id, deadline_mode, duration_hours)
    values (${driverId}, ${t.id}, ${t.vid}, 'duration', 72) returning id`;
  return c.id;
}

export async function lastCodeFor(destination: string): Promise<string> {
  const [m] = await raw<{ body: string }[]>`select body from academy.dev_outbox where destination = ${destination} order by id desc limit 1`;
  const code = /(\d{6})/.exec(m?.body ?? "")?.[1];
  if (!code) throw new Error("nenhum código enviado para " + destination);
  return code;
}

export function totpNow(secretB32: string, at = new Date()) {
  return new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secretB32), digits: 6, period: 30 }).generate({ timestamp: at.getTime() });
}

import type { AdminPrincipal } from "@/server/context";
/** Administrador já autenticado (para testar as regras do painel sem passar pelo login). */
export async function adminPrincipal(role: AdminPrincipal["role"] = "superadmin"): Promise<AdminPrincipal> {
  const email = `adm-${Math.random().toString(36).slice(2, 9)}@blink.test`;
  const [a] = await raw<{ id: string }[]>`insert into academy.admins (email, name, role, password_hash) values (${email}, 'Admin Teste', ${role}, 'x') returning id`;
  return { id: a.id, role, name: "Admin Teste", email, sessionId: "00000000-0000-0000-0000-000000000000" };
}

/** Treinamento com versão publicada pronto para convocar. */
export async function publishedTraining(admin: AdminPrincipal, title = "POD e PNR") {
  const { createTraining, publishVersion } = await import("@/server/services/trainings");
  const t = await createTraining(admin, { title, description: "Treinamento obrigatório" }, ctx());
  await prepareVersionContent(admin, t.versionId);
  await publishVersion(admin, t.versionId, ctx());
  return t;
}

/** Vídeo "pronto" inserido direto no banco, com arquivo de teste no armazenamento local. */
export async function readyVideo(title = "Vídeo de teste", durationSec = 120) {
  const key = `videos/teste-${Math.random().toString(36).slice(2)}.mp4`;
  const { localWrite } = await import("@/server/storage");
  await localWrite(key, Buffer.from("conteudo-de-video-falso"));
  const [v] = await raw<{ id: string }[]>`insert into academy.videos (title, storage_key, size_bytes, duration_seconds, status)
    values (${title}, ${key}, 23, ${durationSec}, 'ready') returning id`;
  return v.id;
}

/** Conteúdo mínimo exigido para publicar uma versão (ampliado a cada etapa). */
export async function prepareVersionContent(admin: AdminPrincipal, versionId: string) {
  const { addVideoToVersion } = await import("@/server/services/videos");
  await addVideoToVersion(admin, versionId, await readyVideo("Vídeo 1 — POD", 120), ctx());
  await addVideoToVersion(admin, versionId, await readyVideo("Vídeo 2 — PNR", 60), ctx());
  const { setVersionExam } = await import("@/server/services/exams");
  await setVersionExam(admin, versionId, await defaultExam(admin), ctx());
  const { createModelTerm, setVersionTerm } = await import("@/server/services/terms");
  await setVersionTerm(admin, versionId, await createModelTerm(admin, "POD e PNR", ctx()), ctx());
}

/** Banco inicial de perguntas + prova padrão (10 questões, 80%, 3 tentativas). */
export async function defaultExam(admin: AdminPrincipal, over: Partial<import("@/server/services/exams").ExamInput> = {}) {
  const { seedQuestionBank } = await import("@/server/services/questions");
  const { createExam } = await import("@/server/services/exams");
  const [{ n }] = await raw<{ n: number }[]>`select count(*)::int as n from academy.questions`;
  if (n === 0) await seedQuestionBank(admin, ctx());
  return createExam(admin, { title: "Avaliação POD e PNR", questionCount: 10, passPct: 80, maxAttempts: 3, timeLimitMinutes: null,
    selectionMode: "random", topicIds: [], shuffleQuestions: true, shuffleOptions: true, displayMode: "one", ...over }, ctx());
}
