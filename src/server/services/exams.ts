import "server-only";
import { z } from "zod";
import { asAdmin, asDriver, asSystem, type Tx } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { AdminPrincipal, DriverPrincipal, ReqCtx } from "../context";
import { assertCanWrite } from "../auth/admin";
import { auditLog } from "../auth/log";
import { buildAttempt, grade, type AnswerKey, type AttemptQuestion, type ExamRules, type PoolQuestion } from "../domain/exam";
import { optText, parse } from "./common";

// =====================================================================
// Administração das provas
// =====================================================================
const examSchema = z.object({
  title: z.string().trim().min(3, "Informe o título da prova.").max(150),
  description: optText(2000),
  questionCount: z.number().int().min(1, "Mínimo de 1 questão.").max(100),
  passPct: z.number().min(1, "Nota mínima inválida.").max(100, "Nota mínima inválida."),
  maxAttempts: z.number().int().min(1, "Mínimo de 1 tentativa.").max(20, "Máximo de 20 tentativas."),
  timeLimitMinutes: z.number().int().min(1).max(600).nullable(),
  selectionMode: z.enum(["manual", "random"]),
  topicIds: z.array(z.string().uuid()).default([]),
  shuffleQuestions: z.boolean(),
  shuffleOptions: z.boolean(),
  displayMode: z.enum(["one", "all"]),
  active: z.boolean().default(true),
});
export type ExamInput = z.input<typeof examSchema>;

export type ExamRow = { id: string; title: string; description: string | null; question_count: number; pass_pct: string; max_attempts: number;
  time_limit_minutes: number | null; selection_mode: "manual" | "random"; topic_ids: string[]; shuffle_questions: boolean; shuffle_options: boolean;
  display_mode: "one" | "all"; active: boolean; created_at: Date; manual_questions: number; pool: number; attempts: number; passed: number; avg_score: string | null; versions: number };

export async function listExams(admin: AdminPrincipal) {
  return asAdmin(admin, (tx) => tx<ExamRow[]>`
    select e.*,
      (select count(*)::int from exam_questions eq join questions q on q.id = eq.question_id and q.active where eq.exam_id = e.id) as manual_questions,
      (select count(*)::int from questions q where q.active and (cardinality(e.topic_ids) = 0 or q.topic_id = any(e.topic_ids))) as pool,
      (select count(*)::int from exam_attempts a where a.exam_id = e.id and a.submitted_at is not null) as attempts,
      (select count(*)::int from exam_attempts a where a.exam_id = e.id and a.passed) as passed,
      (select round(avg(a.score_pct), 1) from exam_attempts a where a.exam_id = e.id and a.submitted_at is not null) as avg_score,
      (select count(*)::int from training_versions tv where tv.exam_id = e.id) as versions
    from exams e order by e.created_at desc`);
}

export async function getExam(admin: AdminPrincipal, id: string) {
  return asAdmin(admin, async (tx) => {
    const [e] = (await tx<ExamRow[]>`select e.*, 0 as manual_questions, 0 as pool, 0 as attempts, 0 as passed, null as avg_score, 0 as versions from exams e where id = ${id}`);
    if (!e) return null;
    const manual = (await tx<{ question_id: string }[]>`select question_id from exam_questions where exam_id = ${id} order by position`).map((r) => r.question_id);
    return { exam: e, manual };
  });
}

function examValues(d: z.output<typeof examSchema>) {
  return { title: d.title, description: d.description, question_count: d.questionCount, pass_pct: d.passPct, max_attempts: d.maxAttempts,
    time_limit_minutes: d.timeLimitMinutes, selection_mode: d.selectionMode, topic_ids: d.topicIds, shuffle_questions: d.shuffleQuestions,
    shuffle_options: d.shuffleOptions, display_mode: d.displayMode, active: d.active };
}

export async function createExam(admin: AdminPrincipal, input: ExamInput, ctx: ReqCtx) {
  assertCanWrite(admin);
  const d = parse(examSchema, input);
  return asAdmin(admin, async (tx) => {
    const v = examValues(d);
    const [e] = await tx<{ id: string }[]>`insert into exams ${tx({ ...v, created_by: admin.id } as never)} returning id`;
    await auditLog(tx, admin.id, "exam.create", "exam", e.id, v, ctx.ip);
    return e.id;
  });
}

