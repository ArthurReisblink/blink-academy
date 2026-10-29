import { describe, expect, it } from "vitest";
import { buildAttempt, grade, type ExamRules, type PoolQuestion } from "@/server/domain/exam";

const pool: PoolQuestion[] = Array.from({ length: 15 }, (_, i) => ({
  id: `q${i}`, topic: "T", statement: `Pergunta ${i}`, explanation: null,
  options: [0, 1, 2, 3].map((j) => ({ id: `q${i}o${j}`, text: `Alt ${j}`, is_correct: j === 0 })),
}));
const rules: ExamRules = { question_count: 10, pass_pct: 80, max_attempts: 3, time_limit_minutes: null, display_mode: "one", shuffle_questions: true, shuffle_options: true, selection_mode: "random", exam_title: "Prova" };

describe("Prova", () => {
  it("sorteia a quantidade pedida, sem repetir, e não expõe o gabarito nas questões", () => {
    const a = buildAttempt(pool, rules);
    expect(a.questions).toHaveLength(10);
    expect(new Set(a.questions.map((q) => q.id)).size).toBe(10);
    expect(JSON.stringify(a.questions)).not.toContain("is_correct");
    for (const q of a.questions) expect(a.key[q.id].correct).toBe(`${q.id}o0`);
  });
  it("embaralha alternativas", () => {
    const orders = new Set(Array.from({ length: 30 }, () => buildAttempt(pool, rules).questions[0].options.map((o) => o.id.slice(-2)).join("")));
    expect(orders.size).toBeGreaterThan(1);
  });
  it("recusa banco insuficiente e questões mal formadas", () => {
    expect(() => buildAttempt(pool.slice(0, 5), rules)).toThrow(/insuficiente/);
    const bad = pool.map((q) => ({ ...q, options: q.options.map((o) => ({ ...o, is_correct: true })) }));
    expect(() => buildAttempt(bad, rules)).toThrow(/insuficiente/);
  });
  it("nota mínima 80% com 10 questões: 8 acertos aprova, 7 reprova", () => {
    const a = buildAttempt(pool, rules);
    const answers = (n: number) => Object.fromEntries(a.questions.map((q, i) => [q.id, i < n ? a.key[q.id].correct : "errada"]));
    expect(grade(a.questions, a.key, answers(8), 80)).toMatchObject({ correct: 8, score: 80, passed: true });
    expect(grade(a.questions, a.key, answers(7), 80)).toMatchObject({ correct: 7, score: 70, passed: false });
    expect(grade(a.questions, a.key, {}, 80)).toMatchObject({ correct: 0, score: 0, passed: false });
  });
});
