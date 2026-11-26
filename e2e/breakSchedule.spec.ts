import { expect, test, type Page } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";

/**
 * Break 1 step 2: the schedule skips a break. The break is seeded straight
 * into storage. Start 2 Nov, break 26 Nov to 3 Dec (3 Dec is the first day
 * back). Step 3's tests below take and end breaks through the screens instead.
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

// ---- Break 1 step 3: Today, Settings and History ----

// The real "today" is fixed at 26 Nov 2026 (W4 D4 of a program that started 2 Nov, with no break).
const TODAY = "2026-11-26";

/** Fixes the clock at noon on `TODAY` and seeds settings only (no break). */
async function seedTodayWithoutBreak(page: Page): Promise<void> {
  await page.clock.install({ time: new Date(`${TODAY}T12:00:00`) });
  await page.addInitScript(() => {
    window.localStorage.setItem("explosive-endurance.settings", JSON.stringify({ version: 1, startDate: "2026-11-02", maxReps: { pull_up: 12, dip: 15 } }));
  });
}

/** From Settings, starts a 7-day break (from today) with a note. */
async function startWeekBreakFromSettings(page: Page): Promise<void> {
  await page.goto("/#/settings");
  await page.getByRole("button", { name: "Take a break" }).click();
  await expect(page.getByLabel("Number of days (1 to 56)")).toHaveValue("7");
  await page.getByLabel("Note for the break (optional)").fill("Physio: rest the neck");
  await page.getByRole("button", { name: "Start break" }).click();
}

test("a break started in Settings shows on Today with its note and the day back", async ({ page }) => {
  await seedTodayWithoutBreak(page);
  await startWeekBreakFromSettings(page);

  await expect(page.locator(".break-section")).toContainText("On a break · Back on 3 Dec");
  await expect(page.locator(".break-section")).toContainText("Physio: rest the neck");

  await page.goto("/#/today");
  await expect(page.getByRole("heading", { name: "On a break" })).toBeVisible();
  await expect(page.getByText("Physio: rest the neck")).toBeVisible();
  await expect(page.getByText("Back on 3 Dec with Week 4, Day 4.")).toBeVisible();
  await expect(page.locator(".block-title")).toHaveCount(0);
});

test("the start form shows an inline error for too many days", async ({ page }) => {
  await seedTodayWithoutBreak(page);
  await page.goto("/#/settings");
  await page.getByRole("button", { name: "Take a break" }).click();
  await page.getByLabel("Number of days (1 to 56)").fill("60");
  await page.getByRole("button", { name: "Start break" }).click();

  await expect(page.locator(".break-section")).toContainText("A break must be a whole number of days from 1 to 56.");
});

test("Today's Take a break link goes to the Settings section", async ({ page }) => {
  await seedTodayWithoutBreak(page);
  await page.goto("/#/today");
  await page.getByRole("link", { name: "Take a break" }).first().click();

  await expect(page.getByRole("heading", { name: "Break from training" })).toBeVisible();
});

test("End the break today on Today brings back that day's session", async ({ page }) => {
  await seedTodayWithoutBreak(page);
  await startWeekBreakFromSettings(page);
  await page.goto("/#/today");

  await page.getByRole("button", { name: "End the break today" }).click();

  await expect(page.getByText("26 Nov · Week 4 of 8 · Day 4")).toBeVisible();
  await expect(page.getByRole("heading", { name: "On a break" })).toHaveCount(0);

  // The break started and ended on the same day leaves no trace in Settings.
  await page.goto("/#/settings");
  await expect(page.locator(".break-section")).not.toContainText("Past breaks");
});

test("End the break today in Settings ends it and lists it under past breaks the next day", async ({ page }) => {
  // Break 20 Nov to 27 Nov (last day off 26 Nov), ended from Settings on 26 Nov: it now runs 20 Nov to 25 Nov.
  await page.clock.install({ time: new Date(`${TODAY}T12:00:00`) });
  await page.addInitScript(() => {
    window.localStorage.setItem("explosive-endurance.settings", JSON.stringify({ version: 1, startDate: "2026-11-02", maxReps: { pull_up: 12, dip: 15 } }));
    window.localStorage.setItem("explosive-endurance.breaks", JSON.stringify({ version: 1, breaks: [{ from: "2026-11-20", to: "2026-11-27", note: "Sore neck" }] }));
  });
  await page.goto("/#/settings");
  await page.getByRole("button", { name: "End the break today" }).click();

  await expect(page.locator(".break-section")).toContainText("Past breaks");
  await expect(page.locator(".break-section")).toContainText("20 Nov to 25 Nov · Sore neck");
});

