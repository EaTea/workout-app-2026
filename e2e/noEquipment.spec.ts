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

// ---------------------------------------------------------------------------
// Ticking "No equipment" on Today and training the swap (PR 19).
// ---------------------------------------------------------------------------

const WEEK_1_DAY_1 = "2026-11-02";
const WEEK_2_DAY_4 = "2026-11-12";

/**
 * Seeds settings (start 2 Nov 2026, max pull-ups 12) and fixes the real clock
 * at noon on `clockDate`, so that date and anything earlier can be logged to
 * and later dates are "the future" (the app refuses to log or tick there).
 * Storage is only seeded on the first load, so reloads keep the ticks and sets.
 */
async function seedSettingsAndClock(page: Page, clockDate: string): Promise<void> {
  await page.clock.install({ time: new Date(`${clockDate}T12:00:00`) });
  await page.addInitScript(() => {
    if (window.localStorage.getItem("explosive-endurance.settings") === null) {
      window.localStorage.setItem(
        "explosive-endurance.settings",
        JSON.stringify({ version: 2, startDate: "2026-11-02", maxReps: { pull_up: 12, dip: 15 }, maxSavedOn: {} }),
      );
    }
  });
}

/** Today's row for an exercise name. */
function todayRow(page: Page, name: string) {
  return page.locator(".item-row", { hasText: name });
}

/** The "No equipment" checkbox on Today for an exercise (named by the original while unticked, by the original too once ticked). */
function noEquipmentBox(page: Page, name: string) {
  return page.getByRole("checkbox", { name: `No equipment, ${name}` });
}

/** Logs `count` sets as planned on the open log screen of an item with no rest (the RDL has none), waiting for each set to appear in the list. */
async function logSetsAsPlanned(page: Page, count: number): Promise<void> {
  for (let done = 1; done <= count; done++) {
    await page.getByRole("button", { name: /✓ Log set/ }).click();
    await expect(page.locator(".log-set-row", { hasText: `Set ${done}` })).toBeVisible();
  }
}

test("ticking No equipment shows the swap and its dose, and unticking restores the original", async ({ page }) => {
  await seedSettingsAndClock(page, WEEK_1_DAY_4);
  await page.goto(`/?date=${WEEK_1_DAY_4}`);

  const rdlRow = todayRow(page, "Single-leg RDL");
  await expect(rdlRow).toBeVisible();
  await expect(todayRow(page, "Backpack single-leg RDL")).toHaveCount(0);

  await noEquipmentBox(page, "Single-leg RDL").check();

  const swappedRow = todayRow(page, "Backpack single-leg RDL");
  await expect(swappedRow).toBeVisible();
  await expect(swappedRow.locator(".item-dose-main")).toContainText("3 × 12–15");
  await expect(swappedRow).toContainText("Instead of Single-leg RDL");
  // The box stays ticked and is still named after the original.
  await expect(noEquipmentBox(page, "Single-leg RDL")).toBeChecked();
  // Other swappable rows are unchanged.
  await expect(todayRow(page, "Kettlebell swings")).toBeVisible();

  await noEquipmentBox(page, "Single-leg RDL").uncheck();

  await expect(todayRow(page, "Backpack single-leg RDL")).toHaveCount(0);
  await expect(todayRow(page, "Single-leg RDL")).toBeVisible();
  await expect(todayRow(page, "Single-leg RDL")).not.toContainText("Instead of");
});

test("a tick survives a reload and belongs to that date only", async ({ page }) => {
  await seedSettingsAndClock(page, WEEK_2_DAY_4);
  await page.goto(`/?date=${WEEK_1_DAY_4}`);

  await noEquipmentBox(page, "Single-leg RDL").check();
  await expect(todayRow(page, "Backpack single-leg RDL")).toBeVisible();

  await page.reload();
  await expect(todayRow(page, "Backpack single-leg RDL")).toBeVisible();
  await expect(noEquipmentBox(page, "Single-leg RDL")).toBeChecked();

  // The same weekday a week later is not ticked.
  await page.goto(`/?date=${WEEK_2_DAY_4}`);
  await expect(todayRow(page, "Single-leg RDL")).toBeVisible();
  await expect(noEquipmentBox(page, "Single-leg RDL")).not.toBeChecked();
  await expect(todayRow(page, "Backpack single-leg RDL")).toHaveCount(0);
});

