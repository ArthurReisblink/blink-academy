import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { asDriver, closeDb } from "@/lib/db";
import { createDriver } from "@/server/services/drivers";
import { createDraftVersion, createTraining, publishVersion } from "@/server/services/trainings";
import { addVideoToVersion, finishVideoUpload, recordHeartbeat, setVideoRules, startVideoUpload, videoPlayback } from "@/server/services/videos";
import { driverHome } from "@/server/services/portal";
import { localWrite, verifyLocal } from "@/server/storage";
import { requestDriverLogin, verifyDriverLogin } from "@/server/auth/driver";
import type { AdminPrincipal, DriverPrincipal } from "@/server/context";
import { adminPrincipal, ctx, lastCodeFor, publishedTraining, raw, readyVideo, resetData, uniqueCpf } from "../helpers";

afterAll(async () => { await closeDb(); await raw.end(); });

let admin: AdminPrincipal;
let trainingId: string;
let phoneSeq = 3000;
beforeEach(async () => {
  await resetData();
  admin = await adminPrincipal();
  trainingId = (await publishedTraining(admin)).trainingId;
});

async function convocatedDriver(hours = 72): Promise<{ drv: DriverPrincipal; convId: string; driverId: string }> {
  const phone = `(27) 9666${String(++phoneSeq).padStart(5, "0")}`.replace(/(\d{4})(\d{4})$/, "$1-$2");
  const cpf = uniqueCpf();
  const r = await createDriver(admin, { fullName: "Motorista Vídeo Teste", cpf, phone }, { trainingId, deadline: { mode: "duration", hours, startMode: "activation" } }, ctx());
  const ch = await requestDriverLogin(cpf, ctx());
  const s = await verifyDriverLogin(ch.challengeId, await lastCodeFor(`+55${phone.replace(/\D/g, "")}`), ctx());
  return { drv: { id: s.driverId, name: "", sessionId: "", otpChallengeId: null }, convId: r.convocationId!, driverId: r.id };
}

async function videosOf(drv: DriverPrincipal, convId: string) {
  return asDriver(drv.id, (tx) => tx<{ video_id: string; duration_seconds: string }[]>`
    select vv.video_id, v.duration_seconds from convocations c join version_videos vv on vv.version_id = c.training_version_id
    join videos v on v.id = vv.video_id where c.id = ${convId} order by vv.position`);
}

/** Simula o player enviando o progresso a cada 10 s, em tempo real. */
async function watch(drv: DriverPrincipal, convId: string, videoId: string, fromSec: number, toSec: number, t0 = new Date()) {
  let last: Awaited<ReturnType<typeof recordHeartbeat>> | null = null;
  const segs: [number, number][] = [];
  for (let s = fromSec; s < toSec; s += 10) {
    const e = Math.min(s + 10, toSec);
    segs.push([fromSec, e]);
    last = await recordHeartbeat(drv, { convocationId: convId, videoId, event: "heartbeat", position: e, segments: [[fromSec, e]] }, new Date(t0.getTime() + (e - fromSec) * 1000));
  }
  return last!;
}

describe("Etapa 3 — biblioteca e versões", () => {
  it("envio em duas etapas: registra, recebe o arquivo e só então libera o vídeo", async () => {
    const r = await startVideoUpload(admin, { title: "Prova de entrega", contentType: "video/mp4", size: 23, duration: 95.5 }, ctx());
    expect(r.upload.method).toBe("PUT");
    await expect(finishVideoUpload(admin, r.videoId, ctx())).rejects.toThrow(/ainda não chegou/);
    const [v] = await raw<{ storage_key: string }[]>`select storage_key from academy.videos where id = ${r.videoId}`;
    await localWrite(v.storage_key, Buffer.from("conteudo-de-video-falso"));
    await finishVideoUpload(admin, r.videoId, ctx());
    const [ok] = await raw`select status from academy.videos where id = ${r.videoId}`;
    expect(ok.status).toBe("ready");
  });

  it("recusa arquivo que não é MP4", async () => {
    await expect(startVideoUpload(admin, { title: "Vídeo", contentType: "video/avi", size: 10, duration: 10 }, ctx())).rejects.toThrow(/MP4/);
  });

  it("não publica versão sem vídeo obrigatório", async () => {
    const t = await createTraining(admin, { title: "Sem vídeo" }, ctx());
    await expect(publishVersion(admin, t.versionId, ctx())).rejects.toThrow(/vídeo obrigatório/);
  });

  it("versão publicada fica congelada; nova versão copia os vídeos e não muda convocações antigas", async () => {
    const { convId } = await convocatedDriver();
    const [v1] = await raw<{ id: string }[]>`select training_version_id as id from academy.convocations where id = ${convId}`;
    await expect(addVideoToVersion(admin, v1.id, await readyVideo(), ctx())).rejects.toThrow(/não podem ser alteradas/);
    await expect(raw`delete from academy.version_videos where version_id = ${v1.id}`).rejects.toThrow(/rascunho/);
    const v2 = await createDraftVersion(admin, trainingId, ctx());
    await addVideoToVersion(admin, v2, await readyVideo("Vídeo 3 — novo"), ctx());
    await publishVersion(admin, v2, ctx());
    const [{ n1 }] = await raw`select count(*)::int as n1 from academy.version_videos where version_id = ${v1.id}`;
    const [{ n2 }] = await raw`select count(*)::int as n2 from academy.version_videos where version_id = ${v2}`;
    expect([n1, n2]).toEqual([2, 3]);
    const [still] = await raw`select training_version_id from academy.convocations where id = ${convId}`;
    expect(still.training_version_id).toBe(v1.id);
  });
});

