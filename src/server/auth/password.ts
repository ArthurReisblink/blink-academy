import "server-only";
import { hash, verify } from "@node-rs/argon2";

const OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const; // argon2id (padrão OWASP)

export function passwordProblems(pw: string): string[] {
  const p: string[] = [];
  if (pw.length < 12) p.push("pelo menos 12 caracteres");
  if (!/[a-z]/.test(pw)) p.push("uma letra minúscula");
  if (!/[A-Z]/.test(pw)) p.push("uma letra maiúscula");
  if (!/\d/.test(pw)) p.push("um número");
  if (!/[^A-Za-z0-9]/.test(pw)) p.push("um símbolo");
  return p;
}

export const hashPassword = (pw: string) => hash(pw, OPTS);
export const verifyPassword = (h: string, pw: string) => verify(h, pw).catch(() => false);

// Hash fixo usado quando o e-mail não existe, para o tempo de resposta não revelar isso.
let dummy: string | null = null;
export async function dummyVerify(pw: string) {
  dummy ??= await hashPassword("SenhaInexistente#2026");
  await verifyPassword(dummy, pw);
}
