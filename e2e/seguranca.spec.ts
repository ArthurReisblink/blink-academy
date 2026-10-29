import { test, expect } from "@playwright/test";
import { sql, cpf } from "./db";



test.describe("Segurança (sem login)", () => {
  test("cabeçalhos de segurança presentes", async ({ request }) => {
    const r = await request.get("/m/entrar");
    const h = r.headers();
    expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["strict-transport-security"]).toContain("max-age=");
    expect(h["x-powered-by"]).toBeUndefined();
  });

  test("áreas restritas exigem login", async ({ page, request }) => {
    await page.goto("/admin/motoristas");
    await expect(page).toHaveURL(/\/admin\/entrar/);
    await page.goto("/m");
    await expect(page).toHaveURL(/\/m\/entrar/);
    for (const url of ["/api/m/doc?k=certificate&c=00000000-0000-0000-0000-000000000000", "/api/admin/export?formato=csv", "/api/admin/doc?k=signed&c=x", "/api/m/video-url?c=x&v=y", "/api/cron/retencao"]) {
      expect((await request.get(url, { maxRedirects: 0 })).status(), url).toBe(401);
    }
    // cookie forjado não vale nada
    await page.context().addCookies([{ name: "ba_adm", value: "forjado", url: page.url() }]);
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin\/entrar/);
  });

  test("CPF inexistente: mensagem genérica e nenhum código funciona", async ({ page }) => {
    await sql`delete from academy.rate_limits`;
    await page.goto("/m/entrar");
    await page.fill("#cpf", cpf());
    await page.click("button[type=submit]");
    await page.waitForURL("**/m/codigo");
    await expect(page.getByText("Se o CPF estiver cadastrado")).toBeVisible();
    await page.fill("#code", "123456");
    await page.click("button[type=submit]");
    await expect(page.getByText(/Código (inválido|incorreto)/)).toBeVisible();
    await expect(page).toHaveURL(/\/m\/codigo/);
  });

  test("CPF inválido é recusado e não existe cadastro público", async ({ page, request }) => {
    await page.goto("/m/entrar");
    await page.fill("#cpf", "111.111.111-11");
    await page.click("button[type=submit]");
    await expect(page.getByText("CPF inválido")).toBeVisible();
    for (const url of ["/m/cadastro", "/cadastro", "/admin/cadastro", "/signup", "/m/registrar"]) {
      const r = await request.get(url);
      expect(r.status() === 404 || /\/(m|admin)\/entrar$/.test(new URL(r.url()).pathname), url).toBe(true);
      expect(await r.text(), url).not.toMatch(/criar conta|cadastre-se/i);
    }
  });

  test("login administrativo com senha errada: mensagem genérica", async ({ page }) => {
    await sql`delete from academy.rate_limits`;
    await page.goto("/admin/entrar");
    await page.fill("#email", "nao-existe@blink.test");
    await page.fill("#password", "QualquerSenha#123");
    await page.click("button[type=submit]");
    await expect(page.getByText("E-mail, senha ou código inválidos.")).toBeVisible();
  });

  test("verificação pública recusa código falso", async ({ page }) => {
    await page.goto("/verificar/ABCD-EFGH-JKLM");
    await expect(page.getByText("Documento não encontrado")).toBeVisible();
  });
});
