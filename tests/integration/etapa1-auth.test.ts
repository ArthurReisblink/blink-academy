import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { asAdmin, asAuth, asDriver, closeDb } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { adminPasswordLogin, adminTotpSetup, adminTotpVerify, createAdminRecord, getAdminByToken } from "@/server/auth/admin";
import { getDriverByToken, requestDriverLogin, verifyDriverLogin } from "@/server/auth/driver";
import { ctx, insertDriver, lastCodeFor, raw, resetData, totpNow, uniqueCpf } from "../helpers";

afterAll(async () => { await closeDb(); await raw.end(); });
beforeEach(async () => { await resetData(); });

async function newAdmin(role: "superadmin" | "admin" | "auditor" = "superadmin", email = `adm${Math.random().toString(36).slice(2, 8)}@blink.test`) {
  const password = "SenhaForte#2026";
  const id = await asAuth(async (tx) => { await tx.unsafe("reset role"); return createAdminRecord(tx, { email, name: "Admin Teste", role, password }); });
  return { id, email, password };
}

async function fullAdminLogin(email: string, password: string, at = new Date()) {
  const step1 = await adminPasswordLogin(email, password, ctx({ now: at }));
  const setup = await adminTotpSetup(step1.mfaToken, ctx({ now: at }));
  const s = await adminTotpVerify(step1.mfaToken, totpNow(setup.secret, at), ctx({ now: at }));
  return { ...s, secret: setup.secret };
}

describe("Etapa 1 — login do motorista (CPF + código)", () => {
  it("CPF inexistente não acessa: mesma resposta, nenhum código enviado e nenhum código aceito", async () => {
    const cpf = uniqueCpf();
    const r = await requestDriverLogin(cpf, ctx());
    expect(r.message).toMatch(/Se o CPF estiver cadastrado/);
    const [{ n }] = await raw`select count(*)::int as n from academy.dev_outbox`;
    expect(n).toBe(0);
    for (const code of ["000000", "123456", "999999"]) {
      await expect(verifyDriverLogin(r.challengeId, code, ctx())).rejects.toThrow(/Código/);
    }
  });

  it("CPF com formato ou dígito inválido é recusado", async () => {
    await expect(requestDriverLogin("123.456.789-00", ctx())).rejects.toThrow(/CPF inválido/);
  });

  it("CPF cadastrado sem código válido não acessa", async () => {
    const d = await insertDriver({ phone: "+5527911110001" });
    const r = await requestDriverLogin(d.cpf, ctx());
    await expect(verifyDriverLogin(r.challengeId, "000000", ctx())).rejects.toThrow(/incorreto/);
    // o CPF sozinho não abre sessão: nenhuma sessão criada
    const [{ n }] = await raw`select count(*)::int as n from academy.sessions where subject_type = 'driver'`;
    expect(n).toBe(0);
  });

  it("código correto abre a sessão; o mesmo código não pode ser reutilizado", async () => {
    const d = await insertDriver({ phone: "+5527911110002" });
    const r = await requestDriverLogin(d.cpf, ctx());
    const code = await lastCodeFor("+5527911110002");
    const s = await verifyDriverLogin(r.challengeId, code, ctx());
    const me = await getDriverByToken(s.token);
    expect(me?.id).toBe(d.id);
    await expect(verifyDriverLogin(r.challengeId, code, ctx())).rejects.toThrow(/expirado/);
  });

  it("código bloqueia após 5 tentativas erradas, mesmo que depois seja digitado o certo", async () => {
    const d = await insertDriver({ phone: "+5527911110003" });
    const r = await requestDriverLogin(d.cpf, ctx());
    const code = await lastCodeFor("+5527911110003");
    for (let i = 0; i < 5; i++) await expect(verifyDriverLogin(r.challengeId, "111111", ctx())).rejects.toThrow();
    await expect(verifyDriverLogin(r.challengeId, code, ctx())).rejects.toThrow(/expirado/);
  });

  it("código expira em 10 minutos", async () => {
    const d = await insertDriver({ phone: "+5527911110004" });
    const t0 = new Date();
    const r = await requestDriverLogin(d.cpf, ctx({ now: t0 }));
    const code = await lastCodeFor("+5527911110004");
    await expect(verifyDriverLogin(r.challengeId, code, ctx({ now: new Date(t0.getTime() + 11 * 60000) }))).rejects.toThrow(/expirado/);
  });

  it("motorista bloqueado não recebe código", async () => {
    const d = await insertDriver({ phone: "+5527911110005", status: "blocked" });
    await requestDriverLogin(d.cpf, ctx());
    const [{ n }] = await raw`select count(*)::int as n from academy.dev_outbox where destination = '+5527911110005'`;
    expect(n).toBe(0);
  });

  it("limita pedidos de código por CPF (proteção contra tentativas excessivas)", async () => {
    const d = await insertDriver({ phone: "+5527911110006" });
    for (let i = 0; i < 5; i++) await requestDriverLogin(d.cpf, ctx());
    await expect(requestDriverLogin(d.cpf, ctx())).rejects.toThrow(/Muitas tentativas/);
  });

  it("sessão do motorista expira e sessão revogada deixa de valer", async () => {
    const d = await insertDriver({ phone: "+5527911110007" });
    const r = await requestDriverLogin(d.cpf, ctx());
    const s = await verifyDriverLogin(r.challengeId, await lastCodeFor("+5527911110007"), ctx());
    expect(await getDriverByToken(s.token, new Date(Date.now() + 13 * 3600_000))).toBeNull();
    await raw`update academy.sessions set revoked_at = now()`;
    expect(await getDriverByToken(s.token)).toBeNull();
  });
});

