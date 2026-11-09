import { expect, test, type Page } from "@playwright/test";

// Start 2 Nov 2026: week 3 Day 1 is 16 Nov, week 4 Day 1 is 23 Nov, week 8 Day 1 is 21 Dec.
const WEEK_3_DAY_1 = "2026-11-16";
const WEEK_3_DAY_2 = "2026-11-17";
const WEEK_4_DAY_1 = "2026-11-23";
const WEEK_8_DAY_1 = "2026-12-21";

const FATIGUE_KEY = "explosive-endurance.fatigue";

/**
 * Seeds settings (start 2 Nov, maxes 12 / 15) and, unless told otherwise, the
 * checks of weeks 1 and 2 in the stored (wire) format: best recent is
 * 2.34 m and 12 pull-ups. Only seeds when nothing is stored, so a reload
 * keeps what the app saved. (Week 3 has just two earlier weeks.)
 */
async function seedApp(page: Page, checks: object[] | undefined = undefined): Promise<void> {
  const previousChecks = checks ?? [
    { date: "2026-11-02", programWeek: 1, broadJumpMetres: 2.3, maxPullUps: 11, savedAt: "2026-11-02T07:00:00.000Z" },
    { date: "2026-11-09", programWeek: 2, broadJumpMetres: 2.34, maxPullUps: 12, savedAt: "2026-11-09T07:00:00.000Z" },
  ];
  await page.addInitScript(({ settings, fatigue }) => {
    if (window.localStorage.getItem("explosive-endurance.settings") === null) {
      window.localStorage.setItem("explosive-endurance.settings", JSON.stringify(settings));
      window.localStorage.setItem("explosive-endurance.fatigue", JSON.stringify(fatigue));
    }
  }, {
    settings: { version: 1, startDate: "2026-11-02", maxReps: { pull_up: 12, dip: 15 } },
    fatigue: { version: 1, checks: previousChecks },
  });
}

/**
 * Opens Today for `date` with the real clock set to that same day, so the
 * date is not a preview and saving is allowed (a `?date=` that differs from
 * the real today turns saving off).
 */
async function openOn(page: Page, date: string): Promise<void> {
  await page.clock.setFixedTime(new Date(`${date}T09:00:00`));
  await page.goto(`/?date=${date}`);
}

/** The element that has keyboard focus, as a tag name ("BODY" means focus was lost). */
async function focusedTag(page: Page): Promise<string> {
  return page.evaluate(() => document.activeElement?.tagName ?? "NONE");
}

/** The check-in card. */
function card(page: Page) {
  return page.locator(".checkin-card");
}

