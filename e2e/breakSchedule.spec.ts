import { expect, test, type Page } from "@playwright/test";

/**
 * Break 1 step 2: the schedule skips a break. The break is seeded straight
 * into storage (the buttons to take one arrive in step 3). Start 2 Nov, break
 * 26 Nov to 3 Dec (3 Dec is the first day back).
 */
async function seedSettingsAndBreak(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem("explosive-endurance.settings", JSON.stringify({ version: 1, startDate: "2026-11-02", maxReps: { pull_up: 12, dip: 15 } }));
    window.localStorage.setItem("explosive-endurance.breaks", JSON.stringify({ version: 1, breaks: [{ from: "2026-11-26", to: "2026-12-03" }] }));
  });
}

test("a break day shows no session and says when training resumes", async ({ page }) => {
  await seedSettingsAndBreak(page);
  await page.goto("/?date=2026-11-28");

  await expect(page.getByRole("heading", { name: "On a break" })).toBeVisible();
  await expect(page.getByText("Back on 3 Dec with Week 4, Day 4.")).toBeVisible();
  await expect(page.locator(".block-title")).toHaveCount(0);
});

test("the day before the break is Week 4 Day 3, the first day back is Week 4 Day 4 and 7 Dec starts Week 5", async ({ page }) => {
  await seedSettingsAndBreak(page);

  await page.goto("/?date=2026-11-25");
  await expect(page.getByText("25 Nov · Week 4 of 8 · Day 3")).toBeVisible();

  await page.goto("/?date=2026-12-03");
  await expect(page.getByText("3 Dec · Week 4 of 8 · Day 4")).toBeVisible();

  await page.goto("/?date=2026-12-07");
  await expect(page.getByText("7 Dec · Week 5 of 8 · Day 1")).toBeVisible();
});
