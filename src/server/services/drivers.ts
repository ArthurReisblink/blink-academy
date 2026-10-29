import "server-only";
import Papa from "papaparse";
import { z } from "zod";
import { asAdmin, asAuth, type Tx } from "@/lib/db";
import { decrypt, encrypt, hmacHex, randomToken } from "@/lib/crypto";
import { formatCpf, isValidCpf, maskCpf, onlyDigits } from "@/lib/cpf";
import { normalizeEmail, normalizePhone } from "@/lib/contact";
import { AppError } from "@/lib/errors";
import type { AdminPrincipal, ReqCtx } from "../context";
import { assertCanWrite, assertSuperadmin } from "../auth/admin";
import { auditLog } from "../auth/log";
import { computeStatus, type StatusKey } from "../domain/status";
import type { DeadlineInput } from "../domain/deadline";
import { resolveBaseByName } from "./bases";
import { convocationEvents, convocationsOfDriver, insertConvocation, type ConvocationRow } from "./convocations";
import { optText, parse } from "./common";

const cpfHash = (cpf: string) => hmacHex(onlyDigits(cpf), "cpf");

const driverSchema = z.object({
  fullName: z.string().trim().min(5, "Informe o nome completo.").max(150)
    .refine((v) => v.split(/\s+/).length >= 2, "Informe nome e sobrenome."),
  cpf: z.string().refine(isValidCpf, "CPF inválido: confira os dígitos verificadores."),
  phone: z.string().optional().transform((v, ctx) => {
    if (!v || !v.trim()) return null;
    const p = normalizePhone(v);
    if (!p) { ctx.addIssue({ code: "custom", message: "Telefone inválido. Use DDD + número." }); return z.NEVER; }
    return p;
  }),
  email: z.string().optional().transform((v, ctx) => {
    if (!v || !v.trim()) return null;
    const e = normalizeEmail(v);
    if (!e) { ctx.addIssue({ code: "custom", message: "E-mail inválido." }); return z.NEVER; }
    return e;
  }),
  baseId: z.string().uuid().optional().or(z.literal("")).transform((v) => v || null),
  notes: optText(1000),
}).refine((d) => d.phone || d.email, { message: "Cadastre ao menos um telefone ou e-mail para envio do código de acesso." });

export type DriverInput = z.input<typeof driverSchema>;

async function insertDriverRow(tx: Tx, admin: AdminPrincipal, d: z.output<typeof driverSchema>) {
  const cpf = onlyDigits(d.cpf);
  const [dup] = await tx<{ id: string }[]>`select id from drivers where cpf_hash = ${cpfHash(cpf)}`;
  if (dup) throw new AppError("duplicate_cpf", "Já existe um motorista cadastrado com este CPF.", 409);
  const [row] = await tx<{ id: string }[]>`
    insert into drivers (full_name, cpf_hash, cpf_enc, cpf_mask, phone, email, base_id, notes, created_by)
    values (${d.fullName}, ${cpfHash(cpf)}, ${encrypt(cpf)}, ${maskCpf(cpf)}, ${d.phone}, ${d.email}, ${d.baseId}, ${d.notes}, ${admin.id})
    returning id`;
  return row.id;
}

/** Cadastro pelo painel. Opcionalmente já cria a convocação. */
export async function createDriver(admin: AdminPrincipal, input: DriverInput,
  conv: { trainingId: string; pnrReference?: string | null; deadline: DeadlineInput } | null, ctx: ReqCtx) {
  assertCanWrite(admin);
  const d = parse(driverSchema, input);
  const now = ctx.now ?? new Date();
  return asAdmin(admin, async (tx) => {
    const id = await insertDriverRow(tx, admin, d);
    await auditLog(tx, admin.id, "driver.create", "driver", id, { name: d.fullName, cpf: maskCpf(d.cpf), base_id: d.baseId }, ctx.ip);
    let convocationId: string | null = null;
    if (conv) {
      const c = await insertConvocation(tx, admin, { driverId: id, trainingId: conv.trainingId, baseId: d.baseId, pnrReference: conv.pnrReference, deadline: conv.deadline }, now);
      convocationId = c.id;
      await auditLog(tx, admin.id, "convocation.create", "convocation", c.id, { driver_id: id, training_id: conv.trainingId, pnr: conv.pnrReference }, ctx.ip);
    }
    return { id, convocationId };
  });
}

