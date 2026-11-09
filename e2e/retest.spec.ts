import { expect, test, type Locator, type Page } from "@playwright/test";

// Start 14 Sep 2026: week 7 Day 1 is 26 Oct, week 8 Day 1 is 2 Nov
// (14 Sep + 49 days). Maxes 12 / 15 give a held week 7 pull-up EMOM of
// floor(12 x 0.40) + 2 = 6 per minute; a retested max of 14 gives floor(14 x 0.40) = 5.
const WEEK_8_DAY_1 = "2026-11-02";
const WEEK_8_DAY_2 = "2026-11-03";
const WEEK_7_DAY_1 = "2026-10-26";

/** Seeds settings (start 14 Sep, maxes 12 / 15, no saved dates) and fixes the real clock to week 8 Day 1. */
async function seedWeekEightApp(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (window.localStorage.getItem("explosive-endurance.settings") === null) {
      window.localStorage.setItem(
        "explosive-endurance.settings",
        JSON.stringify({ version: 1, startDate: "2026-09-14", maxReps: { pull_up: 12, dip: 15 } }),
      );
    }
  });
  // The save date comes from the real clock, never from ?date=.
  await page.clock.setFixedTime(new Date("2026-11-02T09:00:00"));
}

/** The tag name of the element with keyboard focus ("BODY" means focus was lost). */
async function focusedTag(page: Page): Promise<string> {
  return page.evaluate(() => document.activeElement?.tagName ?? "NONE");
}

/** The number shown by an exercise's max stepper inside the card (by its accessible name, e.g. "Pull-ups max"). */
function stepperValue(card: Locator, exerciseName: string): Locator {
  return card.locator(`output[aria-label="${exerciseName} max"]`);
}

/** The pull-up EMOM row on Today. */
function pullUpRow(page: Page) {
  return page.locator(".item-row", { hasText: "Pull-ups" });
}

test("week 8: saving each max updates the EMOM, then removes the card for good", async ({ page }) => {
  await seedWeekEightApp(page);
  await page.goto(`/?date=${WEEK_8_DAY_1}`);

  const card = page.locator(".retest-card");
  await expect(card.getByRole("heading", { name: "Retest week" })).toBeVisible();
  await expect(card).toContainText("Test your max pull-ups and dips, then save them. This week's EMOMs switch to the new numbers.");
  await expect(pullUpRow(page).locator(".item-dose-main")).toHaveText("6 / min");

  // Steppers start at the current maxes.
  await expect(stepperValue(card, "Pull-ups")).toHaveText("12");
  await expect(stepperValue(card, "Dips")).toHaveText("15");

  await card.getByRole("button", { name: "Increase Pull-ups max" }).click();
  await card.getByRole("button", { name: "Increase Pull-ups max" }).click();
  await expect(stepperValue(card, "Pull-ups")).toHaveText("14");
  await card.getByRole("button", { name: "Save max for Pull-ups" }).click();

  // The saved row is gone; focus moved on to the remaining row's stepper.
  expect(await focusedTag(page)).toBe("BUTTON");
  await expect(card.getByRole("button", { name: "Decrease Dips max" })).toBeFocused();

  // EMOM now uses floor(14 x 0.40) = 5, with no increase.
  await expect(pullUpRow(page).locator(".item-dose-main")).toHaveText("5 / min");
  await expect(pullUpRow(page).locator(".item-details")).toHaveText("40% of your retested max 14");

  // The card stays for dips only.
  await expect(card).toBeVisible();
  await expect(stepperValue(card, "Pull-ups")).toHaveCount(0);
  await expect(stepperValue(card, "Dips")).toHaveText("15");

  await card.getByRole("button", { name: "Save max for Dips" }).click();
  await expect(page.locator(".retest-card")).toHaveCount(0);
  expect(await focusedTag(page)).not.toBe("BODY");

  await page.reload();
  await expect(page.getByRole("heading", { name: "Upper: pull" })).toBeVisible();
  await expect(page.locator(".retest-card")).toHaveCount(0);
  await expect(pullUpRow(page).locator(".item-dose-main")).toHaveText("5 / min");
});