test("the card starts blank with best recent as a hint, the first tap starts from it, pills and warning follow, and the banner survives a reload until dismissed", async ({ page }) => {
  await seedApp(page);
  await openOn(page, WEEK_3_DAY_1);

  await expect(card(page).getByText("Week 3 · Weekly check-in")).toBeVisible();
  await expect(card(page).getByRole("heading", { name: "How are you tracking?" })).toBeVisible();
  await expect(card(page)).toContainText("Takes 2 minutes, before today's warm-up.");
  await expect(card(page)).toContainText("Best recent: 2.34 m");
  await expect(card(page)).toContainText("Best recent: 12 reps");
  // Nothing is pre-filled: both fields are blank, so there is nothing to save yet.
  await expect(card(page).locator('button[aria-label="Best broad jump"]')).toHaveText("—");
  await expect(card(page).locator('output[aria-label="Max pull-ups"]')).toHaveText("—");
  await expect(card(page).getByRole("button", { name: "Save check-in" })).toBeDisabled();
  await expect(card(page).getByRole("button", { name: /^Clear/ })).toHaveCount(0);
  await expect(card(page).locator(".checkin-warning")).toBeHidden();

  // The first tap on a blank stepper lands on the best recent value, then Clear goes back to blank.
  await card(page).getByRole("button", { name: "Increase Max pull-ups" }).click();
  await expect(card(page).locator('output[aria-label="Max pull-ups"]')).toHaveText("12");
  await card(page).getByRole("button", { name: "Clear Max pull-ups" }).click();
  await expect(card(page).locator('output[aria-label="Max pull-ups"]')).toHaveText("—");
  await expect(card(page).getByRole("button", { name: "Save check-in" })).toBeDisabled();

  // Type 2.31 m: -1%, green.
  await card(page).locator('button[aria-label="Best broad jump"]').click();
  await card(page).locator('input[aria-label="Best broad jump"]').fill("2.31");
  await card(page).locator('input[aria-label="Best broad jump"]').press("Enter");
  const jumpPill = card(page).locator(".checkin-pill").first();
  await expect(jumpPill).toHaveText("−1%");
  await expect(jumpPill).not.toHaveClass(/pill-warn/);

  // First tap lands on 12, two more taps down: 10 pull-ups, -17%, amber, with the warning.
  await card(page).getByRole("button", { name: "Decrease Max pull-ups" }).click();
  await card(page).getByRole("button", { name: "Decrease Max pull-ups" }).click();
  await card(page).getByRole("button", { name: "Decrease Max pull-ups" }).click();
  const pullUpPill = card(page).locator(".checkin-pill").nth(1);
  await expect(pullUpPill).toHaveText("−17%");
  await expect(pullUpPill).toHaveClass(/pill-warn/);
  await expect(card(page).locator(".checkin-warning")).toContainText("Pull-ups are down more than 10% this week.");
  await expect(card(page).locator(".checkin-warning")).toContainText("add a rest day or start the deload early");

  await card(page).getByRole("button", { name: "Save check-in" }).click();
  await expect(card(page)).toHaveCount(0);
  expect(await focusedTag(page)).not.toBe("BODY");

  const banner = page.locator(".drop-banner");
  await expect(banner).toContainText("Pull-ups are down more than 10% this week.");
  await expect(banner).toContainText("add a rest day or start the deload early");

  const stored = await page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? "null"), FATIGUE_KEY);
  const week3 = stored.checks.find((check: { programWeek: number }) => check.programWeek === 3);
  expect(week3).toMatchObject({ date: WEEK_3_DAY_1, broadJumpMetres: 2.31, maxPullUps: 10 });

  // Reload, and another day of the same week: still no card, banner still there.
  await page.reload();
  await expect(banner).toBeVisible();
  await expect(card(page)).toHaveCount(0);
  await openOn(page, WEEK_3_DAY_2);
  await expect(banner).toBeVisible();

  await banner.getByRole("button", { name: "Dismiss" }).click();
  await expect(page.locator(".drop-banner")).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("Week 3 of 8 · Day 2")).toBeVisible();
  await expect(page.locator(".drop-banner")).toHaveCount(0);

  // The next week asks again, and the old banner is gone with the old week.
  await openOn(page, WEEK_4_DAY_1);
  await expect(card(page).getByText("Week 4 · Weekly check-in")).toBeVisible();
  await expect(page.locator(".drop-banner")).toHaveCount(0);
});

test("Save check-in is disabled while both fields are blank, and a check with no drop shows no banner", async ({ page }) => {
  await seedApp(page, []);
  await openOn(page, WEEK_3_DAY_1);

  await expect(card(page)).not.toContainText("Best recent");
  await expect(card(page).locator('output[aria-label="Max pull-ups"]')).toHaveText("—");
  await expect(card(page).locator(".checkin-pill").first()).toBeHidden();
  await expect(card(page).getByRole("button", { name: "Save check-in" })).toBeDisabled();

  // No history: the first tap lands on the default (10).
  await card(page).getByRole("button", { name: "Increase Max pull-ups" }).click();
  await expect(card(page).locator('output[aria-label="Max pull-ups"]')).toHaveText("10");
  await expect(card(page).getByRole("button", { name: "Save check-in" })).toBeEnabled();
  await card(page).getByRole("button", { name: "Save check-in" }).click();

  await expect(card(page)).toHaveCount(0);
  await expect(page.locator(".drop-banner")).toHaveCount(0);
  const stored = await page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? "null"), FATIGUE_KEY);
  expect(stored.checks).toHaveLength(1);
  expect(stored.checks[0]).toMatchObject({ programWeek: 3, maxPullUps: 10 });
  expect(stored.checks[0].broadJumpMetres).toBeUndefined();
});

