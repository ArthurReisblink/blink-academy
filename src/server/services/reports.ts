import "server-only";
import ExcelJS from "exceljs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { asAdmin } from "@/lib/db";
import { onlyDigits } from "@/lib/cpf";
import { fmtDateTime, fmtDay } from "@/lib/time";
import type { AdminPrincipal, ReqCtx } from "../context";
import { auditLog } from "../auth/log";
import { cpfLookupHash } from "../auth/driver";
import { STATUS, computeStatus, type StatusKey } from "../domain/status";
import type { ConvocationRow } from "./convocations";

export type ReportFilters = { q?: string; status?: StatusKey | ""; trainingId?: string; baseId?: string; from?: string; to?: string };
export type ReportRow = ConvocationRow & { status: StatusKey; certificate_code: string | null };

const day = (s: string, end = false) => {
  const d = new Date(`${s}T00:00:00-03:00`);
  return end ? new Date(d.getTime() + 86_400_000) : d;
};
const validDay = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
const validId = (s?: string) => !!s && /^[0-9a-f-]{36}$/i.test(s);

/** Convocações (uma linha por convocação) com a situação calculada no servidor. */
export async function reportRows(admin: AdminPrincipal, f: ReportFilters, now = new Date()): Promise<ReportRow[]> {
  const q = (f.q ?? "").trim();
  const digits = onlyDigits(q);
  const rows = await asAdmin(admin, (tx) => tx<(ConvocationRow & { certificate_code: string | null })[]>`
    select o.* from convocation_overview o join drivers d on d.id = o.driver_id
    where d.anonymized_at is null and o.cancelled_at is null
      ${validId(f.trainingId) ? tx`and o.training_id = ${f.trainingId!}` : tx``}
      ${validId(f.baseId) ? tx`and coalesce(o.base_id, d.base_id) = ${f.baseId!}` : tx``}
      ${validDay(f.from) ? tx`and o.created_at >= ${day(f.from!)}` : tx``}
      ${validDay(f.to) ? tx`and o.created_at < ${day(f.to!, true)}` : tx``}
      ${digits.length === 11 ? tx`and d.cpf_hash = ${cpfLookupHash(digits)}`
        : q ? tx`and (o.driver_name ilike ${"%" + q + "%"} or o.pnr_reference ilike ${"%" + q + "%"})` : tx``}
    order by o.created_at desc limit 20000`);
  const out = rows.map((r) => ({ ...r, status: computeStatus(r, now) }));
  return f.status ? out.filter((r) => r.status === f.status) : out;
}

// =====================================================================
// Indicadores do painel
// =====================================================================
export async function dashboard(admin: AdminPrincipal, f: ReportFilters, now = new Date()) {
  const rows = await reportRows(admin, { ...f, status: "" }, now);
  const byStatus = Object.fromEntries(Object.keys(STATUS).map((k) => [k, 0])) as Record<StatusKey, number>;
  for (const r of rows) byStatus[r.status]++;
  const total = rows.length;
  const completed = byStatus.concluido;
  const pending = rows.filter((r) => !["concluido", "expirado", "bloqueado", "cancelado"].includes(r.status));
  const expiring = pending.filter((r) => r.expires_at && r.expires_at.getTime() - now.getTime() < 24 * 3600_000)
    .sort((a, b) => a.expires_at!.getTime() - b.expires_at!.getTime());
  const notStarted = rows.filter((r) => r.status === "aguardando_acesso");
  const ids = rows.map((r) => r.id);
  const stats = await asAdmin(admin, async (tx) => {
    if (!ids.length) return { attempts: 0, passedAttempts: 0, avgScore: null, firstTryPass: 0, withExam: 0, hardest: [], daily: [], videoPct: null };
    const [a] = await tx<{ attempts: number; passed: number; avg: string | null }[]>`
      select count(*)::int as attempts, count(*) filter (where passed)::int as passed, round(avg(score_pct), 1) as avg
      from exam_attempts where submitted_at is not null and convocation_id = any(${ids})`;
    const [ft] = await tx<{ first: number; total: number }[]>`
      select count(*) filter (where attempt_number = 1 and passed)::int as first, count(distinct convocation_id)::int as total
      from exam_attempts where submitted_at is not null and convocation_id = any(${ids})`;
    const hardest = await tx<{ statement: string; topic: string; answered: number; error_rate: string }[]>`
      with ans as (
        select (q->>'id') as qid, q->>'statement' as statement, q->>'topic' as topic,
          coalesce(a.answers->>(q->>'id'), '') = a.answer_key->(q->>'id')->>'correct' as ok
        from exam_attempts a, jsonb_array_elements(a.questions) q
        where a.submitted_at is not null and a.convocation_id = any(${ids}))
      select max(statement) as statement, max(topic) as topic, count(*)::int as answered,
        round(100.0 * count(*) filter (where not ok) / count(*), 1) as error_rate
      from ans group by qid having count(*) >= 1 order by error_rate desc, answered desc limit 5`;
    const daily = await tx<{ d: string; completed: number; exams: number }[]>`
      with days as (select generate_series((now() at time zone 'America/Sao_Paulo')::date - 29, (now() at time zone 'America/Sao_Paulo')::date, '1 day')::date as d)
      select to_char(days.d, 'YYYY-MM-DD') as d,
        (select count(*)::int from convocations c where c.id = any(${ids}) and (c.completed_at at time zone 'America/Sao_Paulo')::date = days.d) as completed,
        (select count(*)::int from exam_attempts a where a.convocation_id = any(${ids}) and a.submitted_at is not null and (a.submitted_at at time zone 'America/Sao_Paulo')::date = days.d) as exams
      from days order by days.d`;
    const [vp] = await tx<{ pct: string | null }[]>`
      select round(100.0 * count(*) filter (where p.completed_at is not null) / nullif(count(*), 0), 1) as pct
      from convocations c join version_videos vv on vv.version_id = c.training_version_id and vv.required
      left join video_progress p on p.convocation_id = c.id and p.video_id = vv.video_id where c.id = any(${ids})`;
    return { attempts: a.attempts, passedAttempts: a.passed, avgScore: a.avg === null ? null : Number(a.avg), firstTryPass: ft.first, withExam: ft.total,
      hardest: hardest.map((h) => ({ ...h, error_rate: Number(h.error_rate) })).filter((h) => h.error_rate > 0), daily: daily.map((d) => ({ day: d.d, completed: d.completed, exams: d.exams })),
      videoPct: vp.pct === null ? null : Number(vp.pct) };
  });
  return {
    total, completed, byStatus, completionRate: total ? Math.round((1000 * completed) / total) / 10 : 0,
    pending: pending.length, expiring: expiring.slice(0, 10), expiringCount: expiring.length, notStarted: notStarted.length,
    expired: byStatus.expirado, failed: byStatus.reprovado, awaitingSignature: byStatus.aprovado_aguardando_assinatura,
    ...stats,
  };
}

