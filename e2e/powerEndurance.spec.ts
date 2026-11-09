import { expect, test, type Page } from "@playwright/test";

// Start 2 Nov 2026: week 4 Day 1 is 23 Nov, week 5 Day 1 is 30 Nov, week 5 Day 5 is 4 Dec.
const WEEK_4_DAY_1 = "2026-11-23";
const WEEK_5_DAY_1 = "2026-11-30";
const WEEK_5_DAY_5 = "2026-12-04";

/** Seeds the settings (start 2 Nov 2026) and fixes the clock to `time`. */
async function seedApp(page: Page, time: string): Promise<void> {
  await page.clock.install({ time: new Date(time) });
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "explosive-endurance.settings",
      JSON.stringify({ version: 2, startDate: "2026-11-02", maxReps: { pull_up: 12, dip: 15 }, maxSavedOn: {} }),
    );
  });
}

test("week 5 day 1: Today shows the adjusted numbers and the heavy bag timer starts at 35s", async ({ page }) => {
  await seedApp(page, `${WEEK_5_DAY_1}T12:00:00`);
  await page.goto("/");

  const bagRow = page.locator(".item-row", { hasText: "Heavy bag" });
  await expect(bagRow).toContainText("25\u201335s");
  await expect(bagRow).toContainText("Power endurance: +5s work");

  const coreCard = page.locator(".block-card", { hasText: "Core" });
  await expect(coreCard.locator(".block-rest")).toContainText("Rest 30s between pairs");
  await expect(coreCard).toContainText("Power endurance: \u221215s rest");

  await page.getByRole("button", { name: "Start timer, Heavy bag finisher" }).click();
  const overlay = page.getByRole("dialog", { name: "Heavy bag timer" });
  await expect(overlay.locator(".timer-title")).toHaveText("Heavy bag \u00b7 5 rounds");
  await expect(overlay.locator(".timer-digits")).toHaveText("0:35");
});

test("week 5 day 5: core rest is 30s", async ({ page }) => {
  await seedApp(page, `${WEEK_5_DAY_5}T12:00:00`);
  await page.goto("/");

  await expect(page.locator(".block-card", { hasText: "Core" }).locator(".block-rest")).toContainText("30s");
  await expect(page.getByText("Power endurance: \u221215s rest")).toBeVisible();
});

test("week 4 (deload) shows no adjustment and the base 30s heavy bag timer", async ({ page }) => {
  await seedApp(page, `${WEEK_4_DAY_1}T12:00:00`);
  await page.goto("/");

  await expect(page.getByText("Power endurance:")).toHaveCount(0);

  await page.getByRole("button", { name: "Start timer, Heavy bag finisher" }).click();
  const overlay = page.getByRole("dialog", { name: "Heavy bag timer" });
  await expect(overlay.locator(".timer-digits")).toHaveText("0:30");
});
