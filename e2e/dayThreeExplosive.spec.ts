import { expect, test, type Page } from "@playwright/test";

/**
 * Day 3's explosive block alternates by week (PLAN.md PR 26 and 27): plyo
 * push-ups in odd weeks, rotational wall throws in even weeks. Start date is
 * 2 Nov 2026, so 4 Nov is Week 1 Day 3 and 11 Nov is Week 2 Day 3.
 */

/** Saves settings the way the app stores them, before the app first loads. */
async function seedStartedProgram(page: Page): Promise<void> {
  await page.addInitScript((settings) => {
    window.localStorage.setItem("explosive-endurance.settings", JSON.stringify(settings));
  }, { version: 1, startDate: "2026-11-02", maxReps: { pull_up: 12, dip: 15 } });
}

/** The row for an exercise name on the Today screen. */
function row(page: Page, name: string) {
  return page.locator(".item-row", { hasText: name });
}

test("week 2 day 3 shows the rotational wall throws and not the plyo push-ups", async ({ page }) => {
  await seedStartedProgram(page);
  await page.goto("/?date=2026-11-11");

  await expect(page.getByText("11 Nov · Week 2 of 8 · Day 3")).toBeVisible();
  await expect(row(page, "Rotational med ball wall throws")).toBeVisible();
  await expect(row(page, "Rotational med ball wall throws").locator(".item-dose-main")).toHaveText("4 × 5");
  await expect(row(page, "Rotational med ball wall throws").locator(".item-details")).toContainText("per side");
  await expect(row(page, "Plyo push-ups")).toHaveCount(0);
});

test("week 1 day 3 shows the plyo push-ups and not the wall throws", async ({ page }) => {
  await seedStartedProgram(page);
  await page.goto("/?date=2026-11-04");

  await expect(page.getByText("4 Nov · Week 1 of 8 · Day 3")).toBeVisible();
  await expect(row(page, "Plyo push-ups")).toBeVisible();
  await expect(row(page, "Plyo push-ups").locator(".item-dose-main")).toHaveText("5 × 5");
  await expect(row(page, "Rotational med ball wall throws")).toHaveCount(0);
});

test("Day 3 plan for week 4 compares the wall throws with week 2, when they last ran", async ({ page }) => {
  await seedStartedProgram(page);
  await page.goto("/#/plan/3/4");

  await expect(row(page, "Rotational med ball wall throws").locator(".item-dose-main")).toHaveText("2 × 5");
  await expect(row(page, "Rotational med ball wall throws").locator(".plan-changed")).toHaveText("Changed: 4 × 5 in week 2");
});
