import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
config({ quiet: true });
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { asAuth, closeDb } from "@/lib/db";
import { createAdminRecord } from "@/server/auth/admin";

/**
 * Cria o administrador inicial (superadmin). Não existe cadastro público de administradores.
 * Uso: npm run admin:create
 */
let muted = false;
const out = new Writable({ write(chunk, enc, cb) { if (!muted) process.stdout.write(chunk, enc); cb(); } });
const rl = createInterface({ input: process.stdin, output: out, terminal: true });
const ask = (q: string, hidden = false) => new Promise<string>((res) => {
  process.stdout.write(q);
  muted = hidden;
  rl.question("", (a) => { muted = false; if (hidden) process.stdout.write("\n"); res(a.trim()); });
});

(async () => {
  const email = process.env.ADMIN_EMAIL || (await ask("E-mail do administrador: "));
  const name = process.env.ADMIN_NAME || (await ask("Nome completo: "));
  const password = process.env.ADMIN_PASSWORD || (await ask("Senha (mín. 12, com maiúscula, minúscula, número e símbolo): ", true));
  const role = (process.env.ADMIN_ROLE as "superadmin" | "admin" | "auditor") || "superadmin";
  // Usa o papel de autenticação apenas para gravar o registro inicial.
  const id = await asAuth(async (tx) => {
    await tx.unsafe("reset role");
    return createAdminRecord(tx, { email, name, role, password });
  });
  console.log(`\nAdministrador criado (${role}). No primeiro login será pedido o cadastro do autenticador (2º fator). id=${id}`);
  rl.close();
  await closeDb();
})().catch(async (e) => { console.error("Erro:", e.message); rl.close(); await closeDb(); process.exit(1); });
