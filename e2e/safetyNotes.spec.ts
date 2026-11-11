import { expect, test, type Page } from "@playwright/test";


/** Chooses Steady Strength (as the picker would) and, when `startDate` is given, saves it as the start date. */
async function chooseSteadyStrength(page: Page, startDate?: string): Promise<void> {
  await page.addInitScript((start) => {
    window.localStorage.setItem("workout-app.active-program", JSON.stringify({ version: 1, programId: "steady-strength" }));
    if (start !== undefined) {
      window.localStorage.setItem("steady-strength.settings", JSON.stringify({ version: 2, startDate: start, maxReps: {}, maxSavedOn: {} }));
    }
  }, startDate);
}

test.describe("first visit", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("the picker shows Steady Strength's first safety note on its card only", async ({ page }) => {
    await page.goto("/");

    const steadyCard = page.getByRole("button", { name: /Steady Strength/ });
    await expect(steadyCard).toContainText("This is not medical advice. Check with your doctor or physiotherapist before starting");
    await expect(page.getByRole("button", { name: /Explosive Endurance/ })).not.toContainText("medical advice");
  });
});

test("the Steady Strength overview ends with a Before you start card that does not block Start", async ({ page }) => {
  await chooseSteadyStrength(page);
  await page.goto("/#/overview");

  const card = page.locator(".safety-notes-card");
  await expect(card.getByRole("heading", { name: "Before you start" })).toBeVisible();
  await expect(card.locator("li")).toHaveCount(5);
  await expect(card).toContainText("This is not medical advice.");

  // Start works without touching the card.
  await page.getByRole("button", { name: /^Start Day 1/ }).click();
  await expect(page.locator(".today-title")).toBeVisible();
});

test("Explosive Endurance has no Before you start card and no Safety notes link", async ({ page }) => {
  await page.goto("/#/overview");
  await expect(page.getByRole("heading", { name: "Program overview" })).toBeVisible();
  await expect(page.locator(".safety-notes-card")).toHaveCount(0);

  await page.clock.install({ time: new Date("2026-11-09T12:00:00") });
  await page.evaluate(() =>
    window.localStorage.setItem("explosive-endurance.settings", JSON.stringify({ version: 2, startDate: "2026-11-02", maxReps: { pull_up: 12, dip: 15 }, maxSavedOn: {} })),
  );
  await page.goto("/#/today");
  await expect(page.locator(".today-title")).toBeVisible();
  await expect(page.getByRole("button", { name: "Safety notes" })).toHaveCount(0);
});

test("Today's Safety notes link opens the notes in the sheet, and Back closes just the sheet", async ({ page }) => {
  await chooseSteadyStrength(page, "2026-11-02");
  await page.clock.install({ time: new Date("2026-11-02T12:00:00") });
  await page.goto("/#/today");

  await page.getByRole("button", { name: "Safety notes" }).click();
  const sheet = page.getByRole("dialog", { name: "Safety notes" });
  await expect(sheet).toBeVisible();
  await expect(sheet.locator("li")).toHaveCount(5);

  await page.goBack();
  await expect(sheet).toBeHidden();
  await expect(page.locator(".today-title")).toBeVisible();

  await page.getByRole("button", { name: "Safety notes" }).click();
  await page.getByRole("dialog", { name: "Safety notes" }).getByRole("button", { name: "Close" }).click();
  await expect(sheet).toBeHidden();
});