// =====================================================================
// Exportações (CSV, Excel e PDF)
// =====================================================================
const COLUMNS: { key: string; label: string; get: (r: ReportRow) => string | number }[] = [
  { key: "nome", label: "Motorista", get: (r) => r.driver_name },
  { key: "cpf", label: "CPF (mascarado)", get: (r) => r.cpf_mask },
  { key: "base", label: "Base", get: (r) => r.base_name ?? "" },
  { key: "pnr", label: "Ocorrência PNR", get: (r) => r.pnr_reference ?? "" },
  { key: "treinamento", label: "Treinamento", get: (r) => `${r.training_title} (v${r.training_version})` },
  { key: "situacao", label: "Situação", get: (r) => STATUS[r.status].label },
  { key: "convocado", label: "Convocado em", get: (r) => fmtDateTime(r.created_at) },
  { key: "acesso", label: "Primeiro acesso", get: (r) => fmtDateTime(r.first_access_at) },
  { key: "prazo", label: "Prazo", get: (r) => (r.expires_at ? fmtDateTime(r.expires_at) : "a partir do 1º acesso") },
  { key: "videos", label: "Vídeos obrigatórios", get: (r) => `${r.completed_required_videos}/${r.required_videos}` },
  { key: "tentativas", label: "Tentativas", get: (r) => (r.max_attempts ? `${r.attempts_used}/${r.max_attempts}` : "") },
  { key: "nota", label: "Melhor nota (%)", get: (r) => (r.best_score === null ? "" : Number(r.best_score)) },
  { key: "assinatura", label: "Termo assinado em", get: (r) => (r.signed_at ? fmtDateTime(r.signed_at) : "") },
  { key: "conclusao", label: "Concluído em", get: (r) => (r.completed_at ? fmtDateTime(r.completed_at) : "") },
  { key: "comprovante", label: "Código do comprovante", get: (r) => r.certificate_code ?? "" },
];

