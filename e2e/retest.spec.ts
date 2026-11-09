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

  // Both maxes saved: the card stays for the optional jump until it is skipped.
  await expect(card.getByRole("button", { name: "Skip jump" })).toBeVisible();
  await card.getByRole("button", { name: "Skip jump" }).click();
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
    version: 2,
    startDate: "2026-09-14",
    maxReps: { pull_up: 12, dip: 20 },
    maxSavedOn: { pull_up: "2026-11-02", dip: "2026-11-02" },
  });

  const history = await page.evaluate(() => JSON.parse(window.localStorage.getItem("explosive-endurance.max-history") ?? "null"));
  expect(history).toEqual({
    version: 1,
    maxHistory: {
      // The seeded pull-up max had no date, so it stays as the "unknown, earliest" entry.
      pull_up: [{ savedOn: null, reps: 12 }, { savedOn: "2026-11-02", reps: 12 }],
      dip: [{ savedOn: "2026-11-02", reps: 20 }],
    },
  });
});

/** The stored week 8 check (date 2 Nov 2026 onward) read straight from localStorage, or undefined. */
async function storedWeek8Checks(page: Page): Promise<Array<Record<string, unknown>>> {
  return page.evaluate(() => {
    const stored = JSON.parse(window.localStorage.getItem("explosive-endurance.fatigue") ?? "null");
    return (stored?.checks ?? []).filter((check: { date: string }) => check.date >= "2026-11-02");
  });
}

test("week 8: saving the broad jump records week 8's check, then the pull-up retest merges into it", async ({ page }) => {
  await seedWeekEightApp(page);
  await page.goto(`/?date=${WEEK_8_DAY_1}`);

  const card = page.locator(".retest-card");
  const saveJump = card.getByRole("button", { name: "Save broad jump" });
  const jumpButton = card.locator('button[aria-label="Best broad jump"]');

  // Blank until tapped, and a blank cannot be saved.
  await expect(jumpButton).toHaveText("—");
  await expect(saveJump).toBeDisabled();
  await card.getByRole("button", { name: "Increase Best broad jump" }).click();
  await expect(jumpButton).toHaveText("2.00");
  await expect(saveJump).toBeEnabled();
  await saveJump.click();

  // The card stays (the maxes are still to do) and shows what was saved.
  await expect(card).toContainText("Saved this week: 2.00 m");
  let checks = await storedWeek8Checks(page);
  expect(checks).toHaveLength(1);
  expect(checks[0]).toMatchObject({ date: WEEK_8_DAY_1, programWeek: 8, broadJumpMetres: 2 });
  expect(checks[0]?.maxPullUps).toBeUndefined();

  // Saving the retested pull-ups afterwards keeps the jump.
  await card.getByRole("button", { name: "Increase Pull-ups max" }).click();
  await card.getByRole("button", { name: "Save max for Pull-ups" }).click();
  checks = await storedWeek8Checks(page);
  expect(checks).toHaveLength(1);
  expect(checks[0]).toMatchObject({ date: WEEK_8_DAY_1, broadJumpMetres: 2, maxPullUps: 13 });
  await expect(card).toBeVisible(); // dips still to save
});

test("week 8: a jump saved after the pull-up retest merges into the same check; Clear goes back to blank", async ({ page }) => {
  await seedWeekEightApp(page);
  await page.goto(`/?date=${WEEK_8_DAY_1}`);

  const card = page.locator(".retest-card");
  await card.getByRole("button", { name: "Save max for Pull-ups" }).click();

  await card.getByRole("button", { name: "Increase Best broad jump" }).click();
  await card.getByRole("button", { name: "Clear Best broad jump" }).click();
  await expect(card.locator('button[aria-label="Best broad jump"]')).toHaveText("—");
  await expect(card.getByRole("button", { name: "Save broad jump" })).toBeDisabled();

  await card.getByRole("button", { name: "Increase Best broad jump" }).click();
  await card.getByRole("button", { name: "Save broad jump" }).click();

  const checks = await storedWeek8Checks(page);
  expect(checks).toHaveLength(1);
  expect(checks[0]).toMatchObject({ date: WEEK_8_DAY_1, programWeek: 8, maxPullUps: 12, broadJumpMetres: 2 });
});

test("a preview cannot save the broad jump", async ({ page }) => {
  await seedWeekEightApp(page);
  await page.clock.setFixedTime(new Date("2026-09-22T09:00:00")); // real date: week 2
  await page.goto(`/?date=${WEEK_8_DAY_1}`);

  const card = page.locator(".retest-card");
  await card.getByRole("button", { name: "Increase Best broad jump" }).click();
  await expect(card.getByRole("button", { name: "Save broad jump" })).toBeDisabled();
  expect(await page.evaluate(() => window.localStorage.getItem("explosive-endurance.fatigue"))).toBeNull();
});

