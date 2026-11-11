import { expect, test, type Page } from "@playwright/test";

// Start 2 Nov 2026: week 1 Day 3 is 4 Nov, and week 5 Day 3 is 2 Dec.
const WEEK_1_DAY_3 = "2026-11-04";
const WEEK_5_DAY_3 = "2026-12-02";

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

/** The row for an exercise name on Today or the Day plan screen. */
function row(page: Page, name: string) {
  return page.locator(".item-row", { hasText: name });
}

test("Day 3 Today shows the crab core superset and its Rest button starts at 45s", async ({ page }) => {
  await seedApp(page, WEEK_1_DAY_3);
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Upper: push" })).toBeVisible();

  const coreCard = page.locator(".block-card", { hasText: "Core" });
  await expect(row(page, "Crab knee-to-elbow touch").locator(".item-dose-main")).toHaveText("3 × 10");
  await expect(row(page, "Crab to base switch and sprawl").locator(".item-dose-main")).toHaveText("3 × 6");
  await expect(coreCard.locator(".block-rest")).toContainText("Rest 45s between pairs");

  await coreCard.getByRole("button", { name: /Rest 45s between pairs/ }).click();
  const restOverlay = page.getByRole("dialog", { name: "Rest timer" });
  await expect(restOverlay.locator(".timer-digits")).toHaveText("0:45");
});

test("Day 3 plan for week 4 (deload) shows 2 sets of each crab exercise with Changed lines", async ({ page }) => {
  await seedApp(page, WEEK_1_DAY_3);
  await page.goto("/#/plan/3/4");

  await expect(row(page, "Crab knee-to-elbow touch").locator(".item-dose-main")).toHaveText("2 × 10");
  await expect(row(page, "Crab knee-to-elbow touch").locator(".plan-changed")).toHaveText("Changed: 3 × 10 in week 3");
  await expect(row(page, "Crab to base switch and sprawl").locator(".item-dose-main")).toHaveText("2 × 6");
  await expect(row(page, "Crab to base switch and sprawl").locator(".plan-changed")).toHaveText("Changed: 3 × 6 in week 3");
});

test("Day 3 in week 5 (power endurance) cuts the core Rest button to 30s", async ({ page }) => {
  await seedApp(page, WEEK_5_DAY_3);
  await page.goto("/");

  const coreCard = page.locator(".block-card", { hasText: "Core" });
  await expect(coreCard.locator(".block-rest")).toContainText("Rest 30s between pairs");

  await coreCard.getByRole("button", { name: /Rest 30s between pairs/ }).click();
  await expect(page.getByRole("dialog", { name: "Rest timer" }).locator(".timer-digits")).toHaveText("0:30");
});

test("Day 3 plan for week 5 says the core rest and sets changed from week 4", async ({ page }) => {
  await seedApp(page, WEEK_1_DAY_3);
  await page.goto("/#/plan/3/5");

  await expect(page.getByText("Changed: rest 45–60s between pairs in week 4")).toBeVisible();
  await expect(row(page, "Crab knee-to-elbow touch").locator(".plan-changed")).toHaveText("Changed: 2 × 10 in week 4");
  await expect(row(page, "Crab to base switch and sprawl").locator(".plan-changed")).toHaveText("Changed: 2 × 6 in week 4");
});

test("a set of each crab exercise can be logged from Today", async ({ page }) => {
  await seedApp(page, WEEK_1_DAY_3);
  await page.goto("/");

  for (const [name, reps] of [["Crab knee-to-elbow touch", 10], ["Crab to base switch and sprawl", 6]] as const) {
    await row(page, name).locator(".item-open").click();
    await page.getByRole("button", { name: "✓ Log set" }).click();
    await expect(page.locator(".log-set-row", { hasText: "Set 1" })).toContainText(`${reps} reps`);
    await page.getByRole("link", { name: "Back to Today", exact: true }).click();
    await expect(row(page, name).locator(".item-progress")).toHaveText("1/3");
  }
});
