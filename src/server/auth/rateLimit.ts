import "server-only";
import type { Tx } from "@/lib/db";
import { AppError } from "@/lib/errors";

/**
 * Janela fixa. Retorna true se ainda estiver dentro do limite.
 * Deve ser chamado com o papel academy_auth.
 */
export async function hitLimit(tx: Tx, key: string, limit: number, windowSec: number, now: Date): Promise<boolean> {
  const start = new Date(Math.floor(now.getTime() / (windowSec * 1000)) * windowSec * 1000);
  const [row] = await tx<{ count: number }[]>`
    insert into rate_limits (key, window_start, count) values (${key}, ${start}, 1)
    on conflict (key, window_start) do update set count = rate_limits.count + 1
    returning count`;
  return row.count <= limit;
}

export async function enforceLimit(tx: Tx, key: string, limit: number, windowSec: number, now: Date) {
  if (!(await hitLimit(tx, key, limit, windowSec, now))) {
    throw new AppError("rate_limited", "Muitas tentativas. Aguarde alguns minutos e tente novamente.", 429);
  }
}
