import { expect, test, type Page } from "@playwright/test";

// Start 2 Nov 2026: week 2 Day 1 is 9 Nov, week 5 Day 1 is 30 Nov.
const WEEK_2_DAY_1 = "2026-11-09";
const WEEK_5_DAY_1 = "2026-11-30";
const WEEK_5_DAY_2 = "2026-12-01";

/** Seeds the settings and fixes the real clock to week 5 Day 1 (so logging to it is allowed). */
async function seedApp(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "explosive-endurance.settings",
      JSON.stringify({ version: 1, startDate: "2026-11-02", maxReps: { pull_up: 12, dip: 15 } }),
    );
  });
  await page.clock.install({ time: new Date("2026-11-30T12:00:00") });
}

/** Today's row for an exercise name. */
function row(page: Page, name: string) {
  return page.locator(".item-row", { hasText: name });
}

test("weeks 1-4 show the warm-ups as written and no rotation card", async ({ page }) => {
  await seedApp(page);
  await page.goto(`/?date=${WEEK_2_DAY_1}`);

  await expect(row(page, "YTWI raises")).toBeVisible();
  await expect(page.getByText("Rotated in for")).toHaveCount(0);
  await expect(page.locator(".rotation-card")).toHaveCount(0);
});

test("week 5 day 1: swapped names, the rotation card, and Got it stays dismissed after reload", async ({ page }) => {
  await seedApp(page);
  await page.goto(`/?date=${WEEK_5_DAY_1}`);

  await expect(row(page, "Reverse fly")).toContainText("Rotated in for YTWI raises");
  await expect(row(page, "YTWI raises").filter({ hasNotText: "Rotated in" })).toHaveCount(0);

  const card = page.locator(".rotation-card");
  await expect(card.getByRole("heading", { name: "Warm-up rotation" })).toBeVisible();
  await expect(card).toContainText("Single-leg hip thrust → Kickbacks");
  await expect(card).toContainText("YTWI raises → Reverse fly");
  await expect(card).toContainText("Pallof press → Ab raises");
  await expect(card).toContainText("Also available: Tricep pushdown");

  await card.getByRole("button", { name: "Got it" }).click();
  await expect(card).toHaveCount(0);

  await page.reload();
  await expect(row(page, "Reverse fly")).toBeVisible();
  await expect(page.locator(".rotation-card")).toHaveCount(0);
});

test("week 5 day 2 does not show the rotation card", async ({ page }) => {
  await seedApp(page);
  await page.goto(`/?date=${WEEK_5_DAY_2}`);

  await expect(page.locator(".rotation-card")).toHaveCount(0);
});

test("logging a rotated-in warm-up files the set under the original exercise id", async ({ page }) => {
  await seedApp(page);
  await page.goto(`/?date=${WEEK_5_DAY_1}`);

  await row(page, "Reverse fly").locator(".item-open").click();
  await expect(page.getByRole("heading", { name: "Reverse fly" })).toBeVisible();
  await expect(page.getByText("Rotated in for YTWI raises")).toBeVisible();
  await expect(page.getByRole("button", { name: "Exercise details" })).toHaveCount(0);

  await page.getByRole("button", { name: /^✓ Log set/ }).click();

  const stored = await page.evaluate(() => JSON.parse(window.localStorage.getItem("explosive-endurance.log") ?? "{}"));
  expect(stored.sessions[0].sets[0].exerciseId).toBe("ytwi");
});
