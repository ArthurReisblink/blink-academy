import { test, expect, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { sql, cpf, lastCode } from "./db";
import { adminLogin, driverLogin } from "./helpers";

/**
 * Jornada completa, como acontece de verdade:
 * administrador prepara o treinamento → convoca o motorista → motorista assiste aos vídeos,
 * reprova, refaz, é aprovado, assina com código → comprovante → verificação pública.
 */
test.describe.configure({ mode: "serial" });

const RUN = Date.now().toString(36).slice(-5).toUpperCase();
const TRAINING = `Treinamento E2E ${RUN}`;
const DRIVER = { name: `Motorista Jornada ${RUN}`, cpf: cpf(), phone: "27" + "9" + String(Math.floor(Math.random() * 1e8)).padStart(8, "0") };
const PHONE = "+55" + DRIVER.phone;
let convId = "";



async function selectByText(page: Page, selector: string, text: string) {
  const value = await page.locator(`${selector} option`, { hasText: text }).first().getAttribute("value");
  await page.locator(selector).selectOption(value!);
}

async function uploadVideo(page: Page, file: string, title: string) {
  await page.goto("/admin/videos");
  await page.setInputFiles("#video-file", file);
  await page.fill("#video-title", title);
  await page.click("button:has-text('Enviar vídeo')");
  await expect(page.getByText("disponível na biblioteca")).toBeVisible({ timeout: 60_000 });
}

test("1. administrador prepara o treinamento e convoca o motorista", async ({ page }) => {
  await adminLogin(page);
  await uploadVideo(page, "e2e/fixtures/video-a.mp4", `POD ${RUN}`);
  await uploadVideo(page, "e2e/fixtures/video-b.mp4", `PNR ${RUN}`);

  await page.goto("/admin/questoes");
  const seed = page.locator("button:has-text('Carregar banco inicial')");
  if (await seed.count()) { await seed.click(); await expect(page.getByText(/perguntas ativas em 9 assuntos/)).toBeVisible(); }

  await page.goto("/admin/provas");
  await page.fill("#title", `Prova ${RUN}`);
  await page.fill("#questionCount", "10"); await page.fill("#passPct", "80"); await page.fill("#maxAttempts", "3");
  await page.click("button:has-text('Criar prova')");
  await page.waitForURL(/\/admin\/provas\/[0-9a-f-]{36}/);

  await page.goto("/admin/termos");
  await page.click("button:has-text('Gerar termo-modelo')");
  await expect(page.getByText("Termo-modelo gerado")).toBeVisible();

  await page.goto("/admin/treinamentos");
  await page.fill("#title", TRAINING);
  await page.click("button:has-text('Criar treinamento')");
  await page.waitForURL(/\/admin\/treinamentos\/[0-9a-f-]{36}/);
  for (const t of [`POD ${RUN}`, `PNR ${RUN}`]) {
    await selectByText(page, "select[name=videoId]", t);
    await page.click("button:has-text('Adicionar')");
    await expect(page.getByText(t).first()).toBeVisible();
  }
  await selectByText(page, "select[name=examId]", `Prova ${RUN}`);
  await page.click("button:has-text('Vincular prova')");
  await expect(page.getByText("Prova vinculada")).toBeVisible();
  const termValue = await page.locator("select[name=termId] option").nth(1).getAttribute("value");
  await page.locator("select[name=termId]").selectOption(termValue!);
  await page.click("button:has-text('Vincular termo')");
  await expect(page.getByText("Termo vinculado")).toBeVisible();
  await page.click("button:has-text('Publicar versão 1')");
  await expect(page.getByText("Publicada")).toBeVisible();

  await page.goto("/admin/motoristas/novo");
  await page.fill("#fullName", DRIVER.name);
  await page.fill("#cpf", DRIVER.cpf);
  await page.fill("#phone", DRIVER.phone);
  await selectByText(page, "#trainingId", TRAINING);
  await page.selectOption("#preset", "1");
  await page.click("text=Cadastrar motorista");
  await page.waitForURL(/\/admin\/motoristas\/[0-9a-f-]{36}/);
  await expect(page.getByText("Aguardando acesso")).toBeVisible();
  const driverId = /motoristas\/([0-9a-f-]{36})/.exec(page.url())![1];
  [{ id: convId }] = await sql<{ id: string }[]>`select id from academy.convocations where driver_id = ${driverId}`;
});

test("2. motorista assiste aos vídeos; a prova só libera depois", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const m = await ctx.newPage();
  await driverLogin(m, DRIVER.cpf, PHONE);
  await expect(m.getByText("Liberada após concluir todos os vídeos obrigatórios")).toBeVisible();
  // tentar abrir a prova direto pela URL
  await m.goto(`/m/c/${convId}/prova`);
  await expect(m.getByText("Conclua todos os vídeos obrigatórios")).toBeVisible();
  await expect(m.locator("button:has-text('INICIAR')")).toHaveCount(0);

  for (const name of [`POD ${RUN}`, `PNR ${RUN}`]) {
    await m.goto("/m");
    await m.getByText(name).click();
    await m.waitForURL(/\/m\/c\/.+\/v\/.+/);
    await m.evaluate(() => { const v = document.querySelector("video")!; v.muted = true; void v.play(); });
    await expect(m.getByText(/Vídeo concluído/)).toBeVisible({ timeout: 40_000 });
  }
  await m.goto("/m");
  await expect(m.getByText("2 de 2")).toBeVisible();
  await expect(m.getByRole("link", { name: "INICIAR AVALIAÇÃO" })).toBeVisible();
  await ctx.close();
});