/** Alterações valem para as próximas tentativas; as já iniciadas guardam as regras da época. */
export async function updateExam(admin: AdminPrincipal, id: string, input: ExamInput, ctx: ReqCtx) {
  assertCanWrite(admin);
  const d = parse(examSchema, input);
  await asAdmin(admin, async (tx) => {
    const v = examValues(d);
    const r = await tx`update exams set ${tx(v as never)} where id = ${id} returning id`;
    if (!r.length) throw new AppError("not_found", "Prova não encontrada.", 404);
    await auditLog(tx, admin.id, "exam.update", "exam", id, v, ctx.ip);
  });
}

export async function setExamQuestions(admin: AdminPrincipal, id: string, questionIds: string[], ctx: ReqCtx) {
  assertCanWrite(admin);
  const ids = parse(z.array(z.string().uuid()).max(100), questionIds);
  await asAdmin(admin, async (tx) => {
    await tx`delete from exam_questions where exam_id = ${id}`;
    for (const [i, q] of ids.entries()) await tx`insert into exam_questions (exam_id, question_id, position) values (${id}, ${q}, ${i + 1})`;
    await auditLog(tx, admin.id, "exam.questions", "exam", id, { count: ids.length }, ctx.ip);
  });
}

/** Problemas que impedem a prova de ser aplicada (usado ao publicar a versão). */
export async function examProblems(tx: Tx, examId: string): Promise<string[]> {
  const [e] = await tx<{ active: boolean; question_count: number; selection_mode: string; topic_ids: string[] }[]>`select active, question_count, selection_mode, topic_ids from exams where id = ${examId}`;
  if (!e) return ["prova não encontrada"];
  if (!e.active) return ["a prova vinculada está inativa"];
  const pool = await examPool(tx, examId);
  if (pool.length < e.question_count) return [`a prova pede ${e.question_count} questões válidas e há ${pool.length}`];
  return [];
}

export async function setVersionExam(admin: AdminPrincipal, versionId: string, examId: string | null, ctx: ReqCtx) {
  assertCanWrite(admin);
  await asAdmin(admin, async (tx) => {
    const [v] = await tx<{ status: string }[]>`select status from training_versions where id = ${versionId}`;
    if (!v) throw new AppError("not_found", "Versão não encontrada.", 404);
    if (v.status !== "draft") throw new AppError("frozen", "Versões publicadas não podem ser alteradas. Crie uma nova versão.");
    await tx`update training_versions set exam_id = ${examId} where id = ${versionId}`;
    await auditLog(tx, admin.id, "version.exam", "training_version", versionId, { exam_id: examId }, ctx.ip);
  });
}

// =====================================================================
// Geração, respostas e correção (servidor)
// =====================================================================
async function examPool(tx: Tx, examId: string): Promise<PoolQuestion[]> {
  const [e] = await tx<{ selection_mode: string; topic_ids: string[] }[]>`select selection_mode, topic_ids from exams where id = ${examId}`;
  const rows = await tx<PoolQuestion[]>`
    select q.id, t.name as topic, q.statement, q.explanation,
      coalesce((select json_agg(json_build_object('id', o.id, 'text', o.text, 'is_correct', o.is_correct) order by o.position)
        from question_options o where o.question_id = q.id), '[]') as options
    from questions q join question_topics t on t.id = q.topic_id
    ${e.selection_mode === "manual"
      ? tx`join exam_questions eq on eq.question_id = q.id and eq.exam_id = ${examId} where q.active order by eq.position`
      : tx`where q.active ${e.topic_ids.length ? tx`and q.topic_id = any(${e.topic_ids})` : tx``} order by q.created_at`}`;
  return rows.filter((q) => q.options.length >= 4 && q.options.filter((o) => o.is_correct).length === 1);
}

type AttemptRow = { id: string; convocation_id: string; exam_id: string; attempt_number: number; started_at: Date; deadline_at: Date | null;
  submitted_at: Date | null; submit_reason: string | null; questions: AttemptQuestion[]; rules: ExamRules; answers: Record<string, string>;
  correct_count: number | null; score_pct: string | null; passed: boolean | null };

