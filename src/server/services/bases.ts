import "server-only";
import { z } from "zod";
import { asAdmin } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { AdminPrincipal, ReqCtx } from "../context";
import { assertCanWrite } from "../auth/admin";
import { auditLog } from "../auth/log";
import { parse } from "./common";

export async function listBases(admin: AdminPrincipal, includeInactive = false) {
  return asAdmin(admin, (tx) => tx<{ id: string; name: string; active: boolean }[]>`
    select id, name, active from bases ${includeInactive ? tx`` : tx`where active`} order by name`);
}

export async function createBase(admin: AdminPrincipal, name: string, ctx: ReqCtx) {
  assertCanWrite(admin);
  const n = parse(z.string().trim().min(2, "Nome da base muito curto.").max(80), name);
  return asAdmin(admin, async (tx) => {
    const [dup] = await tx`select 1 from bases where lower(name) = lower(${n})`;
    if (dup) throw new AppError("duplicate", "Já existe uma base com esse nome.");
    const [b] = await tx<{ id: string }[]>`insert into bases (name) values (${n}) returning id`;
    await auditLog(tx, admin.id, "base.create", "base", b.id, { name: n }, ctx.ip);
    return b.id;
  });
}

export async function setBaseActive(admin: AdminPrincipal, id: string, active: boolean, ctx: ReqCtx) {
  assertCanWrite(admin);
  await asAdmin(admin, async (tx) => {
    await tx`update bases set active = ${active} where id = ${id}`;
    await auditLog(tx, admin.id, active ? "base.activate" : "base.deactivate", "base", id, {}, ctx.ip);
  });
}

/** Busca base pelo nome (importação CSV); cria se não existir. */
export async function resolveBaseByName(tx: import("@/lib/db").Tx, name: string | null | undefined): Promise<string | null> {
  const n = (name ?? "").trim();
  if (!n) return null;
  const [b] = await tx<{ id: string }[]>`select id from bases where lower(name) = lower(${n})`;
  if (b) return b.id;
  const [nb] = await tx<{ id: string }[]>`insert into bases (name) values (${n}) returning id`;
  return nb.id;
}
