import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { asDriver, closeDb } from "@/lib/db";
import { createDriver } from "@/server/services/drivers";
import { createDraftVersion, publishVersion, versionProblems } from "@/server/services/trainings";
import { attemptForDriver, examState, saveAnswer, setVersionExam, startAttempt, submitAttempt, updateExam } from "@/server/services/exams";
import { listQuestions, updateQuestion } from "@/server/services/questions";
import { QUESTION_BANK } from "@/server/data/question-bank";
import { asAdmin } from "@/lib/db";
import type { AdminPrincipal, DriverPrincipal } from "@/server/context";
import { adminPrincipal, ctx, defaultExam, publishedTraining, raw, resetData, uniqueCpf } from "../helpers";

afterAll(async () => { await closeDb(); await raw.end(); });

let admin: AdminPrincipal;
let trainingId: string;
let examId: string;
beforeEach(async () => {
  await resetData();
  admin = await adminPrincipal();
  trainingId = (await publishedTraining(admin)).trainingId;
  const [v] = await raw<{ exam_id: string }[]>`select exam_id from academy.training_versions where training_id = ${trainingId} and status = 'published'`;
  examId = v.exam_id;
});

async function convocated(): Promise<{ drv: DriverPrincipal; convId: string }> {
  const r = await createDriver(admin, { fullName: "Motorista Prova", cpf: uniqueCpf(), phone: `(27) 9${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}` },
    { trainingId, deadline: { mode: "duration", hours: 72, startMode: "activation" } }, ctx());
  return { drv: { id: r.id, name: "", sessionId: "", otpChallengeId: null }, convId: r.convocationId! };
}

/** Marca os vídeos obrigatórios como concluídos (o cálculo do progresso é testado na etapa 3). */
async function completeVideos(convId: string, which: "all" | "first" = "all") {
  const vids = await raw<{ video_id: string }[]>`select vv.video_id from academy.convocations c join academy.version_videos vv on vv.version_id = c.training_version_id
    where c.id = ${convId} order by vv.position`;
  for (const [i, v] of vids.entries()) {
    if (which === "first" && i > 0) break;
    await raw`insert into academy.video_progress (convocation_id, video_id, covered_seconds, duration_seconds, completion_pct, completed_at)
      values (${convId}, ${v.video_id}, 100, 100, 95, now())`;
  }
}

/** Responde exatamente `nCorrect` questões certas (o teste lê o gabarito direto do banco). */
async function answerWith(drv: DriverPrincipal, attemptId: string, nCorrect: number) {
  const [a] = await raw<{ questions: { id: string; options: { id: string }[] }[]; answer_key: Record<string, { correct: string }> }[]>`
    select questions, answer_key from academy.exam_attempts where id = ${attemptId}`;
  for (const [i, q] of a.questions.entries()) {
    const right = a.answer_key[q.id].correct;
    const opt = i < nCorrect ? right : q.options.find((o) => o.id !== right)!.id;
    await saveAnswer(drv, attemptId, q.id, opt);
  }
}

describe("Etapa 4 — banco de questões", () => {
  it("banco inicial: 38 perguntas, 9 assuntos, todas com 4 alternativas, 1 correta e explicação", async () => {
    const qs = await listQuestions(admin);
    expect(qs.length).toBe(QUESTION_BANK.length);
    expect(new Set(qs.map((q) => q.topic)).size).toBe(9);
    for (const q of qs) {
      expect(q.options.length).toBeGreaterThanOrEqual(4);
      expect(q.options.filter((o) => o.is_correct).length).toBe(1);
      expect(q.explanation).toBeTruthy();
    }
  });

  it("versão sem prova (ou com banco insuficiente) não pode ser publicada", async () => {
    const vId = await createDraftVersion(admin, trainingId, ctx());
    expect(await asAdmin(admin, (tx) => versionProblems(tx, vId))).toEqual([]); // copiou a prova
    await setVersionExam(admin, vId, null, ctx());
    expect((await asAdmin(admin, (tx) => versionProblems(tx, vId))).join()).toMatch(/vincule uma prova/);
    const big = await defaultExam(admin, { title: "Grande", questionCount: 60 });
    await setVersionExam(admin, vId, big, ctx());
    await expect(publishVersion(admin, vId, ctx())).rejects.toThrow(/pede 60 questões/);
  });
});

