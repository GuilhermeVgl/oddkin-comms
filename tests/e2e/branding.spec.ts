import { expect, test } from "@playwright/test";

test("administrator configures the team after signing in", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("E-mail").fill("admin@example.test");
  await page.getByLabel("Senha").fill("synthetic-admin-password");
  await page.getByRole("button", { name: "Entrar" }).click();

  const skipEncryption = page.getByRole("button", { name: "Agora não" });
  await expect(skipEncryption).toBeVisible();
  await skipEncryption.click();

  await expect(
    page.getByRole("heading", { name: "Vamos configurar sua equipe" }),
  ).toBeVisible();
  await page.getByLabel("Nome da equipe").fill("Equipe de teste");
  await page.getByLabel("Logo da equipe (opcional)").setInputFiles({
    name: "logo.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/yQAAAABJRU5ErkJggg==",
      "base64",
    ),
  });
  await page.getByLabel("Mostrar Capuz e Tela e suas animações").uncheck();
  await page.getByRole("button", { name: "Criar equipe" }).click();

  await expect(
    page.getByRole("button", { name: /Equipe de teste/ }),
  ).toBeVisible();
  await expect(page.locator(".orgbtn img.team-logo")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Falar com Capuz e Tela" }),
  ).toHaveCount(0);

  await page.getByRole("link", { name: "Configurações" }).click();
  await page.getByRole("tab", { name: "Equipe" }).click();
  await page.getByLabel("Nome da equipe").fill("Crew do projeto");
  await page.getByRole("button", { name: "Salvar equipe" }).click();
  await expect(
    page.getByRole("button", { name: /Crew do projeto/ }),
  ).toBeVisible();
});
