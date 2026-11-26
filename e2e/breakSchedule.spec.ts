import { expect, test, type Page } from "@playwright/test";

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
  await expect(page.getByLabel("Number of days (1 to 28)")).toHaveValue("7");
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
  await page.getByLabel("Number of days (1 to 28)").fill("40");
  await page.getByRole("button", { name: "Start break" }).click();

  await expect(page.locator(".break-section")).toContainText("A break must be a whole number of days from 1 to 28.");
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