export async function updateDriver(admin: AdminPrincipal, id: string, input: DriverInput, ctx: ReqCtx) {
  assertCanWrite(admin);
  const d = parse(driverSchema, input);
  await asAdmin(admin, async (tx) => {
    const [cur] = await tx<{ cpf_hash: string; full_name: string; phone: string | null; email: string | null; anonymized_at: Date | null }[]>`
      select cpf_hash, full_name, phone, email, anonymized_at from drivers where id = ${id} for update`;
    if (!cur) throw new AppError("not_found", "Motorista não encontrado.", 404);
    if (cur.anonymized_at) throw new AppError("invalid", "Cadastro anonimizado não pode ser editado.");
    const cpf = onlyDigits(d.cpf);
    const changedCpf = cur.cpf_hash !== cpfHash(cpf);
    if (changedCpf) {
      const [dup] = await tx`select 1 from drivers where cpf_hash = ${cpfHash(cpf)} and id <> ${id}`;
      if (dup) throw new AppError("duplicate_cpf", "Já existe outro motorista com este CPF.", 409);
    }
    await tx`update drivers set full_name = ${d.fullName}, phone = ${d.phone}, email = ${d.email}, base_id = ${d.baseId}, notes = ${d.notes}
      ${changedCpf ? tx`, cpf_hash = ${cpfHash(cpf)}, cpf_enc = ${encrypt(cpf)}, cpf_mask = ${maskCpf(cpf)}` : tx``}
      where id = ${id}`;
    await auditLog(tx, admin.id, "driver.update", "driver", id, {
      changed: { name: cur.full_name !== d.fullName, phone: cur.phone !== d.phone, email: cur.email !== d.email, cpf: changedCpf },
    }, ctx.ip);
  });
}

export async function setDriverStatus(admin: AdminPrincipal, id: string, status: "active" | "blocked", ctx: ReqCtx) {
  assertCanWrite(admin);
  await asAdmin(admin, async (tx) => {
    const r = await tx`update drivers set status = ${status} where id = ${id} and anonymized_at is null returning id`;
    if (!r.length) throw new AppError("not_found", "Motorista não encontrado.", 404);
    await auditLog(tx, admin.id, status === "blocked" ? "driver.block" : "driver.unblock", "driver", id, {}, ctx.ip);
  });
  if (status === "blocked") {
    await asAuth((tx) => tx`update sessions set revoked_at = now() where subject_type = 'driver' and subject_id = ${id} and revoked_at is null`);
  }
}

/** Mostra o CPF completo. Cada consulta fica registrada na auditoria. */
export async function revealCpf(admin: AdminPrincipal, id: string, ctx: ReqCtx) {
  return asAdmin(admin, async (tx) => {
    const [d] = await tx<{ cpf_enc: string; anonymized_at: Date | null }[]>`select cpf_enc, anonymized_at from drivers where id = ${id}`;
    if (!d || d.anonymized_at) throw new AppError("not_found", "Motorista não encontrado.", 404);
    await auditLog(tx, admin.id, "driver.cpf_reveal", "driver", id, {}, ctx.ip);
    return formatCpf(decrypt(d.cpf_enc));
  });
}

/** Anonimização (LGPD): remove dados pessoais e mantém os registros de treinamento. */
export async function anonymizeDriver(admin: AdminPrincipal, id: string, ctx: ReqCtx) {
  assertSuperadmin(admin);
  await asAdmin(admin, async (tx) => {
    const r = await tx`update drivers set full_name = 'Motorista anonimizado', phone = null, email = null, notes = null,
        cpf_hash = ${"anon:" + randomToken(12)}, cpf_enc = ${encrypt("anonimizado")}, cpf_mask = '***.***.***-**',
        status = 'blocked', anonymized_at = now()
      where id = ${id} and anonymized_at is null returning id`;
    if (!r.length) throw new AppError("not_found", "Motorista não encontrado ou já anonimizado.", 404);
    await auditLog(tx, admin.id, "driver.anonymize", "driver", id, {}, ctx.ip);
  });
  await asAuth((tx) => tx`update sessions set revoked_at = now() where subject_type = 'driver' and subject_id = ${id} and revoked_at is null`);
}

// ---------------------------------------------------------------------
// Listagem e detalhe
// ---------------------------------------------------------------------
export type DriverListFilters = { q?: string; baseId?: string; status?: StatusKey | ""; trainingId?: string; from?: Date; to?: Date; page?: number; pageSize?: number };
export type DriverListRow = { id: string; full_name: string; cpf_mask: string; phone: string | null; email: string | null; base_name: string | null;
  driver_status: string; created_at: Date; conv: (ConvocationRow & { status: StatusKey }) | null; convocations: number };