/** Confirma (com o papel do motorista) que a convocação é dele. */
async function ownConvocation(driver: DriverPrincipal, convocationId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(convocationId)) throw new AppError("not_found", "Convocação não encontrada.", 404);
  const [c] = await asDriver(driver.id, (tx) => tx<{ id: string }[]>`select id from convocations where id = ${convocationId}`);
  if (!c) throw new AppError("not_found", "Convocação não encontrada.", 404);
}

/** Envia automaticamente tentativas cujo tempo-limite acabou. */
async function finalizeExpired(tx: Tx, convocationId: string, now: Date) {
  const open = await tx<(AttemptRow & { answer_key: AnswerKey })[]>`
    select * from exam_attempts where convocation_id = ${convocationId} and submitted_at is null and deadline_at is not null
      and deadline_at + interval '30 seconds' <= ${now} for update`;
  for (const a of open) await finish(tx, a, a.answers, "time_limit", now);
}

async function finish(tx: Tx, a: AttemptRow & { answer_key: AnswerKey }, answers: Record<string, string>, reason: "driver" | "time_limit", now: Date) {
  const g = grade(a.questions, a.answer_key, answers, Number(a.rules.pass_pct));
  await tx`update exam_attempts set answers = ${tx.json(answers as never)}, submitted_at = ${now}, submit_reason = ${reason},
    correct_count = ${g.correct}, score_pct = ${g.score}, passed = ${g.passed} where id = ${a.id}`;
  await tx`insert into convocation_events (convocation_id, type, details) values (${a.convocation_id}, 'exam_submitted',
    ${tx.json({ attempt: a.attempt_number, score: g.score, passed: g.passed, reason } as never)})`;
  return g;
}

export type ExamState = {
  exam: { title: string; description: string | null; question_count: number; pass_pct: number; max_attempts: number; time_limit_minutes: number | null; display_mode: "one" | "all" } | null;
  videosDone: boolean; open: boolean; attempts: AttemptRow[]; inProgress: AttemptRow | null; passed: AttemptRow | null; remaining: number;
  canStart: boolean; reason: string | null;
};

export async function examState(driver: DriverPrincipal, convocationId: string, now = new Date()): Promise<ExamState> {
  await ownConvocation(driver, convocationId);
  return asSystem(async (tx) => {
    await finalizeExpired(tx, convocationId, now);
    const [c] = await tx<{ exam_id: string | null; open: boolean; videos_done: boolean }[]>`
      select tv.exam_id, academy.convocation_open_raw(c.id) as open, academy.required_videos_done(c.id) as videos_done
      from convocations c join training_versions tv on tv.id = c.training_version_id where c.id = ${convocationId}`;
    const [e] = c.exam_id ? await tx<NonNullable<ExamState["exam"]>[]>`
      select title, description, question_count, pass_pct::float as pass_pct, max_attempts, time_limit_minutes, display_mode from exams where id = ${c.exam_id}` : [];
    const attempts = await tx<AttemptRow[]>`
      select id, convocation_id, exam_id, attempt_number, started_at, deadline_at, submitted_at, submit_reason, questions, rules, answers, correct_count, score_pct, passed
      from exam_attempts where convocation_id = ${convocationId} order by attempt_number`;
    const inProgress = attempts.find((a) => !a.submitted_at) ?? null;
    const passed = attempts.find((a) => a.passed) ?? null;
    const remaining = e ? Math.max(0, e.max_attempts - attempts.length) : 0;
    let reason: string | null = null;
    if (!e) reason = "Este treinamento ainda não tem avaliação configurada.";
    else if (!c.open) reason = "Seu prazo de treinamento terminou ou o acesso foi bloqueado. Entre em contato com a administração da BLINK.";
    else if (passed) reason = "Você já foi aprovado nesta avaliação.";
    else if (!c.videos_done) reason = "Conclua todos os vídeos obrigatórios para liberar a avaliação.";
    else if (remaining === 0 && !inProgress) reason = "Você usou todas as tentativas disponíveis. Entre em contato com a administração da BLINK.";
    return { exam: e ?? null, videosDone: c.videos_done, open: c.open, attempts, inProgress, passed, remaining,
      canStart: !reason && !inProgress, reason };
  });
}