function csvCell(v: string | number) {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // evita execução de fórmulas ao abrir no Excel
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export type ExportFormat = "csv" | "xlsx" | "pdf";

export async function exportReport(admin: AdminPrincipal, format: ExportFormat, f: ReportFilters, ctx: ReqCtx, now = new Date()) {
  const rows = await reportRows(admin, f, now);
  const stamp = now.toISOString().slice(0, 10);
  await asAdmin(admin, (tx) => auditLog(tx, admin.id, "report.export", "report", null, { format, filters: f, rows: rows.length }, ctx.ip));
  if (format === "csv") {
    const lines = [COLUMNS.map((c) => csvCell(c.label)).join(";"), ...rows.map((r) => COLUMNS.map((c) => csvCell(c.get(r))).join(";"))];
    return { body: Buffer.from("﻿" + lines.join("\r\n"), "utf8"), type: "text/csv; charset=utf-8", name: `blink-academy-relatorio-${stamp}.csv` };
  }
  if (format === "xlsx") {
    const wb = new ExcelJS.Workbook();
    wb.creator = "BLINK Academy"; wb.created = now;
    const ws = wb.addWorksheet("Convocações", { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = COLUMNS.map((c) => ({ header: c.label, key: c.key, width: Math.max(14, Math.min(40, c.label.length + 6)) }));
    for (const r of rows) ws.addRow(Object.fromEntries(COLUMNS.map((c) => [c.key, c.get(r)])));
    const head = ws.getRow(1);
    head.font = { bold: true, color: { argb: "FFFFFFFF" } };
    head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF055473" } };
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUMNS.length } };
    const sum = wb.addWorksheet("Resumo");
    sum.columns = [{ header: "Situação", key: "s", width: 36 }, { header: "Quantidade", key: "n", width: 14 }];
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(STATUS[r.status].label, (counts.get(STATUS[r.status].label) ?? 0) + 1);
    for (const [s, n] of counts) sum.addRow({ s, n });
    sum.addRow({ s: "Total", n: rows.length }).font = { bold: true };
    sum.addRow({});
    sum.addRow({ s: `Gerado em ${fmtDateTime(now)} por ${admin.name}` });
    sum.getRow(1).font = { bold: true };
    return { body: Buffer.from(await wb.xlsx.writeBuffer()), type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", name: `blink-academy-relatorio-${stamp}.xlsx` };
  }
  return { body: await reportPdf(rows, admin, now), type: "application/pdf", name: `blink-academy-relatorio-${stamp}.pdf` };
}

async function reportPdf(rows: ReportRow[], admin: AdminPrincipal, now: Date) {
  const doc = await PDFDocument.create();
  doc.setTitle("BLINK Academy — relatório de treinamentos"); doc.setProducer("BLINK Academy");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const cols = [
    { label: "Motorista", w: 150, get: (r: ReportRow) => r.driver_name },
    { label: "CPF", w: 78, get: (r: ReportRow) => r.cpf_mask },
    { label: "Base", w: 110, get: (r: ReportRow) => r.base_name ?? "" },
    { label: "Situação", w: 130, get: (r: ReportRow) => STATUS[r.status].label },
    { label: "Prazo", w: 78, get: (r: ReportRow) => (r.expires_at ? fmtDateTime(r.expires_at) : "1º acesso") },
    { label: "Vídeos", w: 40, get: (r: ReportRow) => `${r.completed_required_videos}/${r.required_videos}` },
    { label: "Nota", w: 36, get: (r: ReportRow) => (r.best_score === null ? "" : `${Number(r.best_score)}%`) },
    { label: "Concluído", w: 78, get: (r: ReportRow) => (r.completed_at ? fmtDay(r.completed_at) : "") },
  ];
  const W = 841.89, H = 595.28, M = 36, RH = 15;
  const fit = (s: string, w: number, f = font, size = 8) => {
    const t = s.replace(/[^\x20-\x7E\u00A0-\u00FF\u2014]/g, "");
    if (f.widthOfTextAtSize(t, size) <= w - 4) return t;
    let n = t.length;
    while (n > 1 && f.widthOfTextAtSize(t.slice(0, n) + "...", size) > w - 4) n--;
    return t.slice(0, n) + "...";
  };
  let page = doc.addPage([W, H]);
  let y = H - M;
  const header = (first: boolean) => {
    if (first) {
      page.drawText("BLINK Academy — Controle de treinamentos POD e PNR", { x: M, y: y - 14, size: 14, font: bold, color: rgb(0.02, 0.33, 0.45) });
      page.drawText(`Gerado em ${fmtDateTime(now)} por ${admin.name} · ${rows.length} convocação(ões)`, { x: M, y: y - 30, size: 9, font, color: rgb(0.38, 0.42, 0.48) });
      y -= 44;
    }
    let x = M;
    page.drawRectangle({ x: M, y: y - RH + 3, width: W - 2 * M, height: RH, color: rgb(0.02, 0.33, 0.45) });
    for (const c of cols) { page.drawText(c.label, { x: x + 3, y: y - 8, size: 8, font: bold, color: rgb(1, 1, 1) }); x += c.w; }
    y -= RH;
  };
  header(true);
  rows.forEach((r, i) => {
    if (y < M + RH) { page = doc.addPage([W, H]); y = H - M; header(false); }
    if (i % 2 === 0) page.drawRectangle({ x: M, y: y - RH + 3, width: W - 2 * M, height: RH, color: rgb(0.96, 0.97, 0.98) });
    let x = M;
    for (const c of cols) { page.drawText(fit(String(c.get(r)), c.w), { x: x + 3, y: y - 8, size: 8, font, color: rgb(0.1, 0.12, 0.16) }); x += c.w; }
    y -= RH;
  });
  if (!rows.length) page.drawText("Nenhuma convocação para os filtros escolhidos.", { x: M, y: y - 14, size: 10, font });
  const pages = doc.getPages();
  pages.forEach((p, i) => p.drawText(`Página ${i + 1} de ${pages.length} · documento interno — contém dados pessoais (LGPD)`, { x: M, y: 18, size: 7, font, color: rgb(0.38, 0.42, 0.48) }));
  return Buffer.from(await doc.save());
}
