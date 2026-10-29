import { describe, expect, it } from "vitest";
import { canComplete, computeStatus, type StatusInput } from "@/server/domain/status";
import { parseDeadlineForm } from "@/server/domain/deadline";

const base: StatusInput = {
  blocked_at: null, cancelled_at: null, completed_at: null, expires_at: null, first_access_at: null, driver_status: "active",
  required_videos: 2, completed_required_videos: 0, any_video_progress: false, has_exam: true,
  attempt_in_progress: false, passed: false, failed_attempts: 0, signed: false,
};
const now = new Date("2026-11-01T12:00:00Z");

describe("Situação da convocação", () => {
  it("segue a sequência do treinamento", () => {
    expect(computeStatus(base, now)).toBe("aguardando_acesso");
    expect(computeStatus({ ...base, first_access_at: now }, now)).toBe("iniciado");
    expect(computeStatus({ ...base, any_video_progress: true }, now)).toBe("assistindo");
    expect(computeStatus({ ...base, completed_required_videos: 2 }, now)).toBe("prova_disponivel");
    expect(computeStatus({ ...base, completed_required_videos: 2, has_exam: false }, now)).toBe("videos_concluidos");
    expect(computeStatus({ ...base, completed_required_videos: 2, attempt_in_progress: true }, now)).toBe("prova_em_andamento");
    expect(computeStatus({ ...base, completed_required_videos: 2, failed_attempts: 1 }, now)).toBe("reprovado");
    expect(computeStatus({ ...base, completed_required_videos: 2, passed: true }, now)).toBe("aprovado_aguardando_assinatura");
    expect(computeStatus({ ...base, completed_at: now }, now)).toBe("concluido");
  });
  it("bloqueio e vencimento têm prioridade sobre o andamento", () => {
    expect(computeStatus({ ...base, any_video_progress: true, blocked_at: now }, now)).toBe("bloqueado");
    expect(computeStatus({ ...base, driver_status: "blocked" }, now)).toBe("bloqueado");
    expect(computeStatus({ ...base, expires_at: new Date(now.getTime() - 1) }, now)).toBe("expirado");
    expect(computeStatus({ ...base, expires_at: new Date(now.getTime() + 1000) }, now)).toBe("aguardando_acesso");
  });
  it("conclusão exige vídeos + aprovação + assinatura", () => {
    expect(canComplete({ ...base, completed_required_videos: 2, passed: true, signed: false })).toBe(false);
    expect(canComplete({ ...base, completed_required_videos: 1, passed: true, signed: true })).toBe(false);
    expect(canComplete({ ...base, completed_required_videos: 2, passed: false, signed: true })).toBe(false);
    expect(canComplete({ ...base, completed_required_videos: 2, passed: true, signed: true })).toBe(true);
    expect(canComplete({ ...base, required_videos: 0, completed_required_videos: 0, passed: true, signed: true })).toBe(false);
  });
});

describe("Prazo de acesso", () => {
  it("1 dia = 24 horas e presets de 1, 2, 3, 7 e 15 dias", () => {
    for (const d of [1, 2, 3, 7, 15]) expect(parseDeadlineForm({ preset: String(d) })).toEqual({ mode: "duration", hours: d * 24, startMode: "activation" });
  });
  it("prazo personalizado em horas ou dias e início no primeiro acesso", () => {
    expect(parseDeadlineForm({ preset: "custom", customValue: "36", customUnit: "hours", startMode: "first_access" })).toEqual({ mode: "duration", hours: 36, startMode: "first_access" });
    expect(parseDeadlineForm({ preset: "custom", customValue: "10", customUnit: "days" })).toMatchObject({ hours: 240 });
  });
  it("data e hora específicas no horário de Brasília", () => {
    const r = parseDeadlineForm({ preset: "until", until: "2026-11-05T18:00" }, now);
    expect(r).toEqual({ mode: "until", at: new Date("2026-11-05T21:00:00Z") });
  });
  it("recusa prazo no passado ou inválido", () => {
    expect(() => parseDeadlineForm({ preset: "until", until: "2026-10-01T10:00" }, now)).toThrow(/futuro/);
    expect(() => parseDeadlineForm({ preset: "custom", customValue: "0" })).toThrow();
    expect(() => parseDeadlineForm({ preset: "4" })).toThrow();
  });
});
