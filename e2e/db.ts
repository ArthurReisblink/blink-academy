import postgres from "postgres";
import * as OTPAuth from "otpauth";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });

export const sql = postgres(process.env.DATABASE_URL!, { max: 2, onnotice: () => {} });
export const E2E_ADMIN = { email: "e2e-admin@blink.test", password: "E2e#Senha-Forte-2026" };

export function totp(secret: string) {
  return new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret), digits: 6, period: 30 }).generate();
}

/** Último código enviado (somente com MESSAGING_DRIVER=console). */
export async function lastCode(destination: string) {
  const [m] = await sql<{ body: string }[]>`select body from academy.dev_outbox where destination = ${destination} order by id desc limit 1`;
  const code = /(\d{6})/.exec(m?.body ?? "")?.[1];
  if (!code) throw new Error(`nenhum código para ${destination}`);
  return code;
}

export function cpf() {
  const d = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  for (const n of [9, 10]) d.push(((d.reduce((a, x, i) => a + x * (n + 1 - i), 0) * 10) % 11) % 10);
  return d.join("");
}
