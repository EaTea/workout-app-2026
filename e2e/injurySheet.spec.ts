import { expect, test, type Page } from "@playwright/test";

// Start 2 Nov 2026: week 1 Day 1 is 2 Nov, Day 2 is 3 Nov, Day 4 is 5 Nov.
const WEEK_1_DAY_1 = "2026-11-02";
const WEEK_1_DAY_2 = "2026-11-03";
const WEEK_1_DAY_4 = "2026-11-05";

/**
 * Seeds settings (start 2 Nov 2026) and, when `isFlagged`, a right-shoulder injury from 1 Nov
 * (the "Your shoulder" section shows only while the shoulder is flagged), fixes the clock at noon on `date`,
 * opens the log screen for `exerciseId` in block `blockPosition`, and taps ⓘ. Returns the open sheet.
 */
async function openSheet(page: Page, date: string, blockPosition: number, exerciseId: string, exerciseName: string, isFlagged = true, extraStorage: Record<string, string> = {}) {
  await page.clock.install({ time: new Date(`${date}T12:00:00`) });
  await page.addInitScript(([flagged, extra]) => {
    for (const [key, value] of Object.entries(extra as Record<string, string>)) window.localStorage.setItem(key, value);
    window.localStorage.setItem(
      "explosive-endurance.settings",
      JSON.stringify({ version: 2, startDate: "2026-11-02", maxReps: { pull_up: 12, dip: 15 }, maxSavedOn: {} }),
    );
    if (flagged === true) {
      window.localStorage.setItem(
        "explosive-endurance.injuries",
        JSON.stringify({ version: 1, injuries: [{ area: "shoulder", side: "right", from: "2026-11-01" }] }),
      );
    }
  }, [isFlagged, extraStorage] as const);
  await page.goto(`/?date=${date}#/log/${date}/${blockPosition}/${exerciseId}`);
  await expect(page.getByRole("heading", { name: exerciseName })).toBeVisible();

  await page.getByRole("button", { name: "Exercise details" }).click();
  const sheet = page.getByRole("dialog", { name: exerciseName });
  await expect(sheet).toBeVisible();
  return sheet;
}

test("the Day 4 kettlebell swing sheet has no Your shoulder section while the shoulder is not flagged", async ({ page }) => {
  const sheet = await openSheet(page, WEEK_1_DAY_4, 2, "kettlebell_swing", "Kettlebell swing", false);

  await expect(sheet.getByRole("heading", { name: "Evidence" })).toBeVisible();
  await expect(sheet.getByRole("heading", { name: "Your shoulder" })).toHaveCount(0);
});

test("the flagged Day 4 stand-in's own sheet says what it is instead of and has its cues, with no Your shoulder section", async ({ page }) => {
  const sheet = await openSheet(page, WEEK_1_DAY_4, 2, "broad_jump", "Broad jumps, hands on hips");

  await expect(sheet).toContainText("Instead of Kettlebell swings");
  await expect(sheet).toContainText("Hands on the hips, no arm swing");
  await expect(sheet.getByRole("heading", { name: "Your shoulder" })).toHaveCount(0);
});

test("the flagged Day 1 Pallof press (caution, no stand-in) sheet says it stays in, pain-free only", async ({ page }) => {
  const sheet = await openSheet(page, WEEK_1_DAY_1, 1, "pallof_press", "Pallof press");

  await expect(sheet.getByRole("heading", { name: "Your shoulder" })).toBeVisible();
  await expect(sheet).toContainText("Can load a sore shoulder. While your shoulder is flagged, it stays in, pain-free only.");
});

test("the Day 1 pull-up sheet, once added back while flagged, still explains the level", async ({ page }) => {
  const sheet = await openSheet(page, WEEK_1_DAY_1, 3, "pull_up", "Pull-ups", true, {
    "explosive-endurance.injury-choices": JSON.stringify({ version: 1, choices: { [WEEK_1_DAY_1]: { "3:pull_up": "addBack" } } }),
  });

  await expect(sheet.getByRole("heading", { name: "Your shoulder" })).toBeVisible();
  await expect(sheet).toContainText("it's left out, and you can add it back for a day at half the sets.");
});

test("an untagged exercise (split-squat jumps) has no Your shoulder section", async ({ page }) => {
  const sheet = await openSheet(page, WEEK_1_DAY_2, 2, "split_squat_jump", "Split-squat jumps");

  await expect(sheet.getByRole("heading", { name: "Evidence" })).toBeVisible();
  await expect(sheet.getByRole("heading", { name: "Your shoulder" })).toHaveCount(0);
});

test("the pull-up sheet has no Your shoulder section while the shoulder is not flagged", async ({ page }) => {
  const sheet = await openSheet(page, WEEK_1_DAY_1, 3, "pull_up", "Pull-ups", false);

  await expect(sheet.getByRole("heading", { name: "Evidence" })).toBeVisible();
  await expect(sheet.getByRole("heading", { name: "Your shoulder" })).toHaveCount(0);
});
