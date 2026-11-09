import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("E-mail").fill("admin@example.test");
  await page.getByLabel("Senha").fill("synthetic-admin-password");
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.getByRole("button", { name: "Agora não" }).click();
  await expect(page.getByRole("navigation", { name: "Seções" })).toBeVisible();
}

test("serves the login UI and a ready API", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Entrar" })).toBeVisible();
  const response = await page.request.get("/api/v1/health/ready");
  expect(response.status()).toBe(204);
  expect(await response.body()).toHaveLength(0);
});

test("signs in, restores the session and signs out", async ({ page }) => {
  await signIn(page);
  await page.reload();
  await expect(page.getByRole("navigation", { name: "Seções" })).toBeVisible();
  await page.locator(".side button.me").click();
  await page.getByRole("menuitem", { name: "Sair" }).click();
  await expect(page.getByRole("heading", { name: "Entrar" })).toBeVisible();
});

test("administrator creates a project invitation", async ({ page }) => {
  await signIn(page);
  const csrf = (await page.context().cookies()).find(
    (cookie) => cookie.name === "crewstead_csrf",
  )?.value;
  expect(csrf).toBeTruthy();
  const response = await page.request.post("/api/v1/projects", {
    headers: { "X-CSRF-Token": csrf!, Origin: new URL(page.url()).origin },
    data: { name: "Projeto de teste" },
  });
  expect(response.status()).toBe(201);
  await page.reload();
  await page.getByRole("link", { name: "Equipe", exact: true }).click();
  await page.getByRole("button", { name: "Convidar" }).click();
  await page
    .getByLabel("E-mail", { exact: true })
    .fill("new-member@example.test");
  await page.getByRole("button", { name: "Externo" }).click();
  await page.getByRole("button", { name: "Enviar convite" }).click();
  await expect(
    page.getByText("Convite criado e enfileirado para entrega."),
  ).toBeVisible();
});
