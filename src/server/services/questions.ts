import "server-only";
import { z } from "zod";
import { asAdmin, type Tx } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { AdminPrincipal, ReqCtx } from "../context";
import { assertCanWrite } from "../auth/admin";
import { auditLog } from "../auth/log";
import { QUESTION_BANK, SOURCE } from "../data/question-bank";
import { optText, parse } from "./common";

export type QuestionRow = { id: string; topic_id: string; topic: string; statement: string; explanation: string | null; source: string | null; active: boolean;
  options: { id: string; text: string; is_correct: boolean; position: number }[]; used_in_attempts: number; used_in_exams: number; error_rate: number | null; answered: number };

export async function listTopics(admin: AdminPrincipal) {
  return asAdmin(admin, (tx) => tx<{ id: string; name: string; questions: number }[]>`
    select t.id, t.name, (select count(*)::int from questions q where q.topic_id = t.id and q.active) as questions
    from question_topics t order by t.position, t.name`);
}

/** Lista com estatística de erro (a partir das tentativas já enviadas). */
export async function listQuestions(admin: AdminPrincipal, f: { topicId?: string; q?: string; status?: "active" | "inactive" | "" } = {}) {
  return asAdmin(admin, (tx) => tx<QuestionRow[]>`
    with stats as (
      select (q->>'id')::uuid as qid, count(*)::int as answered,
        count(*) filter (where coalesce(a.answers->>(q->>'id'), '') <> a.answer_key->(q->>'id')->>'correct')::int as wrong
      from exam_attempts a, jsonb_array_elements(a.questions) q where a.submitted_at is not null group by 1)
    select q.id, q.topic_id, t.name as topic, q.statement, q.explanation, q.source, q.active,
      coalesce((select json_agg(json_build_object('id', o.id, 'text', o.text, 'is_correct', o.is_correct, 'position', o.position) order by o.position)
                from question_options o where o.question_id = q.id), '[]') as options,
      (select count(*)::int from exam_attempts a where a.questions @> jsonb_build_array(jsonb_build_object('id', q.id::text))) as used_in_attempts,
      (select count(*)::int from exam_questions eq where eq.question_id = q.id) as used_in_exams,
      case when s.answered > 0 then round(100.0 * s.wrong / s.answered, 1) end as error_rate, coalesce(s.answered, 0) as answered
    from questions q join question_topics t on t.id = q.topic_id left join stats s on s.qid = q.id
    where true
      ${f.topicId ? tx`and q.topic_id = ${f.topicId}` : tx``}
      ${f.q ? tx`and q.statement ilike ${"%" + f.q + "%"}` : tx``}
      ${f.status === "active" ? tx`and q.active` : f.status === "inactive" ? tx`and not q.active` : tx``}
    order by t.position, q.created_at`);
}

const questionSchema = z.object({
  topicId: z.string().uuid("Escolha o assunto."),
  statement: z.string().trim().min(10, "Escreva o enunciado da pergunta.").max(1000),
  explanation: optText(2000),
  options: z.array(z.string().trim().max(500)).transform((a) => a.filter(Boolean)).pipe(z.array(z.string()).min(4, "Cadastre pelo menos quatro alternativas.").max(8, "No máximo 8 alternativas.")),
  correctIndex: z.number().int().min(0, "Marque a resposta correta."),
}).refine((d) => d.correctIndex < d.options.length, { message: "Marque a resposta correta." })
  .refine((d) => new Set(d.options.map((o) => o.toLowerCase())).size === d.options.length, { message: "Há alternativas repetidas." });

export type QuestionInput = z.input<typeof questionSchema>;

async function writeOptions(tx: Tx, questionId: string, options: string[], correctIndex: number) {
  await tx`delete from question_options where question_id = ${questionId}`;
  for (const [i, text] of options.entries()) {
    await tx`insert into question_options (question_id, text, is_correct, position) values (${questionId}, ${text}, ${i === correctIndex}, ${i + 1})`;
  }
}

