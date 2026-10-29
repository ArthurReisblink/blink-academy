import { describe, expect, it } from "vitest";
import { formatCpf, generateCpf, isValidCpf, maskCpf } from "@/lib/cpf";
import { maskEmail, maskPhone, normalizeEmail, normalizePhone } from "@/lib/contact";

describe("CPF", () => {
  it("aceita CPF com dígitos verificadores corretos", () => {
    expect(isValidCpf("529.982.247-25")).toBe(true);
    expect(isValidCpf("52998224725")).toBe(true);
  });
  it("rejeita dígito verificador errado, tamanho errado e sequência repetida", () => {
    expect(isValidCpf("529.982.247-24")).toBe(false);
    expect(isValidCpf("5299822472")).toBe(false);
    expect(isValidCpf("111.111.111-11")).toBe(false);
    expect(isValidCpf("")).toBe(false);
  });
  it("gera CPFs válidos para testes", () => {
    for (let i = 0; i < 200; i++) expect(isValidCpf(generateCpf(i * 7919 + 13))).toBe(true);
  });
  it("formata e mascara", () => {
    expect(formatCpf("52998224725")).toBe("529.982.247-25");
    expect(maskCpf("52998224725")).toBe("***.982.247-**");
  });
});

describe("Contato", () => {
  it("normaliza telefone brasileiro para E.164", () => {
    expect(normalizePhone("(27) 99999-0000")).toBe("+5527999990000");
    expect(normalizePhone("+55 27 99999-0000")).toBe("+5527999990000");
    expect(normalizePhone("123")).toBeNull();
  });
  it("valida e mascara e-mail e telefone", () => {
    expect(normalizeEmail(" Joao@Exemplo.com ")).toBe("joao@exemplo.com");
    expect(normalizeEmail("joao@")).toBeNull();
    expect(maskPhone("+5527999990000")).toBe("(27) *****-0000");
    expect(maskEmail("joao@exemplo.com.br")).toBe("j***@e***.com.br");
  });
});
