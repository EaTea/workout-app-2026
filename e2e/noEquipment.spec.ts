import { expect, test, type Page } from "@playwright/test";

// Start 2 Nov 2026: week 1 Day 4 is 5 Nov, week 4 (deload) Day 4 is 26 Nov, week 1 Day 2 is 3 Nov.
const WEEK_1_DAY_4 = "2026-11-05";
const WEEK_4_DAY_4 = "2026-11-26";
const WEEK_1_DAY_2 = "2026-11-03";

/** Seeds settings (start 2 Nov 2026), fixes the clock at noon on `date`, opens the log screen for `exerciseId` in block `blockPosition`, and taps ⓘ. Returns the open sheet. */
async function openSheet(page: Page, date: string, blockPosition: number, exerciseId: string, exerciseName: string) {
  await page.clock.install({ time: new Date(`${date}T12:00:00`) });
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "explosive-endurance.settings",
      JSON.stringify({ version: 2, startDate: "2026-11-02", maxReps: { pull_up: 12, dip: 15 }, maxSavedOn: {} }),
    );
  });
  await page.goto(`/?date=${date}#/log/${date}/${blockPosition}/${exerciseId}`);
  await expect(page.getByRole("heading", { name: exerciseName })).toBeVisible();

  await page.getByRole("button", { name: "Exercise details" }).click();
  const sheet = page.getByRole("dialog", { name: exerciseName });
  await expect(sheet).toBeVisible();
  return sheet;
}

test("the Day 4 single-leg RDL sheet names the backpack swap, this week's dose and its safety cue", async ({ page }) => {
  const sheet = await openSheet(page, WEEK_1_DAY_4, 3, "single_leg_rdl", "Single-leg RDL");

  await expect(sheet.getByRole("heading", { name: "No equipment" })).toBeVisible();
  await expect(sheet).toContainText("Backpack single-leg RDL");
  await expect(sheet).toContainText("3 × 12–15");
  await expect(sheet).toContainText("3s hold at the bottom");
  // The swap's own cues are listed too (they carry its safety points).
  await expect(sheet.getByRole("listitem").filter({ hasText: "Hold a backpack or a water jug in both hands" })).toBeVisible();
});

test("the swap's dose follows the deload week (2 sets in week 4)", async ({ page }) => {
  const sheet = await openSheet(page, WEEK_4_DAY_4, 3, "single_leg_rdl", "Single-leg RDL");

  await expect(sheet.getByRole("heading", { name: "No equipment" })).toBeVisible();
  await expect(sheet).toContainText("Backpack single-leg RDL: 2 × 12–15");
});

test("an exercise without a swap has no No equipment section", async ({ page }) => {
  const sheet = await openSheet(page, WEEK_1_DAY_2, 2, "split_squat_jump", "Split-squat jumps");

  await expect(sheet.getByRole("heading", { name: "Evidence" })).toBeVisible();
  await expect(sheet.getByRole("heading", { name: "No equipment" })).toHaveCount(0);
});
