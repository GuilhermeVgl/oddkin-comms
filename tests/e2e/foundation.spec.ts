import { expect, test } from "@playwright/test";

test("serves the foundation UI and a ready API", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "ODDKIN" })).toBeVisible();

  const response = await page.request.get("/api/v1/health/ready");
  expect(response.status()).toBe(204);
  expect(await response.body()).toHaveLength(0);
});