describe("Etapa 3 — reprodução e progresso", () => {
  it("entrega URL assinada e temporária; outro motorista não acessa o vídeo", async () => {
    const a = await convocatedDriver();
    const b = await convocatedDriver();
    const [v] = await videosOf(a.drv, a.convId);
    const p = await videoPlayback(a.drv, a.convId, v.video_id);
    expect(p?.url).toMatch(/^\/api\/storage\/file\?/);
    expect(verifyLocal("get", new URL("http://x" + p!.url).searchParams)).toBeTruthy();
    const tampered = new URL("http://x" + p!.url).searchParams; tampered.set("k", "videos/outro.mp4");
    expect(verifyLocal("get", tampered)).toBeNull();
    expect(await videoPlayback(b.drv, a.convId, v.video_id)).toBeNull();
  });

  it("conclui o vídeo ao atingir 95% de reprodução efetiva e muda a situação", async () => {
    const { drv, convId } = await convocatedDriver();
    const [v1, v2] = await videosOf(drv, convId);
    const r = await watch(drv, convId, v1.video_id, 0, 110);
    expect(r.pct).toBeCloseTo(91.67, 1);
    expect(r.completed).toBe(false);
    expect((await driverHome(drv)).convocations[0].status).toBe("assistindo");
    const r2 = await watch(drv, convId, v1.video_id, 110, 115, new Date(Date.now() + 200_000));
    expect(r2.completed).toBe(true);
    await watch(drv, convId, v2.video_id, 0, 60, new Date(Date.now() + 400_000));
    const home = await driverHome(drv);
    expect(home.convocations[0].completed_required_videos).toBe(2);
    expect(["videos_concluidos", "prova_disponivel"]).toContain(home.convocations[0].status);
    const [{ n }] = await raw`select count(*)::int as n from academy.convocation_events where convocation_id = ${convId} and type = 'video_completed'`;
    expect(n).toBe(2);
  });

  it("clicar em play ou enviar 100% de uma vez não conclui o vídeo", async () => {
    const { drv, convId } = await convocatedDriver();
    const [v1] = await videosOf(drv, convId);
    await recordHeartbeat(drv, { convocationId: convId, videoId: v1.video_id, event: "play", position: 0, segments: [] });
    const r = await recordHeartbeat(drv, { convocationId: convId, videoId: v1.video_id, event: "ended", position: 120, segments: [[0, 120]] }, new Date(Date.now() + 1000));
    expect(r.completed).toBe(false);
    expect(r.covered).toBeLessThan(25);
  });

  it("assistir o mesmo trecho repetidamente não completa o percentual", async () => {
    const { drv, convId } = await convocatedDriver();
    const [v1] = await videosOf(drv, convId);
    let t = Date.now();
    let r;
    for (let i = 0; i < 20; i++) { t += 10_000; r = await recordHeartbeat(drv, { convocationId: convId, videoId: v1.video_id, event: "heartbeat", position: 10, segments: [[0, 10]] }, new Date(t)); }
    expect(r!.covered).toBe(10);
    expect(r!.completed).toBe(false);
  });

  it("o administrador pode exigir 100% de reprodução", async () => {
    const t = await createTraining(admin, { title: "Exige 100%" }, ctx());
    const vid = await readyVideo("Curto", 30);
    await addVideoToVersion(admin, t.versionId, vid, ctx());
    await setVideoRules(admin, t.versionId, vid, { required: true, completionPct: 100 }, ctx());
    await expect(setVideoRules(admin, t.versionId, vid, { required: true, completionPct: 20 }, ctx())).rejects.toThrow(/50%/);
    const [r] = await raw`select completion_pct from academy.version_videos where video_id = ${vid}`;
    expect(Number(r.completion_pct)).toBe(100);
  });

  it("prazo vencido: não entrega o vídeo e o banco recusa gravar progresso", async () => {
    const { drv, convId } = await convocatedDriver();
    const [v1] = await videosOf(drv, convId);
    await watch(drv, convId, v1.video_id, 0, 20);
    await raw`update academy.convocations set deadline_mode = 'until', deadline_at = now() - interval '1 minute' where id = ${convId}`;
    await expect(videoPlayback(drv, convId, v1.video_id)).rejects.toThrow(/prazo/);
    await expect(recordHeartbeat(drv, { convocationId: convId, videoId: v1.video_id, event: "heartbeat", position: 30, segments: [[20, 30]] })).rejects.toThrow(/prazo/);
    // mesmo burlando o serviço, a política do banco bloqueia
    await expect(asDriver(drv.id, (tx) => tx`update video_progress set covered_seconds = 120 where convocation_id = ${convId}`)).resolves.toHaveLength(0);
    const [p] = await raw`select covered_seconds from academy.video_progress where convocation_id = ${convId}`;
    expect(Number(p.covered_seconds)).toBe(20);
  });

  it("motorista não grava progresso na convocação de outro", async () => {
    const a = await convocatedDriver();
    const b = await convocatedDriver();
    const [v] = await videosOf(b.drv, b.convId);
    await expect(recordHeartbeat(a.drv, { convocationId: b.convId, videoId: v.video_id, event: "heartbeat", position: 5, segments: [[0, 5]] })).rejects.toThrow(/não encontrado/);
    await expect(asDriver(a.drv.id, (tx) => tx`insert into video_progress (convocation_id, video_id, duration_seconds, completion_pct, covered_seconds)
      values (${b.convId}, ${v.video_id}, 120, 95, 120)`)).rejects.toThrow(/row-level security/);
  });
});