/** INICIAR AVALIAÇÃO: gera a prova conforme as configurações e grava a cópia imutável. */
export async function startAttempt(driver: DriverPrincipal, convocationId: string, now = new Date()) {
  const st = await examState(driver, convocationId, now);
  if (st.inProgress) return st.inProgress.id;
  if (!st.canStart || !st.exam) throw new AppError("exam_locked", st.reason ?? "Avaliação indisponível.", 403);
  return asSystem(async (tx) => {
    const [c] = await tx<{ exam_id: string }[]>`select tv.exam_id from convocations c join training_versions tv on tv.id = c.training_version_id where c.id = ${convocationId}`;
    const [e] = await tx<(ExamRules & { title: string })[]>`select * from exams where id = ${c.exam_id}`;
    const rules: ExamRules = { question_count: e.question_count, pass_pct: Number(e.pass_pct), max_attempts: e.max_attempts, time_limit_minutes: e.time_limit_minutes,
      display_mode: e.display_mode, shuffle_questions: e.shuffle_questions, shuffle_options: e.shuffle_options, selection_mode: e.selection_mode, exam_title: e.title };
    let built;
    try { built = buildAttempt(await examPool(tx, c.exam_id), rules); } catch (err) { throw new AppError("exam_pool", (err as Error).message); }
    const deadline = rules.time_limit_minutes ? new Date(now.getTime() + rules.time_limit_minutes * 60000) : null;
    try {
      const [a] = await tx<{ id: string; attempt_number: number }[]>`
        insert into exam_attempts (convocation_id, exam_id, attempt_number, started_at, deadline_at, questions, answer_key, rules)
        values (${convocationId}, ${c.exam_id}, 0, ${now}, ${deadline}, ${tx.json(built.questions as never)}, ${tx.json(built.key as never)}, ${tx.json(rules as never)})
        returning id, attempt_number`;
      await tx`insert into convocation_events (convocation_id, type, details) values (${convocationId}, 'exam_started', ${tx.json({ attempt: a.attempt_number } as never)})`;
      return a.id;
    } catch (err) {
      // regra violada no banco (vídeos, prazo, tentativas)
      throw new AppError("exam_locked", (err as Error).message.replace(/^.*?: /, ""), 403);
    }
  });
}

async function loadOwnAttempt(tx: Tx, driver: DriverPrincipal, attemptId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(attemptId)) throw new AppError("not_found", "Avaliação não encontrada.", 404);
  const [a] = await tx<(AttemptRow & { answer_key: AnswerKey; driver_id: string })[]>`
    select a.*, c.driver_id from exam_attempts a join convocations c on c.id = a.convocation_id where a.id = ${attemptId} for update of a`;
  if (!a || a.driver_id !== driver.id) throw new AppError("not_found", "Avaliação não encontrada.", 404);
  return a;
}

/** Salva a resposta de uma questão (pode trocar enquanto a prova não foi enviada). */
export async function saveAnswer(driver: DriverPrincipal, attemptId: string, questionId: string, optionId: string, now = new Date()) {
  return asSystem(async (tx) => {
    const a = await loadOwnAttempt(tx, driver, attemptId);
    if (a.submitted_at) throw new AppError("submitted", "Esta avaliação já foi enviada e não pode ser alterada.", 409);
    if (a.deadline_at && a.deadline_at.getTime() + 30_000 <= now.getTime()) { await finish(tx, a, a.answers, "time_limit", now); throw new AppError("time", "O tempo da avaliação terminou. Suas respostas foram enviadas.", 409); }
    const [open] = await tx<{ ok: boolean }[]>`select academy.convocation_open_raw(${a.convocation_id}) as ok`;
    if (!open.ok) throw new AppError("closed", "Seu prazo de treinamento terminou. Entre em contato com a administração da BLINK.", 403);
    const q = a.questions.find((x) => x.id === questionId);
    if (!q || !q.options.some((o) => o.id === optionId)) throw new AppError("invalid", "Resposta inválida.");
    const answers = { ...a.answers, [questionId]: optionId };
    await tx`update exam_attempts set answers = ${tx.json(answers as never)} where id = ${attemptId}`;
    return { answered: Object.keys(answers).length };
  });
}