async function takeExam(m: Page, right: number) {
  await m.goto(`/m/c/${convId}/prova`);
  await m.click("button:has-text('INICI')");
  await m.waitForURL(/\/prova\/[0-9a-f-]{36}/);
  const id = m.url().split("/").pop()!;
  const [a] = await sql<{ questions: { id: string; options: { id: string }[] }[]; answer_key: Record<string, { correct: string }> }[]>`select questions, answer_key from academy.exam_attempts where id = ${id}`;
  // durante a prova a página não contém o gabarito
  const html = await m.content();
  expect(html).not.toContain("answer_key");
  expect(html).not.toContain("is_correct");
  for (const [i, q] of a.questions.entries()) {
    const ok = a.answer_key[q.id].correct;
    await m.check(`input[value="${i < right ? ok : q.options.find((o) => o.id !== ok)!.id}"]`);
    await m.waitForTimeout(150);
    if (i < a.questions.length - 1) await m.click("button:has-text('Próxima')");
  }
  await m.waitForTimeout(500);
  await m.click("button:has-text('ENVIAR AVALIAÇÃO')");
  await m.click("button:has-text('Confirmar envio')");
}

test("3. reprova com 7/10, aprova com 8/10 (mínimo 80%)", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const m = await ctx.newPage();
  await driverLogin(m, DRIVER.cpf, PHONE);
  await takeExam(m, 7);
  await expect(m.getByText("REPROVADO")).toBeVisible();
  await expect(m.getByText("70%")).toBeVisible();
  await expect(m.getByText(/ainda tem 2 tentativa/)).toBeVisible();
  // o termo não abre antes da aprovação
  await m.goto(`/m/c/${convId}/termo`);
  await expect(m.getByText(/liberada depois da aprovação/)).toBeVisible();
  await takeExam(m, 8);
  await expect(m.getByText("APROVADO")).toBeVisible();
  await expect(m.getByText("80%").first()).toBeVisible();
  await ctx.close();
});

test("4. assina com código, conclui e o comprovante é verificável", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, acceptDownloads: true });
  const m = await ctx.newPage();
  await driverLogin(m, DRIVER.cpf, PHONE);
  await expect(m.getByText("Aprovado — aguardando assinatura")).toBeVisible();
  await m.getByRole("link", { name: "ASSINAR TERMO" }).click();
  await m.waitForURL(/\/termo$/);
  await m.locator("input[type=checkbox]").check();
  await m.click("button:has-text('RECEBER CÓDIGO')");
  await m.fill("#sign-code", "000000");
  await m.click("button:has-text('ASSINAR TERMO')");
  await expect(m.getByText(/Código incorreto/)).toBeVisible();
  await m.fill("#sign-code", await lastCode(PHONE));
  await m.click("button:has-text('ASSINAR TERMO')");
  await expect(m.getByText("TREINAMENTO CONCLUÍDO")).toBeVisible({ timeout: 20_000 });
  const code = (await m.getByText(/^Comprovante:/).innerText()).split(":")[1].trim();

  const res = await m.request.get(`/api/m/doc?k=certificate&c=${convId}`);
  expect(res.status()).toBe(200);
  const pdf = await res.body();
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");

  const v = await browser.newPage();
  await v.goto("/verificar");
  await v.fill("input[name=code]", code);
  await v.click("button:has-text('Verificar')");
  await expect(v.getByText("Comprovante de conclusão válido")).toBeVisible();
  await expect(v.getByText(createHash("sha256").update(pdf).digest("hex"))).toBeVisible();
  const page = await v.content();
  expect(page).not.toContain(DRIVER.cpf.slice(3, 9));
  expect(page).not.toContain(DRIVER.name);
  await v.close();
  await ctx.close();
});

test("5. painel mostra a conclusão, as evidências e exporta o relatório", async ({ page }) => {
  await adminLogin(page);
  await page.goto(`/admin/relatorios?q=${encodeURIComponent(DRIVER.name)}`);
  await expect(page.getByRole("cell", { name: "Treinamento concluído" })).toBeVisible();
  const csv = await page.request.get(`/api/admin/export?formato=csv&q=${encodeURIComponent(DRIVER.name)}`);
  expect((await csv.text())).toContain(DRIVER.name);
  await page.goto(`/admin/assinaturas?q=${encodeURIComponent(DRIVER.name)}`);
  await page.click("a:has-text('Evidências')");
  await expect(page.getByText("Íntegro: hash recalculado confere")).toBeVisible();
});