test("History shows the break as a line between the days either side of it", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-12-04T12:00:00") });
  await page.addInitScript(() => {
    window.localStorage.setItem("explosive-endurance.settings", JSON.stringify({ version: 1, startDate: "2026-11-02", maxReps: { pull_up: 12, dip: 15 } }));
    window.localStorage.setItem("explosive-endurance.breaks", JSON.stringify({ version: 1, breaks: [{ from: "2026-11-26", to: "2026-12-03", note: "Physio: rest the neck" }] }));
    const set = (exerciseId: string) => ({ exerciseId, blockPosition: 3, setNumber: 1, reps: 5, loggedAt: "2026-11-25T18:00:00.000Z" });
    window.localStorage.setItem("explosive-endurance.log", JSON.stringify({
      version: 1,
      sessions: [
        { date: "2026-11-25", programWeek: 4, day: 3, sets: [set("pull_up")] },
        { date: "2026-12-03", programWeek: 4, day: 4, sets: [set("dip")] },
      ],
    }));
  });
  await page.goto("/#/history");

  const breakLine = page.locator(".history-break");
  await expect(breakLine).toContainText("On a break · 26 Nov to 2 Dec");
  await expect(breakLine).toContainText("Physio: rest the neck");

  // Newest first: the 3 Dec card, then the break, then the 25 Nov card.
  const order = await page.locator(".history-session-header, .history-break-title").allTextContents();
  expect(order[0]).toContain("3 Dec");
  expect(order[1]).toContain("On a break");
  expect(order[2]).toContain("25 Nov");
});

test("a ?date= preview offers no way to end the break", async ({ page }) => {
  await seedSettingsAndBreak(page);
  await page.clock.install({ time: new Date(`${TODAY}T12:00:00`) });
  await page.goto("/?date=2026-11-28");

  await expect(page.getByRole("heading", { name: "On a break" })).toBeVisible();
  await expect(page.getByRole("button", { name: "End the break today" })).toHaveCount(0);
  await expect(page.getByText("Go back to today to end the break.")).toBeVisible();
});

// ---- Break 1 step 4: first session back ----

/** Fixes the clock at noon on `date` and seeds settings plus the 26 Nov to 3 Dec break. */
async function seedEndedBreakOn(page: Page, date: string): Promise<void> {
  await page.clock.install({ time: new Date(`${date}T12:00:00`) });
  await seedSettingsAndBreak(page);
}

test("the first day back after a 7-day break marks the rows 'First session back' and offers Half sets today", async ({ page }) => {
  await seedEndedBreakOn(page, "2026-12-03");
  await page.goto("/#/today");

  const swings = page.locator(".item-row", { hasText: "Kettlebell swings" });
  await expect(swings).toContainText("First session back · pain-free only");
  await expect(page.getByText("First time back")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Half sets today, Kettlebell swings" })).toBeVisible();
  await expect(page.locator(".item-row", { hasText: "Single-leg RDL" })).toContainText("First session back · pain-free only");
});

test("Half sets today on the first session back halves the row, as it does after an injury, and survives a reload", async ({ page }) => {
  await seedEndedBreakOn(page, "2026-12-03");
  await page.goto("/#/today");

  const swings = page.locator(".item-row", { hasText: "Kettlebell swings" });
  await expect(swings).toContainText("4 min");

  await swings.getByRole("button", { name: "Half sets today, Kettlebell swings" }).click();

  const halved = page.locator(".item-row", { hasText: "Kettlebell swings" });
  await expect(halved).toContainText("2 min");
  await expect(halved).toContainText("First session back · pain-free only");
  await expect(halved).toContainText("Sets halved today");
  await expect(halved.getByRole("button", { name: "Half sets today, Kettlebell swings" })).toHaveCount(0);

  await page.reload();
  await expect(page.locator(".item-row", { hasText: "Kettlebell swings" })).toContainText("2 min");
});

test("more than 14 days after the break no row says First session back", async ({ page }) => {
  await seedEndedBreakOn(page, "2026-12-18");
  await page.goto("/#/today");

  await expect(page.locator(".item-row").first()).toBeVisible();
  await expect(page.getByText("First session back")).toHaveCount(0);
});

// ---- Break 1 step 5: export and import ----

/** Fixes the clock at noon on `TODAY` and seeds the settings once (a guard in sessionStorage keeps a later clear from being undone by a reload). */
async function seedSettingsOnce(page: Page): Promise<void> {
  await page.clock.install({ time: new Date(`${TODAY}T12:00:00`) });
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("seeded") !== null) return;
    window.sessionStorage.setItem("seeded", "yes");
    window.localStorage.setItem("explosive-endurance.settings", JSON.stringify({ version: 1, startDate: "2026-11-02", maxReps: { pull_up: 12, dip: 15 } }));
  });
}

/** Starts a week's break in Settings, then exports everything as JSON to `path`. */
async function startBreakAndExportTo(page: Page, path: string): Promise<void> {
  await startWeekBreakFromSettings(page);
  await expect(page.locator(".break-section")).toContainText("On a break · Back on 3 Dec");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export everything as JSON" }).click();
  await (await downloadPromise).saveAs(path);
}

