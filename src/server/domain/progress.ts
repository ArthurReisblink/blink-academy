/**
 * Progresso efetivo de reprodução.
 * - Guarda trechos [início, fim] em segundos, unificados (o mesmo trecho não conta duas vezes).
 * - Pular para frente não credita o trecho pulado (o navegador só informa o que foi reproduzido).
 * - O servidor limita o crédito ao tempo real decorrido entre envios: não dá para "inventar" 100%.
 * - O navegador reenvia todos os trechos da sessão; o que não coube no limite é creditado nos envios seguintes.
 */
export type Interval = [number, number];

export const PLAY_RATE_LIMIT = 1.1; // a velocidade de reprodução é travada em 1x no player
export const TOLERANCE_SEC = 4;
export const FIRST_BEAT_MAX_SEC = 15;
/** Crédito máximo por envio: um intervalo longo sem envios não libera crédito de uma vez. */
export const MAX_BEAT_SEC = 120;

export function mergeIntervals(list: Interval[]): Interval[] {
  const s = list.filter(([a, b]) => b > a).map(([a, b]) => [a, b] as Interval).sort((x, y) => x[0] - y[0]);
  const out: Interval[] = [];
  for (const [a, b] of s) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + 0.25) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out.map(([a, b]) => [round2(a), round2(b)]);
}

export const coverage = (list: Interval[]) => round2(list.reduce((s, [a, b]) => s + (b - a), 0));
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Parte de "seg" que ainda não está coberta por "existing". */
function uncovered(seg: Interval, existing: Interval[]): Interval[] {
  let parts: Interval[] = [seg];
  for (const [a, b] of existing) {
    parts = parts.flatMap(([x, y]) => {
      if (b <= x || a >= y) return [[x, y] as Interval];
      const r: Interval[] = [];
      if (a > x) r.push([x, a]);
      if (b < y) r.push([b, y]);
      return r;
    });
  }
  return parts.filter(([x, y]) => y - x > 0.01);
}

export type HeartbeatResult = { intervals: Interval[]; covered: number; credited: number; rejected: number; pct: number };

export function applyHeartbeat(opts: {
  existing: Interval[]; segments: unknown; durationSec: number; lastHeartbeatAt: Date | null; now: Date;
}): HeartbeatResult {
  const { durationSec, now } = opts;
  const existing = mergeIntervals(opts.existing ?? []);
  // validação: no máximo 50 trechos, números finitos, dentro da duração
  const raw = Array.isArray(opts.segments) ? (opts.segments as unknown[]).slice(0, 50) : [];
  const segs: Interval[] = [];
  for (const s of raw) {
    if (!Array.isArray(s) || s.length !== 2) continue;
    const a = Number(s[0]); const b = Number(s[1]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    const x = Math.max(0, Math.min(a, durationSec)); const y = Math.max(0, Math.min(b, durationSec));
    if (y > x) segs.push([x, y]);
  }
  const elapsed = opts.lastHeartbeatAt ? Math.max(0, (now.getTime() - opts.lastHeartbeatAt.getTime()) / 1000) : 0;
  let budget = opts.lastHeartbeatAt ? Math.min(elapsed, MAX_BEAT_SEC) * PLAY_RATE_LIMIT + TOLERANCE_SEC : FIRST_BEAT_MAX_SEC;
  let rejected = 0;
  let merged = existing;
  for (const seg of mergeIntervals(segs)) {
    for (const [x, y] of uncovered(seg, merged)) {
      const len = y - x;
      if (budget <= 0) { rejected += len; continue; }
      const take = Math.min(len, budget);
      merged = mergeIntervals([...merged, [x, x + take]]);
      budget -= take;
      rejected += len - take;
    }
  }
  const covered = Math.min(coverage(merged), durationSec);
  return {
    intervals: merged, covered, credited: round2(covered - Math.min(coverage(existing), durationSec)),
    rejected: round2(rejected), pct: durationSec > 0 ? Math.min(100, round2((covered / durationSec) * 100)) : 0,
  };
}