test("logging a set on the swap logs it under the swap and locks the tick", async ({ page }) => {
  await seedSettingsAndClock(page, WEEK_1_DAY_4);
  await page.goto(`/?date=${WEEK_1_DAY_4}`);

  await noEquipmentBox(page, "Single-leg RDL").check();
  await todayRow(page, "Backpack single-leg RDL").locator(".item-open").click();
  await expect(page.getByRole("heading", { name: "Backpack single-leg RDL" })).toBeVisible();

  await logSetsAsPlanned(page, 1);
  await expect(page.locator(".log-set-row", { hasText: "Set 1" })).toBeVisible();

  await page.getByRole("link", { name: "Today" }).first().click();
  const swappedRow = todayRow(page, "Backpack single-leg RDL");
  await expect(swappedRow).toContainText("Instead of Single-leg RDL");
  await expect(swappedRow.locator(".item-progress")).toHaveText("1/3");
  await expect(noEquipmentBox(page, "Single-leg RDL")).toBeDisabled();
  await expect(noEquipmentBox(page, "Single-leg RDL")).toBeChecked();
});

test("last time follows the swap: next week's ticked RDL remembers 5 Nov, the plain RDL does not", async ({ page }) => {
  await seedSettingsAndClock(page, WEEK_2_DAY_4);
  await page.goto(`/?date=${WEEK_1_DAY_4}`);

  await noEquipmentBox(page, "Single-leg RDL").check();
  await todayRow(page, "Backpack single-leg RDL").locator(".item-open").click();
  await logSetsAsPlanned(page, 1);

  // Next week, ticked: the log screen shows last time for the backpack version.
  await page.goto(`/?date=${WEEK_2_DAY_4}`);
  await noEquipmentBox(page, "Single-leg RDL").check();
  await todayRow(page, "Backpack single-leg RDL").locator(".item-open").click();
  await expect(page.getByRole("heading", { name: "Backpack single-leg RDL" })).toBeVisible();
  await expect(page.locator(".log-last-time")).toContainText("Last time (5 Nov)");

  // Unticked, the plain RDL has no last time from 5 Nov.
  await page.goto(`/?date=${WEEK_2_DAY_4}`);
  await noEquipmentBox(page, "Single-leg RDL").uncheck();
  await todayRow(page, "Single-leg RDL").locator(".item-open").click();
  await expect(page.getByRole("heading", { name: "Single-leg RDL" })).toBeVisible();
  await expect(page.locator(".log-last-time")).toHaveCount(0);
});

test("History names a swapped set by the swap", async ({ page }) => {
  await seedSettingsAndClock(page, WEEK_1_DAY_4);
  await page.goto(`/?date=${WEEK_1_DAY_4}`);

  await noEquipmentBox(page, "Single-leg RDL").check();
  await todayRow(page, "Backpack single-leg RDL").locator(".item-open").click();
  await logSetsAsPlanned(page, 2);

  await page.getByRole("link", { name: "History" }).click();
  const swappedEntry = page.locator(".history-session", { hasText: "5 Nov" }).locator(".history-exercise", { hasText: "Backpack single-leg RDL" });
  await expect(swappedEntry).toBeVisible();
  await expect(swappedEntry).toContainText("2 ×");
});

test("a swapped EMOM shows the swap's dose and its timer uses the swap", async ({ page }) => {
  await seedSettingsAndClock(page, WEEK_1_DAY_1);
  await page.goto(`/?date=${WEEK_1_DAY_1}`);

  await noEquipmentBox(page, "Pull-ups").check();

  const swappedRow = todayRow(page, "Inverted rows under a table");
  await expect(swappedRow.locator(".item-dose-main")).toHaveText("6–8 / min");
  await expect(swappedRow.locator(".item-dose-sub")).toHaveText("9 min");
  await expect(swappedRow).toContainText("Instead of Pull-ups");

  await page.getByRole("button", { name: "Start EMOM, Inverted rows under a table" }).click();
  const overlay = page.getByRole("dialog", { name: "Inverted rows under a table EMOM timer" });
  await expect(overlay).toBeVisible();
  await expect(overlay.locator(".timer-title")).toHaveText("Inverted rows under a table EMOM · 9 min");
});

test("with nothing ticked the day looks exactly as it always did", async ({ page }) => {
  await seedSettingsAndClock(page, WEEK_1_DAY_1);
  await page.goto(`/?date=${WEEK_1_DAY_1}`);

  await expect(todayRow(page, "Pull-ups").locator(".item-dose-main")).toHaveText("4 / min");
  await expect(todayRow(page, "Pull-ups").locator(".item-dose-sub")).toHaveText("9 min");
  await expect(todayRow(page, "Dips").locator(".item-dose-main")).toHaveText("2 × 7");
  await expect(todayRow(page, "Med ball slams").locator(".item-dose-main")).toHaveText("6 × 6");
  await expect(page.getByText("Instead of")).toHaveCount(0);
  await expect(page.getByText("Inverted rows under a table")).toHaveCount(0);
  await expect(noEquipmentBox(page, "Pull-ups")).not.toBeChecked();
});