test("a break exported and imported into a clean app shows on Today and in Settings", async ({ page }, testInfo) => {
  await seedSettingsOnce(page);
  const file = testInfo.outputPath("export.json");
  await startBreakAndExportTo(page, file);
  expect(JSON.parse(readFileSync(file, "utf-8")).breaks).toEqual({ version: 1, breaks: [{ from: TODAY, to: "2026-12-03", note: "Physio: rest the neck" }] });

  // A clean app: everything cleared, only the program choice made again (as the picker would).
  await page.evaluate(() => {
    window.localStorage.clear();
    window.localStorage.setItem("workout-app.active-program", JSON.stringify({ version: 1, programId: "explosive-endurance" }));
  });
  await page.goto("/#/settings");
  await page.reload();
  await expect(page.locator(".break-section")).not.toContainText("On a break");

  await page.getByLabel("Import from JSON").setInputFiles(file);
  await expect(page.getByText("Breaks: 1 (replace yours)")).toBeVisible();
  await page.getByRole("button", { name: "Replace my data" }).click();
  await page.getByRole("button", { name: "Yes, replace my data" }).click();
  await expect(page.locator(".toast")).toContainText("Imported. You can undo it in Settings.");

  await expect(page.getByRole("heading", { name: "On a break" })).toBeVisible();
  await expect(page.getByText("Physio: rest the neck")).toBeVisible();

  await page.goto("/#/settings");
  await expect(page.locator(".break-section")).toContainText("On a break · Back on 3 Dec");
  await expect(page.locator(".break-section")).toContainText("Physio: rest the neck");
});

test("importing a file without a breaks section keeps the stored break", async ({ page }, testInfo) => {
  await seedSettingsOnce(page);
  const file = testInfo.outputPath("export.json");
  await startBreakAndExportTo(page, file);

  // An older export: the same file with no breaks section at all.
  const olderExport = JSON.parse(readFileSync(file, "utf-8"));
  delete olderExport.breaks;
  const olderFile = testInfo.outputPath("older.json");
  writeFileSync(olderFile, JSON.stringify(olderExport));

  await page.getByLabel("Import from JSON").setInputFiles(olderFile);
  await expect(page.getByText("Breaks: none in the file (yours are kept)")).toBeVisible();
  await page.getByRole("button", { name: "Replace my data" }).click();
  await page.getByRole("button", { name: "Yes, replace my data" }).click();
  await expect(page.locator(".toast")).toContainText("Imported. You can undo it in Settings.");

  await expect(page.getByRole("heading", { name: "On a break" })).toBeVisible();
  const storedBreaks = await page.evaluate(() => JSON.parse(window.localStorage.getItem("explosive-endurance.breaks") ?? "null"));
  expect(storedBreaks.breaks).toEqual([{ from: TODAY, to: "2026-12-03", note: "Physio: rest the neck" }]);
});

test("after logging a set today, a break starts tomorrow: Today keeps the trained session and Settings says so", async ({ page }) => {
  await seedTodayWithoutBreak(page);
  await page.goto("/");

  // Log one set of the first row, so today has a logged set.
  await page.locator(".item-row .item-open").first().click();
  await page.getByRole("button", { name: /^✓ Log set/ }).click();
  await page.getByRole("link", { name: "Back to Today" }).click();

  await page.goto("/#/settings");
  await page.getByRole("button", { name: "Take a break" }).click();
  await expect(page.locator(".break-start-note")).toHaveText("You've trained today, so the break starts tomorrow (27 Nov).");
  await page.getByRole("button", { name: "Start break" }).click();

  // The break is only "Coming up": it has not started, so it is not the running view.
  await expect(page.locator(".break-section")).toContainText("Coming up");
  await expect(page.locator(".break-section")).toContainText("27 Nov to 3 Dec");
  await expect(page.locator(".break-section")).not.toContainText("On a break ·");

  // Today still shows today's trained session (Week 4 Day 4).
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "On a break" })).toHaveCount(0);
  await expect(page.getByText("26 Nov · Week 4 of 8 · Day 4", { exact: true })).toBeVisible();
  await expect(page.locator(".item-row .item-progress").first()).toHaveText(/^1\//);
});

test("with nothing done today the form has no tomorrow note and the break starts today", async ({ page }) => {
  await seedTodayWithoutBreak(page);
  await page.goto("/#/settings");
  await page.getByRole("button", { name: "Take a break" }).click();

  await expect(page.locator(".break-start-note")).toHaveCount(0);
});

test("a coming break can be cancelled from the Coming up list", async ({ page }) => {
  await page.clock.install({ time: new Date(`${TODAY}T12:00:00`) });
  await page.addInitScript(() => {
    window.localStorage.setItem("explosive-endurance.settings", JSON.stringify({ version: 1, startDate: "2026-11-02", maxReps: { pull_up: 12, dip: 15 } }));
    window.localStorage.setItem("explosive-endurance.breaks", JSON.stringify({ version: 1, breaks: [{ from: "2026-11-27", to: "2026-12-04" }] }));
  });
  await page.goto("/#/settings");

  await expect(page.locator(".break-section")).toContainText("Coming up");
  await page.getByRole("button", { name: "Cancel the break 27 Nov to 3 Dec" }).click();

  await expect(page.locator(".break-section")).not.toContainText("Coming up");
  await expect(page.locator(".break-list")).toHaveCount(0);
});