describe("Etapa 4 — avaliação", () => {
  it("Prova não abre com vídeo obrigatório incompleto", async () => {
    const { drv, convId } = await convocated();
    await completeVideos(convId, "first");
    const st = await examState(drv, convId);
    expect(st.canStart).toBe(false);
    expect(st.reason).toMatch(/Conclua todos os vídeos/);
    await expect(startAttempt(drv, convId)).rejects.toThrow(/Conclua todos os vídeos/);
    // nem inserindo direto com o papel do sistema: o banco recusa
    await expect(raw`insert into academy.exam_attempts (convocation_id, exam_id, attempt_number, questions, answer_key, rules)
      values (${convId}, ${examId}, 1, '[]', '{}', '{}')`).rejects.toThrow(/vídeos obrigatórios/);
  });

  it("gera a prova com 10 questões sem expor o gabarito ao motorista", async () => {
    const { drv, convId } = await convocated();
    await completeVideos(convId);
    const id = await startAttempt(drv, convId);
    const a = await attemptForDriver(drv, id);
    expect(a!.questions.length).toBe(10);
    expect(JSON.stringify(a)).not.toMatch(/is_correct|answer_key|"correct"/);
    // o papel do motorista não lê o gabarito nem altera respostas direto no banco
    await expect(asDriver(drv.id, (tx) => tx`select answer_key from exam_attempts where id = ${id}`)).rejects.toThrow(/permission denied/);
    await expect(asDriver(drv.id, (tx) => tx`update exam_attempts set passed = true where id = ${id}`)).rejects.toThrow(/permission denied/);
    // chamar INICIAR de novo devolve a mesma tentativa
    expect(await startAttempt(drv, convId)).toBe(id);
  });

  it("Nota abaixo do mínimo reprova (7/10 com mínimo 80%)", async () => {
    const { drv, convId } = await convocated();
    await completeVideos(convId);
    const id = await startAttempt(drv, convId);
    await answerWith(drv, id, 7);
    const r = await submitAttempt(drv, id);
    expect(r).toMatchObject({ correct: 7, total: 10, score: 70, passed: false, remaining: 2 });
  });

  it("Nota igual ao mínimo aprova (8/10 com mínimo 80%)", async () => {
    const { drv, convId } = await convocated();
    await completeVideos(convId);
    const id = await startAttempt(drv, convId);
    await answerWith(drv, id, 8);
    const r = await submitAttempt(drv, id);
    expect(r).toMatchObject({ correct: 8, score: 80, passed: true });
    const st = await examState(drv, convId);
    expect(st.passed?.id).toBe(id);
    await expect(startAttempt(drv, convId)).rejects.toThrow(/já foi aprovado/);
  });

  it("Tentativas são respeitadas", async () => {
    const { drv, convId } = await convocated();
    await completeVideos(convId);
    for (let i = 1; i <= 3; i++) {
      const id = await startAttempt(drv, convId);
      await answerWith(drv, id, 2);
      const r = await submitAttempt(drv, id);
      expect(r.attemptNumber).toBe(i);
    }
    const st = await examState(drv, convId);
    expect(st.remaining).toBe(0);
    await expect(startAttempt(drv, convId)).rejects.toThrow(/todas as tentativas/);
    await expect(raw`insert into academy.exam_attempts (convocation_id, exam_id, attempt_number, questions, answer_key, rules)
      values (${convId}, ${examId}, 4, '[]', '{}', '{}')`).rejects.toThrow(/Limite de tentativas/);
  });

  it("prova enviada é imutável e não aceita novas respostas", async () => {
    const { drv, convId } = await convocated();
    await completeVideos(convId);
    const id = await startAttempt(drv, convId);
    await answerWith(drv, id, 9);
    await submitAttempt(drv, id);
    const [a] = await raw<{ questions: { id: string; options: { id: string }[] }[] }[]>`select questions from academy.exam_attempts where id = ${id}`;
    await expect(saveAnswer(drv, id, a.questions[0].id, a.questions[0].options[0].id)).rejects.toThrow(/já foi enviada/);
    await expect(submitAttempt(drv, id)).rejects.toThrow(/já foi enviada/);
    await expect(raw`update academy.exam_attempts set score_pct = 100 where id = ${id}`).rejects.toThrow(/enviada|imut/i);
    await expect(raw`delete from academy.exam_attempts where id = ${id}`).rejects.toThrow();
  });

  it("resposta com alternativa de outra questão é recusada", async () => {
    const { drv, convId } = await convocated();
    await completeVideos(convId);
    const id = await startAttempt(drv, convId);
    const [a] = await raw<{ questions: { id: string; options: { id: string }[] }[] }[]>`select questions from academy.exam_attempts where id = ${id}`;
    await expect(saveAnswer(drv, id, a.questions[0].id, a.questions[1].options[0].id)).rejects.toThrow(/inválida/);
    // outro motorista não enxerga nem responde a prova
    const other = await convocated();
    await expect(saveAnswer(other.drv, id, a.questions[0].id, a.questions[0].options[0].id)).rejects.toThrow(/não encontrada/);
    expect(await attemptForDriver(other.drv, id)).toBeNull();
  });

  it("Mudança de questões não altera provas antigas", async () => {
    const { drv, convId } = await convocated();
    await completeVideos(convId);
    const id = await startAttempt(drv, convId);
    await answerWith(drv, id, 10);
    await submitAttempt(drv, id);
    const before = await attemptForDriver(drv, id);
    const q = before!.questions[0];
    const row = (await listQuestions(admin)).find((x) => x.id === q.id)!;
    await updateQuestion(admin, q.id, { topicId: row.topic_id, statement: "ENUNCIADO ALTERADO DEPOIS DA PROVA", explanation: "nova",
      options: ["A nova", "B nova", "C nova", "D nova"], correctIndex: 3 }, ctx());
    await updateExam(admin, examId, { title: "Avaliação alterada", questionCount: 5, passPct: 100, maxAttempts: 1, timeLimitMinutes: 5,
      selectionMode: "random", topicIds: [], shuffleQuestions: false, shuffleOptions: false, displayMode: "all" }, ctx());
    const after = await attemptForDriver(drv, id);
    expect(after).toEqual(before);
    expect(after!.questions[0].statement).not.toMatch(/ALTERADO/);
    expect(Number(after!.score_pct)).toBe(100);
    expect(after!.rules.pass_pct).toBe(80);
  });

  it("prazo expirado bloqueia o início e o envio da prova", async () => {
    const { drv, convId } = await convocated();
    await completeVideos(convId);
    const id = await startAttempt(drv, convId);
    await raw`update academy.convocations set blocked_at = now() where id = ${convId}`;
    const [a] = await raw<{ questions: { id: string; options: { id: string }[] }[] }[]>`select questions from academy.exam_attempts where id = ${id}`;
    await expect(saveAnswer(drv, id, a.questions[0].id, a.questions[0].options[0].id)).rejects.toThrow(/prazo de treinamento terminou/);
    await expect(submitAttempt(drv, id)).rejects.toThrow(/prazo de treinamento terminou/);
    const other = await convocated();
    await completeVideos(other.convId);
    await raw`update academy.convocations set expires_at = now() - interval '1 minute' where id = ${other.convId}`;
    const st = await examState(other.drv, other.convId);
    expect(st.canStart).toBe(false);
    await expect(startAttempt(other.drv, other.convId)).rejects.toThrow(/prazo/);
  });

  it("tempo-limite: envia automaticamente com as respostas salvas", async () => {
    await updateExam(admin, examId, { title: "Com tempo", questionCount: 10, passPct: 80, maxAttempts: 3, timeLimitMinutes: 10,
      selectionMode: "random", topicIds: [], shuffleQuestions: true, shuffleOptions: true, displayMode: "one" }, ctx());
    const { drv, convId } = await convocated();
    await completeVideos(convId);
    const t0 = new Date();
    const id = await startAttempt(drv, convId, t0);
    await answerWith(drv, id, 8);
    const late = new Date(t0.getTime() + 11 * 60000);
    const st = await examState(drv, convId, late);
    expect(st.inProgress).toBeNull();
    expect(st.attempts[0]).toMatchObject({ submit_reason: "time_limit", passed: true });
  });
});
