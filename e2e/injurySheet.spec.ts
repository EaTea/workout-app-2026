import { expect, test, type Page } from "@playwright/test";

// Start 2 Nov 2026: week 1 Day 1 is 2 Nov, Day 2 is 3 Nov, Day 4 is 5 Nov.
const WEEK_1_DAY_1 = "2026-11-02";
const WEEK_1_DAY_2 = "2026-11-03";
const WEEK_1_DAY_4 = "2026-11-05";

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

test("the Day 4 kettlebell swing sheet names the broad jump stand-in with an 8-min EMOM x 5 dose", async ({ page }) => {
  const sheet = await openSheet(page, WEEK_1_DAY_4, 2, "kettlebell_swing", "Kettlebell swing");

  await expect(sheet.getByRole("heading", { name: "Your shoulder" })).toBeVisible();
  await expect(sheet).toContainText("Loads the shoulder. While your shoulder is flagged, Broad jumps, hands on hips replaces it:");
  await expect(sheet).toContainText("5 / min, 8 min");
});

test("the Day 1 pull-up sheet says it is left out while the shoulder is flagged", async ({ page }) => {
  const sheet = await openSheet(page, WEEK_1_DAY_1, 3, "pull_up", "Pull-ups");

  await expect(sheet.getByRole("heading", { name: "Your shoulder" })).toBeVisible();
  await expect(sheet).toContainText("it's left out, and you can add it back for a day at half the sets.");
});

test("an untagged exercise (split-squat jumps) has no Your shoulder section", async ({ page }) => {
  const sheet = await openSheet(page, WEEK_1_DAY_2, 2, "split_squat_jump", "Split-squat jumps");

  await expect(sheet.getByRole("heading", { name: "Evidence" })).toBeVisible();
  await expect(sheet.getByRole("heading", { name: "Your shoulder" })).toHaveCount(0);
});