export async function listDrivers(admin: AdminPrincipal, f: DriverListFilters, now = new Date()) {
  const q = (f.q ?? "").trim();
  const digits = onlyDigits(q);
  const byCpf = digits.length === 11 ? cpfHash(digits) : null;
  return asAdmin(admin, async (tx) => {
    const rows = await tx<(Omit<DriverListRow, "conv"> & { conv: ConvocationRow | null })[]>`
      select d.id, d.full_name, d.cpf_mask, d.phone, d.email, b.name as base_name, d.status as driver_status, d.created_at,
        (select count(*)::int from convocations c where c.driver_id = d.id) as convocations,
        (select row_to_json(o) from convocation_overview o where o.driver_id = d.id
           ${f.trainingId ? tx`and o.training_id = ${f.trainingId}` : tx``}
           order by o.created_at desc limit 1) as conv
      from drivers d left join bases b on b.id = d.base_id
      where d.anonymized_at is null
        ${byCpf ? tx`and d.cpf_hash = ${byCpf}` : q ? tx`and (d.full_name ilike ${"%" + q + "%"} or d.email ilike ${"%" + q + "%"} ${digits.length >= 4 ? tx`or d.phone like ${"%" + digits + "%"}` : tx``})` : tx``}
        ${f.baseId ? tx`and d.base_id = ${f.baseId}` : tx``}
        ${f.trainingId ? tx`and exists (select 1 from convocations c where c.driver_id = d.id and c.training_id = ${f.trainingId})` : tx``}
        ${f.from ? tx`and exists (select 1 from convocations c where c.driver_id = d.id and c.created_at >= ${f.from})` : tx``}
        ${f.to ? tx`and exists (select 1 from convocations c where c.driver_id = d.id and c.created_at < ${f.to})` : tx``}
      order by d.created_at desc
      limit 2000`;
    const mapped: DriverListRow[] = rows.map((r) => {
      const conv = r.conv ? reviveDates(r.conv) : null;
      return { ...r, conv: conv ? { ...conv, status: computeStatus(conv, now) } : null };
    });
    const filtered = f.status ? mapped.filter((r) => r.conv?.status === f.status) : mapped;
    const pageSize = f.pageSize ?? 50;
    const page = Math.max(1, f.page ?? 1);
    return { total: filtered.length, page, pageSize, rows: filtered.slice((page - 1) * pageSize, page * pageSize) };
  });
}

const DATE_KEYS = ["deadline_at", "activated_at", "first_access_at", "expires_at", "blocked_at", "cancelled_at", "completed_at", "created_at", "signed_at"];
export function reviveDates<T>(o: T): T {
  const r = { ...(o as Record<string, unknown>) };
  for (const k of DATE_KEYS) if (typeof r[k] === "string") r[k] = new Date(r[k] as string);
  return r as T;
}

export async function getDriverDetail(admin: AdminPrincipal, id: string, now = new Date()) {
  return asAdmin(admin, async (tx) => {
    const [d] = await tx<{ id: string; full_name: string; cpf_mask: string; phone: string | null; email: string | null; base_id: string | null; base_name: string | null;
      status: string; notes: string | null; anonymized_at: Date | null; created_at: Date; created_by_name: string | null }[]>`
      select d.id, d.full_name, d.cpf_mask, d.phone, d.email, d.base_id, b.name as base_name, d.status, d.notes, d.anonymized_at, d.created_at, a.name as created_by_name
      from drivers d left join bases b on b.id = d.base_id left join admins a on a.id = d.created_by where d.id = ${id}`;
    if (!d) return null;
    const convocations = await convocationsOfDriver(tx, id, now);
    const events = Object.fromEntries(await Promise.all(convocations.map(async (c) => [c.id, await convocationEvents(tx, c.id)] as const)));
    const access = await tx<{ at: Date; event: string; success: boolean; ip: string | null; details: Record<string, unknown> }[]>`
      select at, event, success, ip, details from auth_log where subject_type = 'driver' and subject_id = ${id} order by at desc limit 30`;
    const attempts = await tx<{ id: string; convocation_id: string; attempt_number: number; started_at: Date; submitted_at: Date | null; submit_reason: string | null; score_pct: string | null; passed: boolean | null }[]>`
      select a.id, a.convocation_id, a.attempt_number, a.started_at, a.submitted_at, a.submit_reason, a.score_pct, a.passed
      from exam_attempts a join convocations c on c.id = a.convocation_id where c.driver_id = ${id} order by a.attempt_number`;
    return { driver: d, convocations, events, access, attempts };
  });
}

// ---------------------------------------------------------------------
// Importação CSV
// ---------------------------------------------------------------------
export type ImportLine = { line: number; name: string; cpf: string; result: "created" | "convocated" | "error"; message: string };

