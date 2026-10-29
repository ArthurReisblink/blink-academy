/**
 * Os 14 testes obrigatórios da especificação (seção 14), reunidos num só arquivo
 * para conferência. Cada um usa os serviços reais e um banco de dados de teste.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { asDriver, closeDb } from "@/lib/db";
import { createDriver } from "@/server/services/drivers";
import { createConvocation, extendConvocation } from "@/server/services/convocations";
import { getDriverByToken, requestDriverLogin, verifyDriverLogin } from "@/server/auth/driver";
import { recordHeartbeat, videoPlayback } from "@/server/services/videos";
import { attemptForDriver, examState, saveAnswer, startAttempt, submitAttempt, updateExam } from "@/server/services/exams";
import { listQuestions, updateQuestion } from "@/server/services/questions";
import { driverDocumentUrl, requestSignatureCode, signTerm, signingState } from "@/server/services/signatures";
import { driverHome } from "@/server/services/portal";
import type { AdminPrincipal, DriverPrincipal } from "@/server/context";
import { adminPrincipal, ctx, lastCodeFor, publishedTraining, raw, resetData, uniqueCpf } from "../helpers";

afterAll(async () => { await closeDb(); await raw.end(); });

let admin: AdminPrincipal;
let trainingId: string;
let seq = 6000;
beforeEach(async () => {
  await resetData();
  admin = await adminPrincipal();
  trainingId = (await publishedTraining(admin)).trainingId;
});

type D = { drv: DriverPrincipal; convId: string; cpf: string; phone: string; id: string };
async function convocated(opts: { hours?: number; login?: boolean } = {}): Promise<D> {
  const cpf = uniqueCpf();
  const phone = `+55279555${String(++seq).padStart(5, "0")}`;
  const r = await createDriver(admin, { fullName: "Motorista Obrigatório", cpf, phone: phone.slice(3) },
    { trainingId, deadline: { mode: "duration", hours: opts.hours ?? 72, startMode: "activation" } }, ctx());
  if (opts.login === false) return { drv: { id: r.id, name: "", sessionId: "", otpChallengeId: null }, convId: r.convocationId!, cpf, phone, id: r.id };
  const ch = await requestDriverLogin(cpf, ctx());
  const s = await verifyDriverLogin(ch.challengeId, await lastCodeFor(phone), ctx());
  return { drv: (await getDriverByToken(s.token))!, convId: r.convocationId!, cpf, phone, id: r.id };
}
async function completeVideos(convId: string, onlyFirst = false) {
  const vids = await raw<{ video_id: string }[]>`select vv.video_id from academy.convocations c join academy.version_videos vv on vv.version_id = c.training_version_id where c.id = ${convId} order by vv.position`;
  for (const v of onlyFirst ? vids.slice(0, 1) : vids) {
    await raw`insert into academy.video_progress (convocation_id, video_id, covered_seconds, duration_seconds, completion_pct, completed_at) values (${convId}, ${v.video_id}, 100, 100, 95, now())`;
  }
}
async function takeExam(d: D, nCorrect: number) {
  const id = await startAttempt(d.drv, d.convId);
  const [a] = await raw<{ questions: { id: string; options: { id: string }[] }[]; answer_key: Record<string, { correct: string }> }[]>`select questions, answer_key from academy.exam_attempts where id = ${id}`;
  for (const [i, q] of a.questions.entries()) {
    const right = a.answer_key[q.id].correct;
    await saveAnswer(d.drv, id, q.id, i < nCorrect ? right : q.options.find((o) => o.id !== right)!.id);
  }
  return { id, result: await submitAttempt(d.drv, id) };
}
async function sign(d: D) {
  const r = await requestSignatureCode(d.drv, d.convId, ctx());
  return signTerm(d.drv, d.convId, { challengeId: r.challengeId, code: await lastCodeFor(d.phone), accepted: true }, ctx());
}

describe("Testes obrigatórios (seção 14)", () => {
  it("01. CPF inexistente não acessa", async () => {
    const r = await requestDriverLogin(uniqueCpf(), ctx());
    const [{ n }] = await raw`select count(*)::int as n from academy.dev_outbox`;
    expect(n).toBe(0); // nenhum código enviado
    for (const code of ["000000", "123456"]) await expect(verifyDriverLogin(r.challengeId, code, ctx())).rejects.toThrow(/Código/);
    const [{ s }] = await raw`select count(*)::int as s from academy.sessions where subject_type = 'driver'`;
    expect(s).toBe(0);
  });

  it("02. CPF cadastrado sem autenticação válida não acessa", async () => {
    const d = await convocated({ login: false });
    const r = await requestDriverLogin(d.cpf, ctx());
    for (let i = 0; i < 5; i++) await expect(verifyDriverLogin(r.challengeId, "000000", ctx())).rejects.toThrow(/Código/);
    // após 5 erros, nem o código certo funciona
    await expect(verifyDriverLogin(r.challengeId, await lastCodeFor(d.phone), ctx())).rejects.toThrow(/Código/);
    expect(await getDriverByToken("token-inventado")).toBeNull();
    const [{ s }] = await raw`select count(*)::int as s from academy.sessions where subject_type = 'driver'`;
    expect(s).toBe(0);
  });

  it("03. Acesso vencido fica bloqueado", async () => {
    const d = await convocated();
    await raw`update academy.convocations set activated_at = now() - interval '73 hours' where id = ${d.convId}`;
    const home = await driverHome(d.drv);
    expect(home.convocations[0].status).toBe("expirado");
    const [v] = await raw<{ video_id: string }[]>`select vv.video_id from academy.convocations c join academy.version_videos vv on vv.version_id = c.training_version_id where c.id = ${d.convId} limit 1`;
    await expect(videoPlayback(d.drv, d.convId, v.video_id)).rejects.toThrow(/prazo/i);
    await expect(recordHeartbeat(d.drv, { convocationId: d.convId, videoId: v.video_id, event: "heartbeat", position: 10, segments: [[0, 10]] })).rejects.toThrow();
    await completeVideos(d.convId);
    await expect(startAttempt(d.drv, d.convId)).rejects.toThrow(/prazo/);
    // O motorista ainda consegue entrar para ler o aviso de prazo encerrado, mas nada além disso.
    expect(home.convocations[0].videos.length).toBeGreaterThan(0);
    const { EXPIRED_MSG } = await import("@/server/domain/status");
    expect(EXPIRED_MSG).toBe("Seu prazo de treinamento terminou. Entre em contato com a administração da BLINK.");
  });

  it("04. Administrador pode prorrogar prazo (o progresso é mantido)", async () => {
    const d = await convocated();
    await completeVideos(d.convId, true);
    await raw`update academy.convocations set activated_at = now() - interval '73 hours' where id = ${d.convId}`;
    expect((await signingState(d.drv, d.convId))!.conv.status).toBe("expirado");
    await extendConvocation(admin, d.convId, { hours: 48 }, ctx());
    const st = (await driverHome(d.drv)).convocations[0];
    expect(st.status).not.toBe("expirado");
    expect(st.completed_required_videos).toBe(1); // vídeo assistido antes continua valendo
    const ev = await raw`select type from academy.convocation_events where convocation_id = ${d.convId} and type = 'extended'`;
    expect(ev.length).toBe(1);
  });

  it("05. Motorista não consulta dados de outro CPF", async () => {
    const a = await convocated();
    const b = await convocated();
    await completeVideos(a.convId);
    const { id: attemptId } = await takeExam(a, 10);
    await sign(a);
    const seen = await asDriver(b.drv.id, async (tx) => ({
      drivers: await tx`select id from drivers where id = ${a.id}`,
      convs: await tx`select id from convocations where id = ${a.convId}`,
      progress: await tx`select 1 from video_progress where convocation_id = ${a.convId}`,
      attempts: await tx`select id from exam_attempts where convocation_id = ${a.convId}`,
      signatures: await tx`select id from signatures where convocation_id = ${a.convId}`,
      certificates: await tx`select id from certificates where convocation_id = ${a.convId}`,
    }));
    for (const rows of Object.values(seen)) expect(rows.length).toBe(0);
    expect(await attemptForDriver(b.drv, attemptId)).toBeNull();
    await expect(driverDocumentUrl(b.drv, "certificate", a.convId)).rejects.toThrow(/não encontrado/);
    await expect(asDriver(b.drv.id, (tx) => tx`select cpf_enc from drivers`)).rejects.toThrow(/permission denied/);
  });

  it("06. Prova não abre com vídeo obrigatório incompleto", async () => {
    const d = await convocated();
    await completeVideos(d.convId, true);
    expect((await examState(d.drv, d.convId)).canStart).toBe(false);
    await expect(startAttempt(d.drv, d.convId)).rejects.toThrow(/vídeos obrigatórios/);
  });

  it("07. Nota abaixo do mínimo reprova", async () => {
    const d = await convocated();
    await completeVideos(d.convId);
    const { result } = await takeExam(d, 7);
    expect(result).toMatchObject({ score: 70, passed: false });
  });

  it("08. Nota igual ao mínimo aprova", async () => {
    const d = await convocated();
    await completeVideos(d.convId);
    const { result } = await takeExam(d, 8);
    expect(result).toMatchObject({ score: 80, passed: true });
  });

  it("09. Tentativas são respeitadas", async () => {
    const d = await convocated();
    await completeVideos(d.convId);
    for (let i = 0; i < 3; i++) expect((await takeExam(d, 1)).result.passed).toBe(false);
    await expect(startAttempt(d.drv, d.convId)).rejects.toThrow(/todas as tentativas/);
  });

  it("10. Mudança de questões não altera provas antigas", async () => {
    const d = await convocated();
    await completeVideos(d.convId);
    const { id } = await takeExam(d, 10);
    const before = await attemptForDriver(d.drv, id);
    const q = (await listQuestions(admin)).find((x) => x.id === before!.questions[0].id)!;
    await updateQuestion(admin, q.id, { topicId: q.topic_id, statement: "Pergunta reescrita depois da prova", explanation: "x", options: ["1", "2", "3", "4"], correctIndex: 2 }, ctx());
    const [v] = await raw<{ exam_id: string }[]>`select tv.exam_id from academy.convocations c join academy.training_versions tv on tv.id = c.training_version_id where c.id = ${d.convId}`;
    await updateExam(admin, v.exam_id, { title: "Nova", questionCount: 5, passPct: 100, maxAttempts: 1, timeLimitMinutes: null, selectionMode: "random", topicIds: [], shuffleQuestions: false, shuffleOptions: false, displayMode: "all" }, ctx());
    expect(await attemptForDriver(d.drv, id)).toEqual(before);
  });

  it("11. Termo não é liberado antes da aprovação", async () => {
    const d = await convocated();
    await completeVideos(d.convId);
    await expect(requestSignatureCode(d.drv, d.convId, ctx())).rejects.toThrow(/aprovação/);
    await takeExam(d, 5); // reprovado
    expect((await signingState(d.drv, d.convId))!.canSign).toBe(false);
    await expect(requestSignatureCode(d.drv, d.convId, ctx())).rejects.toThrow(/aprovação/);
  });

  it("12. Assinatura não pode ser registrada por outro usuário", async () => {
    const a = await convocated();
    const b = await convocated();
    await completeVideos(a.convId); await completeVideos(b.convId);
    await takeExam(a, 10); await takeExam(b, 10);
    // B tenta assinar a convocação de A com o próprio código
    const rb = await requestSignatureCode(b.drv, b.convId, ctx());
    await expect(signTerm(b.drv, a.convId, { challengeId: rb.challengeId, code: await lastCodeFor(b.phone), accepted: true }, ctx())).rejects.toThrow(/não encontrada/);
    // B tenta usar o código enviado para A
    const ra = await requestSignatureCode(a.drv, a.convId, ctx());
    await expect(signTerm(b.drv, b.convId, { challengeId: ra.challengeId, code: await lastCodeFor(a.phone), accepted: true }, ctx())).rejects.toThrow(/inválido ou expirado/);
    const [{ n }] = await raw`select count(*)::int as n from academy.signatures`;
    expect(n).toBe(0);
    // o banco recusa assinatura com motorista diferente do convocado
    await expect(raw`insert into academy.signatures (convocation_id, driver_id, term_id, term_sha256, signed_at, signer_name, signer_cpf_mask, otp_challenge_id, otp_channel, otp_destination_mask, evidence, evidence_sha256, signed_pdf_key, signed_pdf_sha256, verification_code)
      select ${a.convId}, ${b.id}, tv.term_id, 'x', now(), 'B', 'x', ${rb.challengeId}, 'sms', 'x', '{}', repeat('a', 64), 'k', repeat('b', 64), 'TEST-TEST-TEST'
      from academy.convocations c join academy.training_versions tv on tv.id = c.training_version_id where c.id = ${a.convId}`).rejects.toThrow(/motorista não corresponde|código/);
  });

  it("13. Treinamento só conclui após assinatura", async () => {
    const d = await convocated();
    await completeVideos(d.convId);
    await takeExam(d, 10);
    expect((await signingState(d.drv, d.convId))!.conv.status).toBe("aprovado_aguardando_assinatura");
    await expect(raw`update academy.convocations set completed_at = now() where id = ${d.convId}`).rejects.toThrow(/termo não assinado/);
    await sign(d);
    expect((await signingState(d.drv, d.convId))!.conv.status).toBe("concluido");
  });

  it("14. Reconvocação mantém histórico anterior", async () => {
    const d = await convocated();
    await completeVideos(d.convId);
    await takeExam(d, 4);
    await takeExam(d, 10);
    const out = await sign(d);
    const nova = await createConvocation(admin, { driverId: d.id, trainingId, deadline: { mode: "duration", hours: 24, startMode: "activation" } }, ctx());
    expect(nova).toBeTruthy();
    const convs = await raw<{ id: string; completed_at: Date | null }[]>`select id, completed_at from academy.convocations where driver_id = ${d.id} order by created_at`;
    expect(convs.length).toBe(2);
    expect(convs[0].completed_at).not.toBeNull();
    expect(convs[1].completed_at).toBeNull();
    const [{ attempts }] = await raw`select count(*)::int as attempts from academy.exam_attempts where convocation_id = ${d.convId}`;
    expect(attempts).toBe(2);
    const [cert] = await raw`select code from academy.certificates where convocation_id = ${d.convId}`;
    expect(cert.code).toBe(out.certificateCode);
    const home = await driverHome(d.drv);
    expect(home.convocations.length).toBe(2);
    expect(home.convocations.find((c) => c.id === d.convId)!.status).toBe("concluido");
    expect(home.convocations.find((c) => c.id !== d.convId)!.status).not.toBe("concluido");
  });
});
