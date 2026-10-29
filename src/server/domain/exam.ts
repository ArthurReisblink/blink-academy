import { randomInt } from "node:crypto";

export type PoolQuestion = { id: string; topic: string; statement: string; explanation: string | null; options: { id: string; text: string; is_correct: boolean }[] };
export type AttemptQuestion = { id: string; topic: string; statement: string; options: { id: string; text: string }[] };
export type AnswerKey = Record<string, { correct: string; explanation: string | null }>;
export type ExamRules = { question_count: number; pass_pct: number; max_attempts: number; time_limit_minutes: number | null; display_mode: "one" | "all";
  shuffle_questions: boolean; shuffle_options: boolean; selection_mode: "manual" | "random"; exam_title: string };

export function shuffle<T>(a: T[]): T[] {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) { const j = randomInt(0, i + 1); [r[i], r[j]] = [r[j], r[i]]; }
  return r;
}

/** Monta a prova a partir do banco: sorteia/embaralha e separa o gabarito. */
export function buildAttempt(pool: PoolQuestion[], rules: ExamRules) {
  const valid = pool.filter((q) => q.options.length >= 4 && q.options.filter((o) => o.is_correct).length === 1);
  if (valid.length < rules.question_count) {
    throw new Error(`Banco insuficiente: a prova pede ${rules.question_count} questões e há ${valid.length} válidas.`);
  }
  let chosen = rules.selection_mode === "random" ? shuffle(valid).slice(0, rules.question_count) : valid.slice(0, rules.question_count);
  if (rules.shuffle_questions) chosen = shuffle(chosen);
  const questions: AttemptQuestion[] = chosen.map((q) => ({
    id: q.id, topic: q.topic, statement: q.statement,
    options: (rules.shuffle_options ? shuffle(q.options) : q.options).map((o) => ({ id: o.id, text: o.text })),
  }));
  const key: AnswerKey = Object.fromEntries(chosen.map((q) => [q.id, { correct: q.options.find((o) => o.is_correct)!.id, explanation: q.explanation }]));
  return { questions, key };
}

/** Correção: nota de 0 a 100; aprovado se nota >= mínimo. */
export function grade(questions: AttemptQuestion[], key: AnswerKey, answers: Record<string, string>, passPct: number) {
  const correct = questions.filter((q) => answers[q.id] && answers[q.id] === key[q.id]?.correct).length;
  const score = questions.length ? Math.round((correct / questions.length) * 10000) / 100 : 0;
  return { correct, total: questions.length, score, passed: score >= passPct };
}
