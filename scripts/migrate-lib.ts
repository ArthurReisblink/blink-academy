import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

/** Aplica, em ordem, os arquivos de db/migrations ainda não aplicados. */
export async function migrate(databaseUrl: string, opts: { log?: (s: string) => void } = {}) {
  const log = opts.log ?? console.log;
  const sql = postgres(databaseUrl, { prepare: false, max: 1, onnotice: () => {} });
  try {
    await sql`create schema if not exists academy_meta`;
    await sql`create table if not exists academy_meta.migrations (name text primary key, applied_at timestamptz not null default now())`;
    await sql`revoke all on schema academy_meta from public`;
    const dir = join(process.cwd(), "db", "migrations");
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    const done = new Set((await sql<{ name: string }[]>`select name from academy_meta.migrations`).map((r) => r.name));
    for (const f of files) {
      if (done.has(f)) continue;
      const body = readFileSync(join(dir, f), "utf8");
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`insert into academy_meta.migrations (name) values (${f})`;
      });
      log(`✔ migração aplicada: ${f}`);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}
