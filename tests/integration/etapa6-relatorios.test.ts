import { afterAll, beforeEach, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";
import { closeDb } from "@/lib/db";
import { createDriver } from "@/server/services/drivers";
import { dashboard, exportReport, reportRows } from "@/server/services/reports";
import { listAudit, resetAdminAccess, runRetention, setAdminActive, updateAdminRole, updateSettings } from "@/server/services/admin-tools";
import { createAdminBySuperadmin } from "@/server/auth/admin";
import type { AdminPrincipal } from "@/server/context";
import { adminPrincipal, ctx, publishedTraining, raw, resetData, uniqueCpf } from "../helpers";

afterAll(async () => { await closeDb(); await raw.end(); });

let admin: AdminPrincipal;
let trainingId: string;
let seq = 5000;
beforeEach(async () => {
  await resetData();
  admin = await adminPrincipal();
  trainingId = (await publishedTraining(admin)).trainingId;
});

async function driver(name: string, hours = 72) {
  return createDriver(admin, { fullName: name, cpf: uniqueCpf(), phone: `2797${String(++seq).padStart(7, "0")}` },
    { trainingId, deadline: { mode: "duration", hours, startMode: "activation" } }, ctx());
}

describe("Etapa 6 — dashboard e relatórios", () => {
  it("conta as situações calculadas no servidor e lista quem vence em 24 h", async () => {
    await driver("Ana Pendente");
    const exp = await driver("Bruno Vence Logo", 10);
    const old = await driver("Carla Expirada");
    await raw`update academy.convocations set expires_at = now() - interval '1 hour' where id = ${old.convocationId!}`;
    const d = await dashboard(admin, {});
    expect(d.total).toBe(3);
    expect(d.byStatus.aguardando_acesso).toBe(2);
    expect(d.byStatus.expirado).toBe(1);
    expect(d.expiringCount).toBe(1);
    expect(d.expiring[0].id).toBe(exp.convocationId);
    expect(d.daily.length).toBe(30);
    const onlyExpired = await reportRows(admin, { status: "expirado" });
    expect(onlyExpired.map((r) => r.driver_name)).toEqual(["Carla Expirada"]);
  });

  it("exporta CSV, Excel e PDF; protege contra fórmulas e registra na auditoria", async () => {
    const evil = await driver("Eva Formula");
    await raw`update academy.drivers set full_name = '=HYPERLINK("http://x")' where id = ${evil.id}`;
    await driver("Daniel Normal");
    const csv = await exportReport(admin, "csv", {}, ctx());
    const text = csv.body.toString("utf8");
    expect(text.startsWith("﻿Motorista;CPF (mascarado)")).toBe(true);
    expect(text).toContain("'=HYPERLINK");
    expect(text).toContain("Daniel Normal");
    expect(text).not.toMatch(/\d{3}\.\d{3}\.\d{3}-\d{2}/); // nunca o CPF completo

    const xlsx = await exportReport(admin, "xlsx", {}, ctx());
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx.body as unknown as ArrayBuffer);
    expect(wb.getWorksheet("Convocações")!.rowCount).toBe(3);

    const pdf = await exportReport(admin, "pdf", {}, ctx());
    expect((await PDFDocument.load(pdf.body)).getPageCount()).toBeGreaterThanOrEqual(1);

    const audit = await listAudit(admin, { kind: "admin", q: "report.export" });
    expect(audit.admin.length).toBe(3);
  });
});

describe("Etapa 6 — administradores e configurações", () => {
  it("auditor só lê; apenas superadmin gerencia administradores", async () => {
    const auditor = await adminPrincipal("auditor");
    const normal = await adminPrincipal("admin");
    await expect(updateSettings(auditor, "defaults", { video_completion_pct: 90, pass_pct: 70, max_attempts: 2, question_count: 10 }, ctx())).rejects.toThrow(/somente leitura/);
    await expect(updateSettings(normal, "retention", { auth_log_days: 90, otp_days: 10, sessions_days: 10, video_events_days: 90 }, ctx())).rejects.toThrow(/superadministrador/);
    await expect(createAdminBySuperadmin(normal, { email: "x@blink.test", name: "X", role: "superadmin", password: "SenhaForte#2026" }, ctx())).rejects.toThrow(/superadministrador/);
    await expect(updateAdminRole(normal, auditor.id, "superadmin", ctx())).rejects.toThrow(/superadministrador/);
    // o banco também barra: admin comum não altera a tabela de administradores
    const { asAdmin } = await import("@/lib/db");
    const r = await asAdmin(normal, (tx) => tx`update admins set role = 'superadmin' where id = ${normal.id} returning id`);
    expect(r.length).toBe(0);
  });

  it("não permite ficar sem superadministrador; desativar encerra as sessões", async () => {
    await expect(updateAdminRole(admin, admin.id, "admin", ctx())).rejects.toThrow(/ao menos um superadministrador/);
    await expect(setAdminActive(admin, admin.id, false, ctx())).rejects.toThrow(/a si mesmo/);
    const other = await adminPrincipal("admin");
    await raw`insert into academy.sessions (token_hash, subject_type, subject_id, expires_at) values ('h-' || gen_random_uuid(), 'admin', ${other.id}, now() + interval '1 hour')`;
    await setAdminActive(admin, other.id, false, ctx());
    const [s] = await raw`select count(*)::int as n from academy.sessions where subject_id = ${other.id} and revoked_at is null`;
    expect(s.n).toBe(0);
    await expect(resetAdminAccess(admin, other.id, { password: "fraca" }, ctx())).rejects.toThrow(/12 caracteres/);
    await resetAdminAccess(admin, other.id, { resetTotp: true }, ctx());
  });

  it("retenção apaga registros técnicos antigos e preserva provas do treinamento", async () => {
    await raw`insert into academy.auth_log (at, event, success) values (now() - interval '400 days', 'antigo', true), (now(), 'recente', true)`;
    await raw`insert into academy.otp_challenges (purpose, code_hash, channel, destination_mask, expires_at, created_at) values ('login', 'x', 'sms', '', now() - interval '60 days', now() - interval '60 days')`;
    await raw`insert into academy.rate_limits (key, window_start, count) values ('k', now() - interval '5 days', 1)`;
    const [{ before }] = await raw`select count(*)::int as before from academy.convocation_events`;
    const d = await runRetention();
    expect(d.auth_log).toBe(1);
    expect(d.otp_challenges).toBeGreaterThanOrEqual(1);
    expect(d.rate_limits).toBe(1);
    const [{ n }] = await raw`select count(*)::int as n from academy.auth_log where event = 'recente'`;
    expect(n).toBe(1);
    const [{ after }] = await raw`select count(*)::int as after from academy.convocation_events`;
    expect(after).toBe(before);
    // fora da rotina, os logs continuam imutáveis
    await expect(raw`delete from academy.auth_log`).rejects.toThrow(/protegido/);
  });

  it("rota de retenção exige o segredo do agendador", async () => {
    process.env.CRON_SECRET = "segredo-de-teste-com-32-caracteres!!";
    const { GET } = await import("@/app/api/cron/retencao/route");
    expect((await GET(new Request("http://x/api/cron/retencao"))).status).toBe(401);
    expect((await GET(new Request("http://x/api/cron/retencao", { headers: { authorization: "Bearer errado" } }))).status).toBe(401);
    const ok = await GET(new Request("http://x/api/cron/retencao", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }));
    expect(ok.status).toBe(200);
  });
});
