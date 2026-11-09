import { expect, test } from "@playwright/test";

test("home page shows the app heading", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Explosive Endurance" }),
  ).toBeVisible();
});
