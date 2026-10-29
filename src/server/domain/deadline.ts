import { AppError } from "@/lib/errors";
import { parseSaoPauloLocal } from "@/lib/time";

export type DeadlineInput =
  | { mode: "duration"; hours: number; startMode: "activation" | "first_access" }
  | { mode: "until"; at: Date };

/** Interpreta o formulário de prazo: preset de dias, prazo personalizado ou data/hora específica. */
export function parseDeadlineForm(f: { preset?: string; customValue?: string; customUnit?: string; until?: string; startMode?: string }, now = new Date()): DeadlineInput {
  const startMode = f.startMode === "first_access" ? "first_access" : "activation";
  if (f.preset === "until") {
    if (!f.until) throw new AppError("deadline", "Informe a data e o horário limite.");
    const at = parseSaoPauloLocal(f.until);
    if (at.getTime() <= now.getTime()) throw new AppError("deadline", "A data limite precisa estar no futuro.");
    return { mode: "until", at };
  }
  let hours: number;
  if (f.preset === "custom") {
    const v = Number(String(f.customValue ?? "").replace(",", "."));
    if (!Number.isFinite(v) || v <= 0) throw new AppError("deadline", "Informe um prazo personalizado válido.");
    hours = Math.round(f.customUnit === "hours" ? v : v * 24);
  } else {
    const days = Number(f.preset);
    if (![1, 2, 3, 7, 15].includes(days)) throw new AppError("deadline", "Escolha um prazo.");
    hours = days * 24; // 1 dia = 24 horas
  }
  if (hours < 1 || hours > 8760) throw new AppError("deadline", "O prazo deve ficar entre 1 hora e 365 dias.");
  return { mode: "duration", hours, startMode };
}
