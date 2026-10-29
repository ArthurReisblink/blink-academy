import { config } from "dotenv";
import postgres from "postgres";
import { migrate } from "../scripts/migrate-lib";

export default async function setup() {
  config({ path: ".env.test", override: true, quiet: true });
  // .env.test.local (opcional, não versionado) permite ajustar o endereço do PostgreSQL de teste
  config({ path: ".env.test.local", override: true, quiet: true });
  const url = process.env.DATABASE_URL!;
  // Proteção: os testes APAGAM o esquema. Só rodam em banco local cujo nome contém "test".
  const u = new URL(url);
  if (!/test/i.test(u.pathname) || !["localhost", "127.0.0.1", "::1"].includes(u.hostname)) {
    throw new Error(`Os testes apagam o banco e só rodam num PostgreSQL local com "test" no nome (atual: ${u.hostname}${u.pathname}).`);
  }
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  await sql.unsafe("drop schema if exists academy cascade; drop schema if exists academy_meta cascade;");
  await sql.end();
  await migrate(url, { log: () => {} });
}