/** Envio final: corrige no servidor, compara com a nota mínima e trava a tentativa. */
export async function submitAttempt(driver: DriverPrincipal, attemptId: string, finalAnswers?: Record<string, string>, now = new Date()) {
  return asSystem(async (tx) => {
    const a = await loadOwnAttempt(tx, driver, attemptId);
    if (a.submitted_at) throw new AppError("submitted", "Esta avaliação já foi enviada.", 409);
    const late = a.deadline_at && a.deadline_at.getTime() + 30_000 <= now.getTime();
    const [open] = await tx<{ ok: boolean }[]>`select academy.convocation_open_raw(${a.convocation_id}) as ok`;
    if (!open.ok && !late) throw new AppError("closed", "Seu prazo de treinamento terminou. Entre em contato com a administração da BLINK.", 403);
    let answers = a.answers;
    if (finalAnswers && !late && open.ok) {
      answers = { ...a.answers };
      for (const [q, o] of Object.entries(finalAnswers)) {
        const qq = a.questions.find((x) => x.id === q);
        if (qq && qq.options.some((x) => x.id === o)) answers[q] = o;
      }
    }
    const g = await finish(tx, a, answers, late ? "time_limit" : "driver", now);
    return { ...g, attemptNumber: a.attempt_number, remaining: Math.max(0, Number(a.rules.max_attempts) - a.attempt_number) };
  });
}

/** Tentativa para o motorista (sem gabarito). */
export async function attemptForDriver(driver: DriverPrincipal, attemptId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(attemptId)) return null;
  const [a] = await asDriver(driver.id, (tx) => tx<AttemptRow[]>`
    select id, convocation_id, exam_id, attempt_number, started_at, deadline_at, submitted_at, submit_reason, questions, rules, answers, correct_count, score_pct, passed
    from exam_attempts where id = ${attemptId}`);
  return a ?? null;
}

/** Detalhe completo da tentativa para o administrador (com gabarito). */
export async function attemptForAdmin(admin: AdminPrincipal, attemptId: string) {
  const [a] = await asAdmin(admin, (tx) => tx<(AttemptRow & { answer_key: AnswerKey })[]>`select * from exam_attempts where id = ${attemptId}`);
  return a ?? null;
}

/**
 * Revisão após o envio. O gabarito e as explicações só aparecem quando não há mais
 * tentativas a fazer (aprovado ou tentativas esgotadas), para não entregar respostas da próxima prova.
 */
export async function attemptReview(driver: DriverPrincipal, attemptId: string) {
  return asSystem(async (tx) => {
    const a = await loadOwnAttempt(tx, driver, attemptId);
    if (!a.submitted_at) return null;
    const [{ n, passed }] = await tx<{ n: number; passed: boolean }[]>`
      select count(*)::int as n, bool_or(coalesce(passed, false)) as passed from exam_attempts where convocation_id = ${a.convocation_id}`;
    const showKey = passed || n >= Number(a.rules.max_attempts);
    const items = a.questions.map((q) => {
      const chosen = a.answers[q.id] ?? null;
      const right = a.answer_key[q.id]?.correct;
      return { id: q.id, statement: q.statement, topic: q.topic, options: q.options, chosen, correct: showKey ? chosen === right : null,
        rightOption: showKey ? right : null, explanation: showKey ? a.answer_key[q.id]?.explanation ?? null : null };
    });
    return { attempt: { id: a.id, convocation_id: a.convocation_id, attempt_number: a.attempt_number, submitted_at: a.submitted_at, submit_reason: a.submit_reason,
      correct_count: a.correct_count, score_pct: Number(a.score_pct), passed: a.passed, pass_pct: Number(a.rules.pass_pct), total: a.questions.length },
      remaining: passed ? 0 : Math.max(0, Number(a.rules.max_attempts) - n), showKey, items };
  });
}
