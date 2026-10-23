import { expect, test } from "@playwright/test";

test("serves the login UI and a ready API", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Entre no seu espaço" }),
  ).toBeVisible();

  const response = await page.request.get("/api/v1/health/ready");
  expect(response.status()).toBe(204);
  expect(await response.body()).toHaveLength(0);
});

test("signs in, restores the session and signs out", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("E-mail").fill("admin@example.test");
  await page.getByLabel("Senha").fill("synthetic-admin-password");
  await page.getByRole("button", { name: "Entrar" }).click();

  await expect(
    page.getByRole("heading", { name: "O espaço está pronto." }),
  ).toBeVisible();
  await expect(page.getByText("admin@example.test")).toBeVisible();

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "O espaço está pronto." }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Sair" }).click();
  await expect(
    page.getByRole("heading", { name: "Entre no seu espaço" }),
  ).toBeVisible();
});