const HEADER_ALIASES: Record<string, string> = {
  nome: "nome", "nome completo": "nome", cpf: "cpf", telefone: "telefone", celular: "telefone", whatsapp: "telefone",
  email: "email", "e-mail": "email", base: "base", "base operacional": "base",
  ocorrencia: "pnr", "ocorrência": "pnr", pnr: "pnr", "ocorrencia pnr": "pnr", "ocorrência pnr": "pnr", referencia: "pnr", "referência": "pnr",
};

/**
 * Importa motoristas de um CSV (separador ; ou ,). Colunas: nome, cpf, telefone, email, base, ocorrencia_pnr.
 * Linhas com erro são ignoradas e listadas no relatório. CPF já cadastrado recebe nova convocação, se houver treinamento.
 */
export async function importDriversCsv(admin: AdminPrincipal, csvText: string,
  conv: { trainingId: string; deadline: DeadlineInput } | null, ctx: ReqCtx): Promise<ImportLine[]> {
  assertCanWrite(admin);
  const now = ctx.now ?? new Date();
  const text = csvText.replace(/^﻿/, "");
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true, skipEmptyLines: "greedy",
    delimiter: text.split("\n")[0].includes(";") ? ";" : ",",
    transformHeader: (h) => HEADER_ALIASES[h.trim().toLowerCase().replace(/_/g, " ")] ?? h.trim().toLowerCase(),
  });
  if (!parsed.meta.fields?.includes("nome") || !parsed.meta.fields?.includes("cpf")) {
    throw new AppError("csv", "O arquivo precisa ter as colunas nome e cpf (e telefone e/ou email).");
  }
  if (parsed.data.length > 2000) throw new AppError("csv", "Importe no máximo 2.000 linhas por arquivo.");
  const results: ImportLine[] = [];
  const seen = new Set<string>();
  for (const [i, row] of parsed.data.entries()) {
    const line = i + 2;
    const name = (row.nome ?? "").trim();
    const cpfDigits = onlyDigits(row.cpf ?? "");
    try {
      if (seen.has(cpfDigits)) throw new AppError("dup", "CPF repetido no próprio arquivo.");
      seen.add(cpfDigits);
      const r = await asAdmin(admin, async (tx) => {
        const baseId = await resolveBaseByName(tx, row.base);
        const [existing] = await tx<{ id: string; anonymized_at: Date | null }[]>`select id, anonymized_at from drivers where cpf_hash = ${cpfHash(cpfDigits)}`;
        if (existing) {
          if (!conv) throw new AppError("duplicate_cpf", "CPF já cadastrado.");
          if (existing.anonymized_at) throw new AppError("anon", "Cadastro anonimizado.");
          const c = await insertConvocation(tx, admin, { driverId: existing.id, trainingId: conv.trainingId, baseId, pnrReference: row.pnr || null, deadline: conv.deadline }, now);
          await auditLog(tx, admin.id, "convocation.create", "convocation", c.id, { driver_id: existing.id, via: "csv" }, ctx.ip);
          return { result: "convocated" as const, message: "Já cadastrado — nova convocação criada." };
        }
        const d = parse(driverSchema, { fullName: name, cpf: cpfDigits, phone: row.telefone, email: row.email, baseId: baseId ?? "" });
        const id = await insertDriverRow(tx, admin, d);
        await auditLog(tx, admin.id, "driver.create", "driver", id, { via: "csv", cpf: maskCpf(cpfDigits) }, ctx.ip);
        if (conv) {
          const c = await insertConvocation(tx, admin, { driverId: id, trainingId: conv.trainingId, baseId, pnrReference: row.pnr || null, deadline: conv.deadline }, now);
          await auditLog(tx, admin.id, "convocation.create", "convocation", c.id, { driver_id: id, via: "csv" }, ctx.ip);
        }
        return { result: "created" as const, message: conv ? "Cadastrado e convocado." : "Cadastrado." };
      });
      results.push({ line, name, cpf: cpfDigits ? maskCpf(cpfDigits) : "", ...r });
    } catch (e) {
      results.push({ line, name, cpf: cpfDigits.length === 11 ? maskCpf(cpfDigits) : row.cpf ?? "", result: "error", message: e instanceof AppError ? e.message : "Erro inesperado nesta linha." });
    }
  }
  await asAdmin(admin, (tx) => auditLog(tx, admin.id, "driver.import_csv", "driver", null, {
    lines: results.length, created: results.filter((r) => r.result === "created").length,
    convocated: results.filter((r) => r.result === "convocated").length, errors: results.filter((r) => r.result === "error").length,
  }, ctx.ip));
  return results;
}