test("Remind me tomorrow hides the card for that date, also after a reload, and it returns the next day of the week", async ({ page }) => {
  await seedApp(page);
  await openOn(page, WEEK_3_DAY_1);

  await card(page).getByRole("button", { name: "Remind me tomorrow" }).click();
  await expect(card(page)).toHaveCount(0);
  expect(await focusedTag(page)).not.toBe("BODY");
  expect(await page.evaluate(() => window.localStorage.getItem("explosive-endurance.checkin-snoozed"))).toBe(WEEK_3_DAY_1);

  await page.reload();
  await expect(page.getByText("Week 3 of 8 · Day 1")).toBeVisible();
  await expect(card(page)).toHaveCount(0);

  await openOn(page, WEEK_3_DAY_2);
  await expect(card(page).getByText("Week 3 · Weekly check-in")).toBeVisible();
});

test("week 8 has no check-in card; saving the pull-up retest records that week's check", async ({ page }) => {
  await seedApp(page);
  await openOn(page, WEEK_8_DAY_1);

  await expect(page.locator(".retest-card")).toBeVisible();
  await expect(card(page)).toHaveCount(0);

  await page.getByRole("button", { name: "Increase Pull-ups max" }).click();
  await page.getByRole("button", { name: "Save max for Pull-ups" }).click();

  const stored = await page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? "null"), FATIGUE_KEY);
  const week8 = stored.checks.find((check: { programWeek: number }) => check.programWeek === 8);
  expect(week8).toMatchObject({ date: WEEK_8_DAY_1, maxPullUps: 13 });
  expect(week8.broadJumpMetres).toBeUndefined();
  expect(stored.checks).toHaveLength(3);
});

test("saving the week 8 retest keeps a broad jump already recorded for that week", async ({ page }) => {
  await seedApp(page, [
    { date: "2026-12-21", programWeek: 8, broadJumpMetres: 2.4, savedAt: "2026-12-21T07:00:00.000Z" },
  ]);
  await openOn(page, "2026-12-22");

  await page.getByRole("button", { name: "Save max for Pull-ups" }).click();

  const stored = await page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? "null"), FATIGUE_KEY);
  expect(stored.checks).toHaveLength(1);
  expect(stored.checks[0]).toMatchObject({ date: "2026-12-21", programWeek: 8, broadJumpMetres: 2.4, maxPullUps: 12 });
});

test("with history, saving only pull-ups stores a check with no broad jump (a blank is never a number)", async ({ page }) => {
  await seedApp(page);
  await openOn(page, WEEK_3_DAY_1);

  await card(page).getByRole("button", { name: "Increase Max pull-ups" }).click();
  await card(page).getByRole("button", { name: "Save check-in" }).click();
  await expect(card(page)).toHaveCount(0);

  const stored = await page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? "null"), FATIGUE_KEY);
  const week3 = stored.checks.find((check: { programWeek: number }) => check.programWeek === 3);
  expect(week3).toMatchObject({ maxPullUps: 12 });
  expect(week3.broadJumpMetres).toBeUndefined();
});

test("a typed broad jump can be emptied to go back to blank", async ({ page }) => {
  await seedApp(page);
  await openOn(page, WEEK_3_DAY_1);

  const jump = card(page).locator('button[aria-label="Best broad jump"]');
  await jump.click();
  await card(page).locator('input[aria-label="Best broad jump"]').fill("2.2");
  await card(page).locator('input[aria-label="Best broad jump"]').press("Enter");
  await expect(jump).toHaveText("2.20");

  await jump.click();
  await card(page).locator('input[aria-label="Best broad jump"]').fill("");
  await card(page).locator('input[aria-label="Best broad jump"]').press("Enter");
  await expect(jump).toHaveText("—");
  await expect(card(page).getByRole("button", { name: "Save check-in" })).toBeDisabled();
});

