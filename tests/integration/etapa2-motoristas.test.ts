import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { asAdmin, asAuth, asDriver, closeDb } from "@/lib/db";
import { formatCpf } from "@/lib/cpf";
import { createDriver, getDriverDetail, importDriversCsv, listDrivers, revealCpf, setDriverStatus, updateDriver } from "@/server/services/drivers";
import { cancelConvocation, createConvocation, extendConvocation, setConvocationBlocked } from "@/server/services/convocations";
import { createTraining } from "@/server/services/trainings";
import { driverHome } from "@/server/services/portal";
import { requestDriverLogin, verifyDriverLogin } from "@/server/auth/driver";
import { adminPrincipal, ctx, lastCodeFor, publishedTraining, raw, resetData, uniqueCpf } from "../helpers";
import type { AdminPrincipal } from "@/server/context";

afterAll(async () => { await closeDb(); await raw.end(); });

let admin: AdminPrincipal;
let trainingId: string;
beforeEach(async () => {
  await resetData();
  admin = await adminPrincipal();
  trainingId = (await publishedTraining(admin)).trainingId;
});

const day = { mode: "duration" as const, hours: 24, startMode: "activation" as const };
const newDriver = (over: Record<string, string> = {}) => ({ fullName: "Maria Exemplo da Silva", cpf: uniqueCpf(), phone: "(27) 98888-0000", ...over });

async function loginAs(cpf: string, phone: string) {
  const r = await requestDriverLogin(cpf, ctx());
  const s = await verifyDriverLogin(r.challengeId, await lastCodeFor(phone), ctx());
  return { id: s.driverId, name: "", sessionId: "", otpChallengeId: null };
}

describe("Etapa 2 — cadastro de motoristas", () => {
  it("cadastra motorista com CPF válido e guarda o CPF cifrado", async () => {
    const input = newDriver();
    const r = await createDriver(admin, input, null, ctx());
    const d = await getDriverDetail(admin, r.id);
    expect(d?.driver.full_name).toBe("Maria Exemplo da Silva");
    expect(d?.driver.phone).toBe("+5527988880000");
    expect(d?.driver.cpf_mask).toMatch(/^\*\*\*\./);
    expect(await revealCpf(admin, r.id, ctx())).toBe(formatCpf(input.cpf));
    const [log] = await raw`select action from academy.admin_audit_log where action = 'driver.cpf_reveal'`;
    expect(log).toBeTruthy();
  });

  it("recusa CPF inválido, nome sem sobrenome e cadastro sem telefone e e-mail", async () => {
    await expect(createDriver(admin, newDriver({ cpf: "111.111.111-11" }), null, ctx())).rejects.toThrow(/CPF inválido/);
    await expect(createDriver(admin, newDriver({ fullName: "Maria" }), null, ctx())).rejects.toThrow(/sobrenome/);
    await expect(createDriver(admin, { fullName: "Maria Silva", cpf: uniqueCpf() }, null, ctx())).rejects.toThrow(/telefone ou e-mail/);
  });

  it("não permite dois cadastros com o mesmo CPF (com ou sem pontuação)", async () => {
    const cpf = uniqueCpf();
    await createDriver(admin, newDriver({ cpf }), null, ctx());
    await expect(createDriver(admin, newDriver({ cpf: formatCpf(cpf), fullName: "Outro Nome" }), null, ctx())).rejects.toThrow(/Já existe um motorista/);
    const r = await createDriver(admin, newDriver(), null, ctx());
    await expect(updateDriver(admin, r.id, newDriver({ cpf }), ctx())).rejects.toThrow(/outro motorista/);
  });

  it("auditor não cadastra", async () => {
    const aud = await adminPrincipal("auditor");
    await expect(createDriver(aud, newDriver(), null, ctx())).rejects.toThrow(/somente leitura/);
  });

  it("busca por CPF completo, por nome e por base", async () => {
    const cpf = uniqueCpf();
    await createDriver(admin, newDriver({ cpf, fullName: "Carlos Alberto Souza" }), null, ctx());
    await createDriver(admin, newDriver({ fullName: "Ana Paula Lima" }), null, ctx());
    expect((await listDrivers(admin, { q: formatCpf(cpf) })).rows.map((r) => r.full_name)).toEqual(["Carlos Alberto Souza"]);
    expect((await listDrivers(admin, { q: "ana paula" })).rows.map((r) => r.full_name)).toEqual(["Ana Paula Lima"]);
  });
});

