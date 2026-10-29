import { describe, expect, it } from "vitest";
import { canonicalJson, decrypt, encrypt, hmacHex } from "@/lib/crypto";
import { passwordProblems } from "@/server/auth/password";

describe("Criptografia", () => {
  it("criptografa e descriptografa (AES-256-GCM) com IV aleatório", () => {
    const a = encrypt("52998224725");
    const b = encrypt("52998224725");
    expect(a).not.toBe(b);
    expect(a).not.toContain("52998224725");
    expect(decrypt(a)).toBe("52998224725");
  });
  it("detecta adulteração do texto cifrado", () => {
    const a = encrypt("segredo").split(".");
    a[3] = a[3].slice(0, -2) + (a[3].endsWith("A") ? "BB" : "AA");
    expect(() => decrypt(a.join("."))).toThrow();
  });
  it("hash de busca é determinístico e separado por finalidade", () => {
    expect(hmacHex("123", "cpf")).toBe(hmacHex("123", "cpf"));
    expect(hmacHex("123", "cpf")).not.toBe(hmacHex("123", "otp"));
  });
  it("JSON canônico independe da ordem das chaves", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { y: 1, x: 2 }] } })).toBe(canonicalJson({ a: { c: [3, { x: 2, y: 1 }], d: 2 }, b: 1 }));
  });
  it("exige senha forte para administradores", () => {
    expect(passwordProblems("curta")).not.toHaveLength(0);
    expect(passwordProblems("SenhaForte#2026")).toHaveLength(0);
  });
});
