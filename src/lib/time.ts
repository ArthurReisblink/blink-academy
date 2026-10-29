export const TZ = "America/Sao_Paulo";

const fmt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
});
const fmtDate = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" });

export function fmtDateTime(d?: Date | string | null): string {
  if (!d) return "—";
  return fmt.format(typeof d === "string" ? new Date(d) : d).replace(",", "");
}

export function fmtDay(d?: Date | string | null): string {
  if (!d) return "—";
  return fmtDate.format(typeof d === "string" ? new Date(d) : d);
}

/** Converte "2026-11-05T18:00" digitado no horário de Brasília para Date (UTC). */
export function parseSaoPauloLocal(value: string): Date {
  // Brasil não usa horário de verão desde 2019: UTC-03:00 fixo.
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) throw new Error("Data e hora inválidas");
  return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00-03:00`);
}

export function remainingText(expiresAt: Date | null, now = new Date()): string {
  if (!expiresAt) return "O prazo começa a contar no seu primeiro acesso.";
  const ms = expiresAt.getTime() - now.getTime();
  if (ms <= 0) return "Prazo encerrado";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h >= 48) return `${Math.floor(h / 24)} dias e ${h % 24} h`;
  return `${h} h ${String(m).padStart(2, "0")} min`;
}
