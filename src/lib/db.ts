import "server-only";
import postgres from "postgres";
import { env } from "./env";

/**
 * Acesso ao banco. O pool NÃO é exportado: todo acesso passa por asAuth,
 * asAdmin ou asDriver, que trocam o papel de banco dentro da transação
 * para que as políticas de Row Level Security sejam aplicadas.
 */
type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql;

declare global {
  // eslint-disable-next-line no-var
  var __academySql: Sql | undefined;
}

function pool(): Sql {
  if (!globalThis.__academySql) {
    globalThis.__academySql = postgres(env.databaseUrl, {
      prepare: false, // compatível com o pooler do Supabase (modo transação)
      max: Number(process.env.DB_POOL_MAX ?? 5),
      idle_timeout: 20,
      connect_timeout: 15,
      types: { bigint: postgres.BigInt },
      transform: { undefined: null },
      connection: { application_name: "blink-academy" },
      onnotice: () => {},
    });
  }
  return globalThis.__academySql;
}

async function scoped<T>(
  role: "academy_auth" | "academy_admin" | "academy_driver" | "academy_system",
  settings: Record<string, string>,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return pool().begin(async (tx) => {
    for (const [k, v] of Object.entries(settings)) {
      await tx`select set_config(${k}, ${v}, true)`;
    }
    await tx.unsafe(`set local role ${role}`);
    await tx.unsafe(`set local search_path to academy, public`);
    return fn(tx);
  }) as Promise<T>;
}

/** Operações de login, códigos e sessões (antes de identificar o usuário). */
export function asAuth<T>(fn: (tx: Tx) => Promise<T>) {
  return scoped("academy_auth", {}, fn);
}

/** Operações do painel administrativo. */
export function asAdmin<T>(admin: { id: string; role: string }, fn: (tx: Tx) => Promise<T>) {
  return scoped("academy_admin", { "academy.admin_id": admin.id, "academy.admin_role": admin.role }, fn);
}

/** Operações do portal do motorista (RLS limita aos dados do próprio motorista). */
export function asDriver<T>(driverId: string, fn: (tx: Tx) => Promise<T>) {
  return scoped("academy_driver", { "academy.driver_id": driverId }, fn);
}

/**
 * Operações internas que exigem o gabarito ou concluem treinamentos (gerar/corrigir prova,
 * assinatura, comprovante). Só é chamado depois de validar a sessão do motorista.
 */
export function asSystem<T>(fn: (tx: Tx) => Promise<T>) {
  return scoped("academy_system", {}, fn);
}

/** Rotinas internas (retenção). Uso restrito a scripts e cron. */
export function asMaintenance<T>(fn: (tx: Tx) => Promise<T>) {
  return pool().begin(async (tx) => {
    await tx.unsafe(`set local search_path to academy, public`);
    await tx`select set_config('academy.allow_purge', 'on', true)`;
    return fn(tx);
  }) as Promise<T>;
}

export async function closeDb() {
  if (globalThis.__academySql) {
    await globalThis.__academySql.end({ timeout: 5 });
    globalThis.__academySql = undefined;
  }
}