describe("Etapa 2 — convocações e prazos", () => {
  it("prazo por duração contado da ativação: 1 dia = 24 h", async () => {
    const t0 = new Date("2026-11-02T10:00:00Z");
    const r = await createDriver(admin, newDriver(), { trainingId, deadline: day }, ctx({ now: t0 }));
    const [c] = await raw<{ expires_at: Date }[]>`select expires_at from academy.convocations where id = ${r.convocationId}`;
    expect(c.expires_at.toISOString()).toBe("2026-11-03T10:00:00.000Z");
  });

  it("prazo que começa no primeiro acesso autenticado", async () => {
    const input = newDriver({ phone: "(27) 98888-1001" });
    const r = await createDriver(admin, input, { trainingId, deadline: { mode: "duration", hours: 48, startMode: "first_access" } }, ctx());
    const [before] = await raw`select expires_at from academy.convocations where id = ${r.convocationId}`;
    expect(before.expires_at).toBeNull();
    const drv = await loginAs(input.cpf, "+5527988881001");
    const home = await driverHome(drv);
    expect(home.convocations[0].first_access_at).toBeTruthy();
    const [after] = await raw<{ first_access_at: Date; expires_at: Date }[]>`select first_access_at, expires_at from academy.convocations where id = ${r.convocationId}`;
    expect(after.expires_at.getTime() - after.first_access_at.getTime()).toBe(48 * 3600_000);
    // segundo acesso não reinicia o prazo
    await driverHome(drv);
    const [again] = await raw<{ expires_at: Date }[]>`select expires_at from academy.convocations where id = ${r.convocationId}`;
    expect(again.expires_at.getTime()).toBe(after.expires_at.getTime());
  });

  it("prazo com data e horário específicos", async () => {
    const until = new Date(Date.now() + 5 * 86400_000);
    const r = await createDriver(admin, newDriver(), { trainingId, deadline: { mode: "until", at: until } }, ctx());
    const [c] = await raw<{ expires_at: Date }[]>`select expires_at from academy.convocations where id = ${r.convocationId}`;
    expect(c.expires_at.getTime()).toBe(until.getTime());
  });

  it("acesso vencido fica bloqueado para novas ações", async () => {
    const input = newDriver({ phone: "(27) 98888-1002" });
    const r = await createDriver(admin, input, { trainingId, deadline: day }, ctx());
    const drv = await loginAs(input.cpf, "+5527988881002");
    await raw`update academy.convocations set deadline_mode = 'until', deadline_at = now() - interval '1 minute' where id = ${r.convocationId}`;
    const home = await driverHome(drv);
    expect(home.convocations[0].status).toBe("expirado");
    const [open] = await asDriver(drv.id, (tx) => tx`select academy.convocation_is_open(${r.convocationId}) as ok`);
    expect(open.ok).toBe(false);
  });

  it("administrador pode prorrogar o prazo vencido sem perder o histórico", async () => {
    const input = newDriver({ phone: "(27) 98888-1003" });
    const r = await createDriver(admin, input, { trainingId, deadline: day }, ctx());
    await raw`update academy.convocations set deadline_mode = 'until', deadline_at = now() - interval '2 hours' where id = ${r.convocationId}`;
    const now = new Date();
    const newExp = await extendConvocation(admin, r.convocationId!, { hours: 24 }, ctx({ now }));
    expect(Math.abs(newExp!.getTime() - (now.getTime() + 24 * 3600_000))).toBeLessThan(2000);
    const drv = await loginAs(input.cpf, "+5527988881003");
    const home = await driverHome(drv);
    expect(home.convocations[0].status).toBe("iniciado");
    const types = (await raw<{ type: string }[]>`select type from academy.convocation_events where convocation_id = ${r.convocationId} order by id`).map((e) => e.type);
    expect(types).toEqual(["created", "extended", "first_access"]);
    await extendConvocation(admin, r.convocationId!, { until: new Date(Date.now() + 10 * 86400_000) }, ctx());
  });

  it("prorrogação antes do primeiro acesso aumenta a duração", async () => {
    const r = await createDriver(admin, newDriver(), { trainingId, deadline: { mode: "duration", hours: 24, startMode: "first_access" } }, ctx());
    await extendConvocation(admin, r.convocationId!, { hours: 48 }, ctx());
    const [c] = await raw`select duration_hours, expires_at from academy.convocations where id = ${r.convocationId}`;
    expect(c.duration_hours).toBe(72);
    expect(c.expires_at).toBeNull();
  });

  it("bloquear impede o acesso; reativar devolve", async () => {
    const input = newDriver({ phone: "(27) 98888-1004" });
    const r = await createDriver(admin, input, { trainingId, deadline: day }, ctx());
    await setConvocationBlocked(admin, r.convocationId!, true, "Teste", ctx());
    await requestDriverLogin(input.cpf, ctx());
    const [{ n }] = await raw`select count(*)::int as n from academy.dev_outbox where destination = '+5527988881004'`;
    expect(n).toBe(0);
    await setConvocationBlocked(admin, r.convocationId!, false, null, ctx());
    const drv = await loginAs(input.cpf, "+5527988881004");
    expect((await driverHome(drv)).convocations[0].status).not.toBe("bloqueado");
  });

  it("bloquear o motorista derruba as sessões abertas", async () => {
    const input = newDriver({ phone: "(27) 98888-1005" });
    const r = await createDriver(admin, input, { trainingId, deadline: day }, ctx());
    await loginAs(input.cpf, "+5527988881005");
    await setDriverStatus(admin, r.id, "blocked", ctx());
    const [{ n }] = await raw`select count(*)::int as n from academy.sessions where subject_id = ${r.id} and revoked_at is null`;
    expect(n).toBe(0);
  });

  it("não convoca para treinamento sem versão publicada", async () => {
    const t = await createTraining(admin, { title: "Rascunho" }, ctx());
    await expect(createDriver(admin, newDriver(), { trainingId: t.trainingId, deadline: day }, ctx())).rejects.toThrow(/versão publicada/);
  });

  it("reconvocação: não duplica convocação em aberto e mantém o histórico das anteriores", async () => {
    const r = await createDriver(admin, newDriver(), { trainingId, deadline: day }, ctx());
    await expect(createConvocation(admin, { driverId: r.id, trainingId, deadline: day }, ctx())).rejects.toThrow(/em aberto/);
    await cancelConvocation(admin, r.convocationId!, "Teste", ctx());
    await createConvocation(admin, { driverId: r.id, trainingId, deadline: day, pnrReference: "PNR-2" }, ctx());
    const d = await getDriverDetail(admin, r.id);
    expect(d?.convocations.map((c) => c.status)).toEqual(["aguardando_acesso", "cancelado"]);
  });
});