describe("Etapa 1 — login administrativo (senha + autenticador)", () => {
  it("senha errada não entra; senha certa exige o segundo fator", async () => {
    const a = await newAdmin();
    await expect(adminPasswordLogin(a.email, "errada", ctx())).rejects.toThrow(/inválidos/);
    const step1 = await adminPasswordLogin(a.email, a.password, ctx());
    expect(step1.needsSetup).toBe(true);
    // o token do 1º fator não é uma sessão administrativa
    expect(await getAdminByToken(step1.mfaToken)).toBeNull();
  });

  it("cadastra o autenticador, entra com o código e não aceita o mesmo código duas vezes", async () => {
    const a = await newAdmin();
    const now = new Date();
    const s = await fullAdminLogin(a.email, a.password, now);
    const me = await getAdminByToken(s.token);
    expect(me?.email).toBe(a.email);
    const step1 = await adminPasswordLogin(a.email, a.password, ctx({ now }));
    expect(step1.needsSetup).toBe(false);
    await expect(adminTotpVerify(step1.mfaToken, totpNow(s.secret, now), ctx({ now }))).rejects.toThrow(/Código inválido/);
    const later = new Date(now.getTime() + 60_000);
    const step2 = await adminPasswordLogin(a.email, a.password, ctx({ now: later }));
    const ok = await adminTotpVerify(step2.mfaToken, totpNow(s.secret, later), ctx({ now: later }));
    expect(await getAdminByToken(ok.token, later)).not.toBeNull();
  });

  it("segredo do autenticador fica criptografado no banco", async () => {
    const a = await newAdmin();
    const s = await fullAdminLogin(a.email, a.password);
    const [row] = await raw<{ totp_secret_enc: string }[]>`select totp_secret_enc from academy.admins where id = ${a.id}`;
    expect(row.totp_secret_enc).not.toContain(s.secret);
    expect(decrypt(row.totp_secret_enc)).toBe(s.secret);
  });

  it("bloqueia a conta após 8 senhas erradas", async () => {
    const a = await newAdmin();
    for (let i = 0; i < 8; i++) await expect(adminPasswordLogin(a.email, "errada" + i, ctx())).rejects.toThrow();
    await expect(adminPasswordLogin(a.email, a.password, ctx())).rejects.toThrow(/bloqueado/);
  });

  it("e-mail inexistente recebe a mesma mensagem de erro", async () => {
    await expect(adminPasswordLogin("ninguem@blink.test", "SenhaForte#2026", ctx())).rejects.toThrow(/E-mail, senha ou código inválidos/);
  });
});

describe("Etapa 1 — banco de dados (RLS e trilhas)", () => {
  it("o papel do motorista só enxerga a própria linha e não lê CPF criptografado", async () => {
    const a = await insertDriver({ phone: "+5527911110010", name: "A" });
    const b = await insertDriver({ phone: "+5527911110011", name: "B" });
    const rows = await asDriver(a.id, (tx) => tx`select id from drivers`);
    expect(rows.map((r) => r.id)).toEqual([a.id]);
    const other = await asDriver(a.id, (tx) => tx`select id from drivers where id = ${b.id}`);
    expect(other).toHaveLength(0);
    await expect(asDriver(a.id, (tx) => tx`select cpf_enc from drivers`)).rejects.toThrow(/permission denied/);
  });

  it("o papel de autenticação não lê o CPF criptografado", async () => {
    await insertDriver({ phone: "+5527911110012" });
    await expect(asAuth((tx) => tx`select cpf_enc from drivers`)).rejects.toThrow(/permission denied/);
  });

  it("perfil auditor é somente leitura no banco", async () => {
    const aud = await newAdmin("auditor");
    const d = await insertDriver({ phone: "+5527911110013" });
    const rows = await asAdmin({ id: aud.id, role: "auditor" }, (tx) => tx`select id from drivers`);
    expect(rows).toHaveLength(1);
    const upd = await asAdmin({ id: aud.id, role: "auditor" }, (tx) => tx`update drivers set full_name = 'X' where id = ${d.id} returning id`);
    expect(upd).toHaveLength(0);
  });

  it("logs de autenticação e auditoria não podem ser alterados nem apagados", async () => {
    const adm = await newAdmin();
    await asAdmin({ id: adm.id, role: "superadmin" }, (tx) =>
      tx`insert into admin_audit_log (admin_id, action, entity) values (${adm.id}, 'teste', 'x')`);
    await expect(raw`update academy.admin_audit_log set action = 'alterado'`).rejects.toThrow(/protegido/);
    await expect(raw`delete from academy.admin_audit_log`).rejects.toThrow(/protegido/);
    await adminPasswordLogin(adm.email, "errada", ctx()).catch(() => {});
    await expect(raw`delete from academy.auth_log`).rejects.toThrow(/protegido/);
  });

  it("administrador não pode registrar auditoria em nome de outro", async () => {
    const a1 = await newAdmin();
    const a2 = await newAdmin();
    await expect(asAdmin({ id: a1.id, role: "superadmin" }, (tx) =>
      tx`insert into admin_audit_log (admin_id, action, entity) values (${a2.id}, 'falso', 'x')`)).rejects.toThrow(/row-level security/);
  });

  it("CPF fica guardado apenas como hash + texto cifrado", async () => {
    const d = await insertDriver({ phone: "+5527911110014" });
    const [row] = await raw<{ cpf_hash: string; cpf_enc: string; cpf_mask: string }[]>`select cpf_hash, cpf_enc, cpf_mask from academy.drivers where id = ${d.id}`;
    expect(JSON.stringify(row)).not.toContain(d.cpf);
    expect(row.cpf_mask).toMatch(/^\*\*\*\.\d{3}\.\d{3}-\*\*$/);
  });
});