test("a future preview date cannot be ticked", async ({ page }) => {
  // The real clock says 5 Nov, so 12 Nov is the future.
  await seedSettingsAndClock(page, WEEK_1_DAY_4);
  await page.goto(`/?date=${WEEK_2_DAY_4}`);

  await expect(todayRow(page, "Single-leg RDL")).toBeVisible();
  await expect(noEquipmentBox(page, "Single-leg RDL")).toBeDisabled();
});

test("deleting the only logged set unlocks the box, still ticked, and it can be unticked", async ({ page }) => {
  await seedSettingsAndClock(page, WEEK_1_DAY_4);
  await page.goto(`/?date=${WEEK_1_DAY_4}`);

  await noEquipmentBox(page, "Single-leg RDL").check();
  await todayRow(page, "Backpack single-leg RDL").locator(".item-open").click();
  await logSetsAsPlanned(page, 1);

  // Tap the logged set to edit it; deleting then asks for a second tap to confirm.
  await page.locator(".log-set-row", { hasText: "Set 1" }).click();
  await page.locator(".log-danger").click();
  await page.locator(".log-danger").click();
  await expect(page.locator(".log-set-logged")).toHaveCount(0);

  await page.getByRole("link", { name: "Today" }).first().click();
  await expect(noEquipmentBox(page, "Single-leg RDL")).toBeEnabled();
  await expect(noEquipmentBox(page, "Single-leg RDL")).toBeChecked();

  await noEquipmentBox(page, "Single-leg RDL").uncheck();
  await expect(todayRow(page, "Single-leg RDL")).not.toContainText("Backpack");
});

test("a set logged on the unticked original disables the box, leaves it unticked and shows no Instead of line", async ({ page }) => {
  await seedSettingsAndClock(page, WEEK_1_DAY_4);
  await page.goto(`/?date=${WEEK_1_DAY_4}`);

  await todayRow(page, "Single-leg RDL").locator(".item-open").click();
  await logSetsAsPlanned(page, 1);

  await page.getByRole("link", { name: "Today" }).first().click();
  await expect(noEquipmentBox(page, "Single-leg RDL")).toBeDisabled();
  await expect(noEquipmentBox(page, "Single-leg RDL")).not.toBeChecked();
  await expect(page.getByText("Instead of")).toHaveCount(0);
  await expect(noEquipmentBox(page, "Single-leg RDL")).toHaveAccessibleDescription(/sets are logged/);
});

test("a restored log with a swap set and no ticks shows the swap, checked and disabled", async ({ page }) => {
  await seedSettingsAndClock(page, WEEK_1_DAY_4);
  await page.addInitScript(() => {
    if (window.localStorage.getItem("explosive-endurance.log") === null) {
      window.localStorage.setItem(
        "explosive-endurance.log",
        JSON.stringify({
          version: 1,
          sessions: [
            {
              date: "2026-11-05",
              programWeek: 1,
              day: 4,
              sets: [{ exerciseId: "backpack_single_leg_rdl", blockPosition: 3, setNumber: 1, reps: 12, loggedAt: "2026-11-05T10:00:00.000Z" }],
            },
          ],
        }),
      );
    }
  });
  await page.goto(`/?date=${WEEK_1_DAY_4}`);

  await expect(todayRow(page, "Backpack single-leg RDL")).toBeVisible();
  await expect(noEquipmentBox(page, "Single-leg RDL")).toBeChecked();
  await expect(noEquipmentBox(page, "Single-leg RDL")).toBeDisabled();
});

test("a tick on a backfilled date older than two weeks survives a reload", async ({ page }) => {
  await seedSettingsAndClock(page, "2026-11-30");
  await page.goto(`/?date=${WEEK_1_DAY_4}`);

  await noEquipmentBox(page, "Single-leg RDL").check();
  await expect(todayRow(page, "Backpack single-leg RDL")).toBeVisible();

  await page.reload();
  await expect(todayRow(page, "Backpack single-leg RDL")).toBeVisible();
  await expect(noEquipmentBox(page, "Single-leg RDL")).toBeChecked();
});

test("a disabled box is described to screen readers: sets logged, or a future date", async ({ page }) => {
  await seedSettingsAndClock(page, WEEK_1_DAY_4);
  await page.goto(`/?date=${WEEK_1_DAY_4}`);

  await noEquipmentBox(page, "Single-leg RDL").check();
  await todayRow(page, "Backpack single-leg RDL").locator(".item-open").click();
  await logSetsAsPlanned(page, 1);
  await page.getByRole("link", { name: "Today" }).first().click();
  await expect(noEquipmentBox(page, "Single-leg RDL")).toHaveAccessibleDescription(/sets logged/);

  await page.goto(`/?date=${WEEK_2_DAY_4}`);
  await expect(noEquipmentBox(page, "Single-leg RDL")).toHaveAccessibleDescription(/future date/);
});
