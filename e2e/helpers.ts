import { expect, type Page } from "@playwright/test";
import { sql, E2E_ADMIN, totp, lastCode } from "./db";

export async function adminLogin(page: Page) {
  // cada login de teste recadastra o autenticador do administrador exclusivo dos testes
  await sql`update academy.admins set totp_secret_enc = null, totp_enabled_at = null, totp_last_step = null where email = ${E2E_ADMIN.email}`;
  await sql`delete from academy.rate_limits`;
  await page.goto("/admin/entrar");
  await page.fill("#email", E2E_ADMIN.email);
  await page.fill("#password", E2E_ADMIN.password);
  await page.click("button[type=submit]");
  await page.waitForURL("**/admin/verificacao");
  const secret = (await page.locator("code").innerText()).trim();
  await page.fill("#code", totp(secret));
  await page.click("button[type=submit]");
  await page.waitForURL(/\/admin$/);
}

export async function driverLogin(page: Page, cpf: string, phoneE164: string) {
  await sql`delete from academy.rate_limits`;
  await page.goto("/m/entrar");
  await page.fill("#cpf", cpf);
  await page.click("button[type=submit]");
  await page.waitForURL("**/m/codigo");
  await page.fill("#code", await lastCode(phoneE164));
  await page.click("button[type=submit]");
  await page.waitForURL(/\/m$/);
  await expect(page.getByText("Minha convocação", { exact: false }).first()).toBeVisible();
}