test("week 7 has no retest card", async ({ page }) => {
  await seedWeekEightApp(page);
  await page.goto(`/?date=${WEEK_7_DAY_1}`);

  await expect(page.getByText("Week 7 of 8 · Day 1")).toBeVisible();
  await expect(page.locator(".retest-card")).toHaveCount(0);
});

test("Not today hides the card for that date, also after a reload, and it is back on the next date", async ({ page }) => {
  await seedWeekEightApp(page);
  await page.goto(`/?date=${WEEK_8_DAY_1}`);

  await page.getByRole("button", { name: "Not today" }).click();
  await expect(page.locator(".retest-card")).toHaveCount(0);
  expect(await focusedTag(page)).not.toBe("BODY");

  await page.reload();
  await expect(page.getByRole("heading", { name: "Upper: pull" })).toBeVisible();
  await expect(page.locator(".retest-card")).toHaveCount(0);

  await page.clock.setFixedTime(new Date("2026-11-03T09:00:00"));
  await page.goto(`/?date=${WEEK_8_DAY_2}`);
  await expect(page.getByText("Week 8 of 8 · Day 2")).toBeVisible();
  await expect(page.locator(".retest-card")).toBeVisible();
});

test("a preview of week 8 with the real date in week 2 cannot save, and settings stay unchanged", async ({ page }) => {
  await seedWeekEightApp(page);
  await page.clock.setFixedTime(new Date("2026-09-22T09:00:00")); // real date: week 2
  await page.goto(`/?date=${WEEK_8_DAY_1}`);

  const card = page.locator(".retest-card");
  await expect(card).toContainText("Previewing — saving is off on this date.");
  await expect(card.getByRole("button", { name: "Save max for Pull-ups" })).toBeDisabled();
  await expect(card.getByRole("button", { name: "Save max for Dips" })).toBeDisabled();
  await expect(card.getByRole("button", { name: "Not today" })).toHaveCount(0);

  await card.getByRole("button", { name: "Increase Pull-ups max" }).click();
  await card.getByRole("button", { name: "Save max for Pull-ups" }).click({ force: true });

  const stored = await page.evaluate(() => JSON.parse(window.localStorage.getItem("explosive-endurance.settings") ?? "null"));
  expect(stored).toEqual({ version: 1, startDate: "2026-09-14", maxReps: { pull_up: 12, dip: 15 } });
  expect(await page.evaluate(() => window.localStorage.getItem("explosive-endurance.fatigue"))).toBeNull();
});

test("saving a max keeps a start date changed by another copy of the app", async ({ page }) => {
  await seedWeekEightApp(page);
  await page.goto(`/?date=${WEEK_8_DAY_1}`);
  await expect(page.locator(".retest-card")).toBeVisible();

  // Another tab edits the dip max while this card is open; saving the pull-up max must not undo it.
  await page.evaluate(() => {
    window.localStorage.setItem(
      "explosive-endurance.settings",
      JSON.stringify({ version: 2, startDate: "2026-09-14", maxReps: { pull_up: 12, dip: 20 }, maxSavedOn: { dip: "2026-11-02" } }),
    );
  });
  await page.getByRole("button", { name: "Save max for Pull-ups" }).click();

  const stored = await page.evaluate(() => JSON.parse(window.localStorage.getItem("explosive-endurance.settings") ?? "null"));
  expect(stored).toEqual({
    version: 3,
    startDate: "2026-09-14",
    maxHistory: {
      // The seeded pull-up max had no date, so it stays as the "unknown, earliest" entry.
      pull_up: [{ savedOn: null, reps: 12 }, { savedOn: "2026-11-02", reps: 12 }],
      dip: [{ savedOn: "2026-11-02", reps: 20 }],
    },
  });
});