test("the tap-to-type button is at least 48px tall", async ({ page }) => {
  await seedApp(page);
  await openOn(page, WEEK_3_DAY_1);

  const box = await card(page).locator('button[aria-label="Best broad jump"]').boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
});

test("a preview of another date cannot save a check-in, in week 6 with the real date in week 2", async ({ page }) => {
  await seedApp(page);
  await page.clock.setFixedTime(new Date("2026-11-10T09:00:00")); // real date: week 2
  await page.goto("/?date=2026-12-07"); // preview: week 6 Day 1

  await expect(page.getByText("Week 6 of 8 · Day 1")).toBeVisible();
  await expect(card(page)).toContainText("Previewing — saving is off on this date.");
  await card(page).getByRole("button", { name: "Increase Max pull-ups" }).click();
  await expect(card(page).getByRole("button", { name: "Save check-in" })).toBeDisabled();
  await expect(card(page).getByRole("button", { name: "Remind me tomorrow" })).toHaveCount(0);

  const stored = await page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? "null"), FATIGUE_KEY);
  expect(stored.checks).toHaveLength(2);
});

test("if another copy already saved this week's check, saving keeps it and the card goes", async ({ page }) => {
  await seedApp(page);
  await openOn(page, WEEK_3_DAY_1);
  await card(page).getByRole("button", { name: "Increase Max pull-ups" }).click();

  // Another tab saves week 3's check while this card is open.
  await page.evaluate((key) => {
    const stored = JSON.parse(window.localStorage.getItem(key) ?? "null");
    stored.checks.push({ date: "2026-11-16", programWeek: 3, broadJumpMetres: 2.5, savedAt: "2026-11-16T07:00:00.000Z" });
    window.localStorage.setItem(key, JSON.stringify(stored));
  }, FATIGUE_KEY);

  await card(page).getByRole("button", { name: "Save check-in" }).click();
  await expect(card(page)).toHaveCount(0);
  await expect(page.locator(".toast")).toHaveText("Already saved on another screen");

  const stored = await page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? "null"), FATIGUE_KEY);
  const week3 = stored.checks.find((check: { programWeek: number }) => check.programWeek === 3);
  expect(week3).toMatchObject({ broadJumpMetres: 2.5 });
  expect(week3.maxPullUps).toBeUndefined();
});

test("changing the start date in Settings moves the checks to their new weeks: the card and Best recent follow", async ({ page }) => {
  // 2 Nov holds the best figures, so they only count while 2 Nov is inside the program.
  await seedApp(page, [
    { date: "2026-11-02", programWeek: 1, broadJumpMetres: 2.5, maxPullUps: 14, savedAt: "2026-11-02T07:00:00.000Z" },
    { date: "2026-11-09", programWeek: 2, broadJumpMetres: 2.34, maxPullUps: 12, savedAt: "2026-11-09T07:00:00.000Z" },
  ]);
  await openOn(page, WEEK_3_DAY_1);
  await expect(card(page).getByText("Week 3 · Weekly check-in")).toBeVisible();
  await expect(card(page)).toContainText("Best recent: 2.50 m");
  await expect(card(page)).toContainText("Best recent: 14");

  // Start the program a week later: 16 Nov becomes week 2 and 2 Nov is before the start.
  await page.goto(`/?date=${WEEK_3_DAY_1}#/settings`);
  await page.getByLabel("Start date").fill("2026-11-09");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator(".toast")).toHaveText("Saved");

  await expect(card(page).getByText("Week 2 · Weekly check-in")).toBeVisible();
  await expect(card(page)).toContainText("Best recent: 2.34 m");
  await expect(card(page)).toContainText("Best recent: 12");
  await expect(card(page)).not.toContainText("2.50");

  // The old checks are still stored (the one before the start is kept, not deleted).
  const stored = await page.evaluate(() => JSON.parse(window.localStorage.getItem("explosive-endurance.fatigue") ?? "null"));
  expect(stored.checks).toHaveLength(2);
});
