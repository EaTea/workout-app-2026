import { expect, test, type Page } from "@playwright/test";

// Start 2 Nov 2026: week 1 Day 6 is 7 Nov, week 4 Day 6 is 28 Nov (a deload week).
const WEEK_1_DAY_6 = "2026-11-07";
const WEEK_4_DAY_6 = "2026-11-28";

/** Seeds the settings (start 2 Nov 2026) and fixes the clock at noon on `date`, so logging to that date is allowed. */
async function seedApp(page: Page, date: string): Promise<void> {
  await page.clock.install({ time: new Date(`${date}T12:00:00`) });
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "explosive-endurance.settings",
      JSON.stringify({ version: 2, startDate: "2026-11-02", maxReps: { pull_up: 12, dip: 15 }, maxSavedOn: {} }),
    );
  });
}

test("Day 6 ends with the wall sit block, and its timer starts at 5 rounds of 90s with 60s rest", async ({ page }) => {
  await seedApp(page, WEEK_1_DAY_6);
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Lower: ankle" })).toBeVisible();
  await expect(page.locator(".today-subtitle")).toContainText("~42 min");

  const wallSitRow = page.locator(".item-row", { hasText: "Wall sit" });
  await expect(wallSitRow).toBeVisible();
  await expect(wallSitRow).toContainText("90s");
  // Nothing changes in week 1, so no "Same every week" line yet.
  await expect(wallSitRow).not.toContainText("Same every week");

  await page.getByRole("button", { name: "Start timer, Wall sit" }).click();
  const overlay = page.getByRole("dialog", { name: "Wall sit timer" });
  await expect(overlay.locator(".timer-title")).toHaveText("Wall sit · 5 rounds");
  await expect(overlay.locator(".timer-phase")).toHaveText("WORK");
  await expect(overlay.locator(".timer-digits")).toHaveText("1:30");
  await expect(overlay.getByText("Hold steady")).toBeVisible();

  // The first rest is 60s: run the 90s hold and check.
  await overlay.getByRole("button", { name: "Start" }).click();
  await page.clock.runFor(91_000);
  await expect(overlay.locator(".timer-phase")).toHaveText("REST");
  await expect(overlay.getByText("Round 1 of 5")).toBeVisible();
});

test("a wall sit round can be ticked in the log", async ({ page }) => {
  await seedApp(page, WEEK_1_DAY_6);
  await page.goto("/");

  await page.locator(".item-row", { hasText: "Wall sit" }).locator(".item-open").click();
  await page.getByRole("button", { name: "✓ Log set" }).click();
  await expect(page.locator(".log-set-row", { hasText: "Round 1" })).toContainText("Done");
});

test("week 4 (deload) still has 5 rounds of 90s and says it is the same every week", async ({ page }) => {
  await seedApp(page, WEEK_4_DAY_6);
  await page.goto("/");

  await expect(page.getByText("Deload week: sets halved")).toBeVisible();
  const wallSitRow = page.locator(".item-row", { hasText: "Wall sit" });
  await expect(wallSitRow).toContainText("Same every week");

  await page.getByRole("button", { name: "Start timer, Wall sit" }).click();
  const overlay = page.getByRole("dialog", { name: "Wall sit timer" });
  await expect(overlay.locator(".timer-title")).toHaveText("Wall sit · 5 rounds");
  await expect(overlay.locator(".timer-digits")).toHaveText("1:30");
});

test("week 5 (power endurance) wall sit is not lengthened and says it is the same every week", async ({ page }) => {
  await seedApp(page, "2026-12-05");
  await page.goto("/");

  const wallSitRow = page.locator(".item-row", { hasText: "Wall sit" });
  await expect(wallSitRow).toContainText("Same every week");
  await expect(wallSitRow).not.toContainText("Power endurance");

  await page.getByRole("button", { name: "Start timer, Wall sit" }).click();
  await expect(page.getByRole("dialog", { name: "Wall sit timer" }).locator(".timer-digits")).toHaveText("1:30");
});
