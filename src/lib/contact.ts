import { onlyDigits } from "./cpf";

/** Normaliza telefone brasileiro para E.164 (+55DDDNÚMERO). Retorna null se inválido. */
export function normalizePhone(input?: string | null): string | null {
  if (!input) return null;
  let d = onlyDigits(input);
  if (!d) return null;
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  if (!d.startsWith("55") || (d.length !== 12 && d.length !== 13)) return null;
  return `+${d}`;
}

export function normalizeEmail(input?: string | null): string | null {
  if (!input) return null;
  const e = input.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) ? e : null;
}

export function maskPhone(p?: string | null): string {
  if (!p) return "";
  const d = onlyDigits(p);
  return `(${d.slice(2, 4)}) *****-${d.slice(-4)}`;
}

export function maskEmail(e?: string | null): string {
  if (!e) return "";
  const [u, dom] = e.split("@");
  const [host, ...rest] = dom.split(".");
  return `${u.slice(0, 1)}${"*".repeat(Math.max(2, u.length - 1))}@${host.slice(0, 1)}***.${rest.join(".")}`;
}