export async function createQuestion(admin: AdminPrincipal, input: QuestionInput, ctx: ReqCtx, source: string | null = null) {
  assertCanWrite(admin);
  const d = parse(questionSchema, input);
  return asAdmin(admin, async (tx) => {
    const [q] = await tx<{ id: string }[]>`insert into questions (topic_id, statement, explanation, source, created_by)
      values (${d.topicId}, ${d.statement}, ${d.explanation}, ${source}, ${admin.id}) returning id`;
    await writeOptions(tx, q.id, d.options, d.correctIndex);
    await auditLog(tx, admin.id, "question.create", "question", q.id, { statement: d.statement.slice(0, 120) }, ctx.ip);
    return q.id;
  });
}

/**
 * Edição: as tentativas já realizadas guardam cópia das perguntas e não mudam.
 * As alternativas são regravadas (novos identificadores) para não confundir estatísticas antigas.
 */
export async function updateQuestion(admin: AdminPrincipal, id: string, input: QuestionInput, ctx: ReqCtx) {
  assertCanWrite(admin);
  const d = parse(questionSchema, input);
  await asAdmin(admin, async (tx) => {
    const r = await tx`update questions set topic_id = ${d.topicId}, statement = ${d.statement}, explanation = ${d.explanation} where id = ${id} returning id`;
    if (!r.length) throw new AppError("not_found", "Pergunta não encontrada.", 404);
    await writeOptions(tx, id, d.options, d.correctIndex);
    await auditLog(tx, admin.id, "question.update", "question", id, { statement: d.statement.slice(0, 120) }, ctx.ip);
  });
}

export async function setQuestionActive(admin: AdminPrincipal, id: string, active: boolean, ctx: ReqCtx) {
  assertCanWrite(admin);
  await asAdmin(admin, async (tx) => {
    await tx`update questions set active = ${active} where id = ${id}`;
    await auditLog(tx, admin.id, active ? "question.activate" : "question.deactivate", "question", id, {}, ctx.ip);
  });
}

/** Excluir só é permitido para perguntas nunca usadas; as usadas devem ser desativadas. */
export async function deleteQuestion(admin: AdminPrincipal, id: string, ctx: ReqCtx) {
  assertCanWrite(admin);
  await asAdmin(admin, async (tx) => {
    const [used] = await tx<{ n: number }[]>`select count(*)::int as n from exam_attempts a where a.questions @> jsonb_build_array(jsonb_build_object('id', ${id}::text))`;
    const [inExam] = await tx`select 1 from exam_questions where question_id = ${id} limit 1`;
    if (used.n > 0 || inExam) throw new AppError("in_use", "Esta pergunta já foi usada em provas. Desative-a em vez de excluir.");
    await tx`delete from questions where id = ${id}`;
    await auditLog(tx, admin.id, "question.delete", "question", id, {}, ctx.ip);
  });
}

/** Carrega o banco inicial (baseado no documento do treinamento) se ainda não houver perguntas. */
export async function seedQuestionBank(admin: AdminPrincipal, ctx: ReqCtx) {
  assertCanWrite(admin);
  return asAdmin(admin, async (tx) => {
    const [{ n }] = await tx<{ n: number }[]>`select count(*)::int as n from questions where source = ${SOURCE}`;
    if (n > 0) throw new AppError("exists", "O banco inicial já foi carregado.");
    const topics = Object.fromEntries((await tx<{ id: string; name: string }[]>`select id, name from question_topics`).map((t) => [t.name, t.id]));
    for (const q of QUESTION_BANK) {
      const [row] = await tx<{ id: string }[]>`insert into questions (topic_id, statement, explanation, source, created_by)
        values (${topics[q.topic]}, ${q.statement}, ${q.explanation}, ${SOURCE}, ${admin.id}) returning id`;
      await writeOptions(tx, row.id, [q.correct, ...q.wrong], 0);
    }
    await auditLog(tx, admin.id, "question.seed", "question", null, { count: QUESTION_BANK.length, source: SOURCE }, ctx.ip);
    return QUESTION_BANK.length;
  });
}
