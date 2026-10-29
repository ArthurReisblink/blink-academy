import { describe, expect, it } from "vitest";
import { applyHeartbeat, coverage, mergeIntervals, type Interval } from "@/server/domain/progress";

const t0 = new Date("2026-11-01T12:00:00Z");
const after = (s: number) => new Date(t0.getTime() + s * 1000);

describe("Progresso de vídeo", () => {
  it("une trechos sobrepostos e contíguos", () => {
    expect(mergeIntervals([[10, 20], [0, 5], [15, 30], [5.1, 8]])).toEqual([[0, 8], [10, 30]]);
    expect(coverage([[0, 8], [10, 30]])).toBe(28);
  });

  it("assistir o mesmo trecho de novo não aumenta o percentual", () => {
    const r1 = applyHeartbeat({ existing: [[0, 50]], segments: [[0, 50]], durationSec: 100, lastHeartbeatAt: t0, now: after(50) });
    expect(r1.covered).toBe(50);
    expect(r1.credited).toBe(0);
    expect(r1.pct).toBe(50);
  });

  it("não credita mais do que o tempo real decorrido (envio forjado de 100%)", () => {
    const r = applyHeartbeat({ existing: [], segments: [[0, 600]], durationSec: 600, lastHeartbeatAt: null, now: t0 });
    expect(r.covered).toBeLessThanOrEqual(15);
    const r2 = applyHeartbeat({ existing: r.intervals, segments: [[0, 600]], durationSec: 600, lastHeartbeatAt: t0, now: after(10) });
    expect(r2.covered).toBeLessThanOrEqual(15 + 10 * 1.1 + 4);
    expect(r2.rejected).toBeGreaterThan(500);
  });

  it("ficar horas parado não libera crédito de uma vez", () => {
    const r = applyHeartbeat({ existing: [[0, 10]], segments: [[0, 3600]], durationSec: 3600, lastHeartbeatAt: t0, now: after(7200) });
    expect(r.covered).toBeLessThanOrEqual(10 + 120 * 1.1 + 4);
  });

  it("o que não coube no limite é creditado nos envios seguintes (reenvio cumulativo)", () => {
    const r1 = applyHeartbeat({ existing: [], segments: [[0, 10]], durationSec: 100, lastHeartbeatAt: null, now: t0 });
    // aba em segundo plano: envio atrasado traz 90 s de uma vez, mas só passaram 60 s
    const r2 = applyHeartbeat({ existing: r1.intervals, segments: [[0, 100]], durationSec: 100, lastHeartbeatAt: t0, now: after(60) });
    expect(r2.covered).toBeLessThan(100);
    const r3 = applyHeartbeat({ existing: r2.intervals, segments: [[0, 100]], durationSec: 100, lastHeartbeatAt: after(60), now: after(90) });
    expect(r3.covered).toBe(100);
  });

  it("assistindo em tempo real chega a 100%", () => {
    let iv: Interval[] = [];
    let last: Date | null = null;
    for (let s = 10; s <= 300; s += 10) {
      const r = applyHeartbeat({ existing: iv, segments: [[s - 10, s]], durationSec: 300, lastHeartbeatAt: last, now: after(s) });
      iv = r.intervals; last = after(s);
    }
    expect(coverage(iv)).toBe(300);
  });

  it("pular para frente não credita o trecho pulado", () => {
    const r = applyHeartbeat({ existing: [[0, 30]], segments: [[30, 40], [250, 260]], durationSec: 300, lastHeartbeatAt: t0, now: after(20) });
    expect(r.intervals).toEqual([[0, 40], [250, 260]]);
    expect(r.covered).toBe(50);
  });

  it("ignora trechos inválidos e fora da duração", () => {
    const r = applyHeartbeat({ existing: [], segments: [["x", 3], [5, 2], [-10, 5], [95, 500], "lixo", [1, Infinity]], durationSec: 100, lastHeartbeatAt: t0, now: after(60) });
    expect(r.intervals).toEqual([[0, 5], [95, 100]]);
  });
});