describe("Etapa 2 — importação CSV", () => {
  it("importa linhas válidas, informa erros por linha e reconvoca CPF já cadastrado", async () => {
    const existing = uniqueCpf();
    await createDriver(admin, newDriver({ cpf: existing }), null, ctx());
    const a = uniqueCpf();
    const csv = [
      "nome;cpf;telefone;email;base;ocorrencia_pnr",
      `Pedro Henrique Alves;${formatCpf(a)};(27) 97777-0001;;Base 01 - Guarapari;PNR-123`,
      "Sem Cpf Valido;123.456.789-00;27977770002;;;",
      `Joana;${uniqueCpf()};27977770003;;;`,
      `Pedro Repetido;${a};27977770004;;;`,
      `Maria Cadastrada;${existing};;;;PNR-999`,
      `Sem Contato Algum;${uniqueCpf()};;;;`,
    ].join("\n");
    const res = await importDriversCsv(admin, csv, { trainingId, deadline: day }, ctx());
    expect(res.map((r) => r.result)).toEqual(["created", "error", "error", "error", "convocated", "error"]);
    expect(res[1].message).toMatch(/CPF inválido/);
    expect(res[2].message).toMatch(/sobrenome/);
    expect(res[3].message).toMatch(/repetido/);
    expect(res[5].message).toMatch(/telefone ou e-mail/);
    const [b] = await raw`select name from academy.bases`;
    expect(b.name).toBe("Base 01 - Guarapari");
    const [c] = await raw`select pnr_reference from academy.convocations where pnr_reference = 'PNR-123'`;
    expect(c).toBeTruthy();
  });

  it("recusa arquivo sem as colunas obrigatórias", async () => {
    await expect(importDriversCsv(admin, "a;b\n1;2", null, ctx())).rejects.toThrow(/colunas nome e cpf/);
  });
});

describe("Etapa 2 — isolamento entre motoristas", () => {
  it("motorista não consulta convocações de outro CPF", async () => {
    const i1 = newDriver({ phone: "(27) 98888-2001" });
    const i2 = newDriver({ phone: "(27) 98888-2002" });
    const d1 = await createDriver(admin, i1, { trainingId, deadline: day }, ctx());
    const d2 = await createDriver(admin, i2, { trainingId, deadline: day }, ctx());
    const drv1 = await loginAs(i1.cpf, "+5527988882001");
    const mine = await asDriver(drv1.id, (tx) => tx`select id from convocations`);
    expect(mine.map((r) => r.id)).toEqual([d1.convocationId]);
    const other = await asDriver(drv1.id, (tx) => tx`select id from convocation_overview where driver_id = ${d2.id}`);
    expect(other).toHaveLength(0);
    await expect(asDriver(drv1.id, (tx) => tx`update convocations set expires_at = now() + interval '30 days' where id = ${d1.convocationId}`)).rejects.toThrow(/permission denied/);
    // papel de autenticação também não altera convocações
    await expect(asAuth((tx) => tx`update convocations set blocked_at = null`)).rejects.toThrow(/permission denied/);
    void asAdmin;
  });
});