/** Saves both maxes on the card (steppers start at the current maxes). */
async function saveBothMaxes(card: Locator): Promise<void> {
  await card.getByRole("button", { name: "Save max for Pull-ups" }).click();
  await card.getByRole("button", { name: "Save max for Dips" }).click();
}

test("week 8: with both maxes saved the card stays for the jump, and Save jump then removes it", async ({ page }) => {
  await seedWeekEightApp(page);
  await page.goto(`/?date=${WEEK_8_DAY_1}`);

  const card = page.locator(".retest-card");
  await saveBothMaxes(card);

  // Only the jump block and Skip jump remain.
  await expect(card).toBeVisible();
  await expect(card.getByRole("button", { name: "Save max for Pull-ups" })).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Save broad jump" })).toBeVisible();
  await expect(card.getByRole("button", { name: "Skip jump" })).toBeVisible();

  await card.getByRole("button", { name: "Increase Best broad jump" }).click();
  await card.getByRole("button", { name: "Save broad jump" }).click();
  await expect(page.locator(".retest-card")).toHaveCount(0);

  const checks = await storedWeek8Checks(page);
  expect(checks).toHaveLength(1);
  expect(checks[0]).toMatchObject({ maxPullUps: 12, broadJumpMetres: 2 });
});

test("week 8: Skip jump removes the card for the rest of the week, also after a reload and on later days", async ({ page }) => {
  await seedWeekEightApp(page);
  await page.goto(`/?date=${WEEK_8_DAY_1}`);

  const card = page.locator(".retest-card");
  await saveBothMaxes(card);
  await card.getByRole("button", { name: "Skip jump" }).click();
  await expect(page.locator(".retest-card")).toHaveCount(0);
  expect(await focusedTag(page)).not.toBe("BODY");

  await page.reload();
  await expect(page.getByRole("heading", { name: "Upper: pull" })).toBeVisible();
  await expect(page.locator(".retest-card")).toHaveCount(0);

  await page.clock.setFixedTime(new Date("2026-11-03T09:00:00"));
  await page.goto(`/?date=${WEEK_8_DAY_2}`);
  await expect(page.getByText("Week 8 of 8 · Day 2")).toBeVisible();
  await expect(page.locator(".retest-card")).toHaveCount(0);
});

test("a preview shows the jump-only card with Skip jump disabled", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "explosive-endurance.settings",
      JSON.stringify({ version: 2, startDate: "2026-09-14", maxReps: { pull_up: 12, dip: 15 }, maxSavedOn: { pull_up: "2026-11-02", dip: "2026-11-02" } }),
    );
  });
  await page.clock.setFixedTime(new Date("2026-09-22T09:00:00")); // real date: week 2
  await page.goto(`/?date=${WEEK_8_DAY_1}`);

  const card = page.locator(".retest-card");
  await expect(card.getByRole("button", { name: "Skip jump" })).toBeDisabled();
  await expect(card.getByRole("button", { name: "Not today" })).toHaveCount(0);
});

test("week 8 holds the reps week 7 showed when the pull-up max was raised late in week 7 (12, then 14 on 18 Dec -> 6 / min)", async ({ page }) => {
  // Start 2 Nov: 14 Dec is W7 D1 (max 12 then), 18 Dec is W7 D5 (max raised to 14), 21 Dec is W8 D1.
  await page.addInitScript(() => {
    if (window.localStorage.getItem("explosive-endurance.settings") === null) {
      window.localStorage.setItem(
        "explosive-endurance.settings",
        JSON.stringify({ version: 2, startDate: "2026-11-02", maxReps: { pull_up: 14, dip: 15 }, maxSavedOn: { pull_up: "2026-12-18", dip: "2026-11-02" } }),
      );
      window.localStorage.setItem(
        "explosive-endurance.max-history",
        JSON.stringify({
          version: 1,
          maxHistory: {
            pull_up: [{ savedOn: "2026-11-02", reps: 12 }, { savedOn: "2026-12-18", reps: 14 }],
            dip: [{ savedOn: "2026-11-02", reps: 15 }],
          },
        }),
      );
    }
  });
  await page.clock.setFixedTime(new Date("2026-12-21T09:00:00"));

  // W7 D1 (14 Dec) showed floor(12 x 0.40) + 2 = 6 reps/min with the max of that day (12), so W8 D1 holds 6, not 7.
  await page.goto("/?date=2026-12-21");
  await expect(pullUpRow(page).locator(".item-dose-main")).toHaveText("6 / min");
  await expect(page.locator(".retest-card")).toBeVisible();
});
