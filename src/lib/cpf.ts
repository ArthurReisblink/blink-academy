/** Utilitários de CPF (sem dependências de servidor; usados também no navegador). */

export function onlyDigits(v: string): string {
  return (v ?? "").replace(/\D/g, "");
}

export function isValidCpf(input: string): boolean {
  const cpf = onlyDigits(input);
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;
  const calc = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(cpf[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(cpf[9]) && calc(10) === Number(cpf[10]);
}

export function formatCpf(input: string): string {
  const c = onlyDigits(input).padStart(11, "0");
  return `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9)}`;
}

/** Máscara usada nas telas: ***.456.789-** */
export function maskCpf(input: string): string {
  const c = onlyDigits(input).padStart(11, "0");
  return `***.${c.slice(3, 6)}.${c.slice(6, 9)}-**`;
}

/** Gera um CPF válido (somente para testes e dados de exemplo). */
export function generateCpf(seed?: number): string {
  let n = seed ?? Math.floor(Math.random() * 1e9);
  const base: number[] = [];
  for (let i = 0; i < 9; i++) { base.push(n % 10); n = Math.floor(n / 10); }
  if (base.every((d) => d === base[0])) base[0] = (base[0] + 1) % 10;
  const dv = (arr: number[]) => {
    const len = arr.length;
    const sum = arr.reduce((s, d, i) => s + d * (len + 1 - i), 0);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = dv(base);
  const d2 = dv([...base, d1]);
  return [...base, d1, d2].join("");
}
