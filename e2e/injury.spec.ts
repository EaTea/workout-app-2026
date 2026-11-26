import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

// The real "today" is fixed at 22 Nov 2026; the program started on 2 Nov.
const TODAY = "2026-11-22";

/** Fixes the clock at noon on `TODAY` and seeds Explosive Endurance settings. */
async function seedExplosiveEndurance(page: Page): Promise<void> {
  await page.clock.install({ time: new Date(`${TODAY}T12:00:00`) });
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "explosive-endurance.settings",
      JSON.stringify({ version: 2, startDate: "2026-11-02", maxReps: { pull_up: 12, dip: 15 }, maxSavedOn: {} }),
    );
  });
}

/**
 * Fixes the clock at noon on `date`, seeds Explosive Endurance settings and,
 * when `flagged`, an open right-shoulder injury that started on 1 Nov (so
 * every date used below is inside it; flagging in Settings would start it on
 * the real date, which is the date's own day at best).
 */
async function seedOnDate(page: Page, date: string, flagged: boolean): Promise<void> {
  await page.clock.install({ time: new Date(`${date}T12:00:00`) });
  await page.addInitScript((isFlagged) => {
    window.localStorage.setItem(
      "explosive-endurance.settings",
      JSON.stringify({ version: 2, startDate: "2026-11-02", maxReps: { pull_up: 12, dip: 15 }, maxSavedOn: {} }),
    );
    if (isFlagged && window.localStorage.getItem("explosive-endurance.injuries") === null) {
      window.localStorage.setItem(
        "explosive-endurance.injuries",
        JSON.stringify({ version: 1, injuries: [{ area: "shoulder", side: "right", from: "2026-11-01" }] }),
      );
    }
  }, flagged);
}

/** Flags the right shoulder in Settings and closes the sheet that opens. */
async function flagRightShoulder(page: Page): Promise<void> {
  await page.goto("/#/settings");
  await page.getByLabel("Side").selectOption("right");
  await page.getByLabel("Note (optional)").fill("Fell on it on a rest day");
  await page.getByRole("button", { name: "Flag it" }).click();

  const sheet = page.getByRole("dialog", { name: "Get your shoulder checked" });
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText("It popped, slipped out or changed shape, or you fell on it.");
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(sheet).toHaveCount(0);
}

test("flagging the right shoulder shows the sheet, then a banner on Today that survives a reload; clearing removes it", async ({ page }) => {
  await seedExplosiveEndurance(page);
  await flagRightShoulder(page);

  // Settings now shows the flag, the note and the way to clear it.
  await expect(page.locator(".injury-section")).toContainText("Right shoulder · since 22 Nov");
  await expect(page.locator(".injury-section")).toContainText("Fell on it on a rest day");

  await page.goto("/#/today");
  const banner = page.locator(".injury-banner");
  await expect(banner).toContainText("Right shoulder · since 22 Nov");
  await expect(banner).toContainText("Pain-free only.");

  await page.reload();
  await expect(page.locator(".injury-banner")).toContainText("Right shoulder · since 22 Nov");

  // The banner's button opens the same sheet.
  await page.locator(".injury-banner").getByRole("button", { name: "When to get it checked" }).click();
  await expect(page.getByRole("dialog", { name: "Get your shoulder checked" })).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();

  // Clearing asks first, in words that make no medical claim.
  await page.goto("/#/settings");
  await page.getByRole("button", { name: "My shoulder feels OK" }).click();
  await expect(page.locator(".injury-confirm")).toContainText("The app can't tell whether your shoulder is ready.");
  await page.getByRole("button", { name: "Yes, clear it" }).click();

  await expect(page.locator(".injury-section")).toContainText("Past injuries");
  await page.goto("/#/today");
  await expect(page.locator(".injury-banner")).toHaveCount(0);
});

test("Today's I'm injured link leads to the Injury section", async ({ page }) => {
  await seedExplosiveEndurance(page);
  await page.goto("/#/today");

  await page.getByRole("link", { name: "I'm injured" }).click();

  await expect(page).toHaveURL(/#\/settings$/);
  await expect(page.getByRole("heading", { name: "Flag an injury" })).toBeVisible();
});

test("Steady Strength has no Injury section and no I'm injured link", async ({ page }) => {
  await page.clock.install({ time: new Date(`${TODAY}T12:00:00`) });
  await page.addInitScript(() => {
    window.localStorage.setItem("workout-app.active-program", JSON.stringify({ version: 1, programId: "steady-strength" }));
    window.localStorage.setItem("steady-strength.settings", JSON.stringify({ version: 2, startDate: "2026-11-02", maxReps: {}, maxSavedOn: {} }));
  });

  await page.goto("/#/today");
  await expect(page.locator(".app-main h1, .app-main .card-title").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "I'm injured" })).toHaveCount(0);

  await page.goto("/#/settings");
  await expect(page.getByLabel("Start date")).toBeVisible();
  await expect(page.locator(".injury-section")).toHaveCount(0);
});


// 23 Nov is week 4 Day 1 (a deload week), 25 Nov is Day 3 and 26 Nov is Day 4.
const WEEK_4_DAY_1 = "2026-11-23";
const WEEK_4_DAY_3 = "2026-11-25";
const WEEK_4_DAY_4 = "2026-11-26";

test("Day 1 with the shoulder flagged: pull-ups left out, a stand-in, pain-free Pallof press, and Add it back", async ({ page }) => {
  await seedOnDate(page, WEEK_4_DAY_1, true);
  await page.goto(`/?date=${WEEK_4_DAY_1}#/today`);

  // Left out: one compact line, no controls, no No-equipment tick.
  const pullUps = page.locator(".item-row", { hasText: "Pull-ups" });
  await expect(pullUps).toContainText("Left out for your shoulder");
  await expect(pullUps.getByRole("button", { name: /Start EMOM/ })).toHaveCount(0);
  await expect(pullUps.getByRole("checkbox")).toHaveCount(0);

  // The boxing block says it is left out instead of asking "Boxing today?".
  await expect(page.getByText("Boxing left out for your shoulder")).toBeVisible();
  await expect(page.getByText("Boxing today?")).toHaveCount(0);

  // The stand-in reads like a swapped row, with no No-equipment tick of its own.
  const lyingLegRaise = page.locator(".item-row", { hasText: "Lying leg raise" });
  await expect(lyingLegRaise).toContainText("Instead of Hanging leg raise");
  await expect(lyingLegRaise.getByRole("checkbox")).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: /Hanging leg raise/ })).toHaveCount(0);

  // A kept caution row says pain-free only.
  await expect(page.locator(".item-row", { hasText: "Pallof press" })).toContainText("Pain-free only");

  // Add it back: the pull-ups come back at the halved dose (the deload week's 5 min, halved) with Start EMOM.
  const addBack = pullUps.getByRole("button", { name: "Add it back, Pull-ups" });
  expect(await addBack.boundingBox().then((box) => box?.height ?? 0)).toBeGreaterThanOrEqual(48);
  await addBack.click();

  const addedBackRow = page.locator(".item-row", { hasText: "Pull-ups" });
  await expect(addedBackRow).toContainText("3 min");
  await expect(addedBackRow).toContainText("Pain-free only");
  await expect(addedBackRow).not.toContainText("Left out");
  await expect(addedBackRow.getByRole("button", { name: /Start EMOM/ })).toBeVisible();

  // The choice survives a reload.
  await page.reload();
  await expect(page.locator(".item-row", { hasText: "Pull-ups" })).toContainText("3 min");
});

test("a future preview date can't add a left-out item back", async ({ page }) => {
  await seedOnDate(page, TODAY, true);
  await page.goto(`/?date=${WEEK_4_DAY_1}#/today`);

  await expect(page.locator(".item-row", { hasText: "Pull-ups" })).toContainText("Left out for your shoulder");
  await expect(page.getByRole("button", { name: "Add it back, Pull-ups" })).toHaveCount(0);
});

test("a left-out item's log screen says there is nothing to log", async ({ page }) => {
  await seedOnDate(page, WEEK_4_DAY_1, true);
  await page.goto(`/?date=${WEEK_4_DAY_1}#/log/${WEEK_4_DAY_1}/3/pull_up`);

  await expect(page.getByText("Nothing to log here")).toBeVisible();
});

test("Day 3 with the shoulder flagged is the shoulder-free session", async ({ page }) => {
  await seedOnDate(page, WEEK_4_DAY_3, true);
  await page.goto(`/?date=${WEEK_4_DAY_3}#/today`);

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Shoulder-free session · instead of Day 3 (Upper: push)");
  await expect(page.locator(".item-row", { hasText: "Dead bug, legs only" })).toBeVisible();
  await expect(page.getByText("Left out for your shoulder")).toHaveCount(0);
});

test("Day 4 with the shoulder flagged swaps kettlebell swings for broad jumps, which log and stay after a reload", async ({ page }) => {
  await seedOnDate(page, WEEK_4_DAY_4, true);
  await page.goto(`/?date=${WEEK_4_DAY_4}#/today`);

  const broadJumps = page.locator(".item-row", { hasText: "Broad jumps, hands on hips" });
  await expect(broadJumps).toContainText("Instead of Kettlebell swings");

  await broadJumps.locator(".item-open").click();
  await expect(page.getByRole("heading", { name: "Broad jumps, hands on hips" })).toBeVisible();
  await page.getByRole("button", { name: /Log set/ }).first().click();

  await page.goto(`/?date=${WEEK_4_DAY_4}#/today`);
  await page.reload();
  const afterReload = page.locator(".item-row", { hasText: "Broad jumps, hands on hips" });
  await expect(afterReload).toContainText("Instead of Kettlebell swings");
  await expect(afterReload).toContainText("1/");
});

test("the same dates are unchanged without the flag", async ({ page }) => {
  await seedOnDate(page, WEEK_4_DAY_1, false);
  await page.goto(`/?date=${WEEK_4_DAY_1}#/today`);

  await expect(page.locator(".item-row", { hasText: "Pull-ups" })).toContainText("EMOM");
  await expect(page.getByText("Left out for your shoulder")).toHaveCount(0);
  await expect(page.getByText("Pain-free only")).toHaveCount(0);
  await expect(page.locator(".item-row", { hasText: "Hanging leg raise" }).getByRole("checkbox")).toBeVisible();
  await expect(page.getByText("Boxing today?")).toBeVisible();

  await page.goto(`/?date=${WEEK_4_DAY_3}#/today`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Upper: push");
});

test("Add it back on the boxing block moves focus to its first added-back row", async ({ page }) => {
  await seedOnDate(page, WEEK_4_DAY_1, true);
  await page.goto(`/?date=${WEEK_4_DAY_1}#/today`);

  await expect(page.getByText("Boxing left out for your shoulder")).toBeVisible();
  await page.getByRole("button", { name: /Add it back, Boxing/ }).click();

  // The tapped button is gone; focus lands on the first row of the block that came back.
  await expect(page.getByText("Boxing left out for your shoulder")).toHaveCount(0);
  const boxingRow = page.locator(".item-row", { hasText: "Pain-free only" }).filter({ has: page.locator(".item-open") }).last();
  await expect(boxingRow.locator(".item-open")).toBeFocused();
});

test("after the flag is cleared the pull-ups row says First time back; Half sets today halves it and survives a reload", async ({ page }) => {
  // 30 Nov is W5 D1 and the day the shoulder was cleared; the injury ran from 22 Nov.
  await page.clock.install({ time: new Date("2026-11-30T12:00:00") });
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "explosive-endurance.settings",
      JSON.stringify({ version: 2, startDate: "2026-11-02", maxReps: { pull_up: 12, dip: 15 }, maxSavedOn: {} }),
    );
    if (window.localStorage.getItem("explosive-endurance.injuries") === null) {
      window.localStorage.setItem(
        "explosive-endurance.injuries",
        JSON.stringify({ version: 1, injuries: [{ area: "shoulder", side: "right", from: "2026-11-22", to: "2026-11-30" }] }),
      );
    }
  });
  await page.goto("/#/today");

  // Everything is back as written; the pull-ups row is marked, with the full EMOM.
  const pullUps = page.locator(".item-row", { hasText: "Pull-ups" });
  await expect(pullUps).toContainText("First time back · pain-free only");
  await expect(pullUps).toContainText("9 min");
  await expect(page.getByText("Left out for your shoulder")).toHaveCount(0);

  await pullUps.getByRole("button", { name: "Half sets today, Pull-ups" }).click();

  const halved = page.locator(".item-row", { hasText: "Pull-ups" });
  await expect(halved).toContainText("5 min");
  await expect(halved).toContainText("First time back · pain-free only");
  await expect(halved).toContainText("Sets halved today");
  await expect(halved.getByRole("button", { name: "Half sets today, Pull-ups" })).toHaveCount(0);

  await page.reload();
  await expect(page.locator(".item-row", { hasText: "Pull-ups" })).toContainText("5 min");
});

// 16 Nov is week 3 Day 1: a check-in is due and the right shoulder (flagged from 1 Nov) is flagged.
const WEEK_3_DAY_1 = "2026-11-16";

test("the weekly check-in skips pull-ups while the shoulder is flagged, keeps the broad jump and saves no pull-up value", async ({ page }) => {
  await seedOnDate(page, WEEK_3_DAY_1, true);
  await page.goto(`/?date=${WEEK_3_DAY_1}#/today`);

  const card = page.locator(".checkin-card");
  await expect(card).toContainText("Skip while your shoulder is flagged");
  await expect(card.getByRole("group", { name: "Max pull-ups" })).toHaveCount(0);
  await expect(card.getByText("Best broad jump")).toBeVisible();

  // Save is disabled until the jump has a value; then only the jump is stored.
  await expect(card.getByRole("button", { name: "Save check-in" })).toBeDisabled();
  await card.getByRole("button", { name: "Increase Best broad jump" }).click();
  await card.getByRole("button", { name: "Save check-in" }).click();

  const stored = await page.evaluate(() => JSON.parse(window.localStorage.getItem("explosive-endurance.fatigue") ?? "null"));
  expect(stored.checks).toHaveLength(1);
  expect(stored.checks[0].broadJumpMetres).toBeGreaterThan(0);
  expect(stored.checks[0].maxPullUps).toBeUndefined();
});

test("the weekly check-in still asks for pull-ups without the flag", async ({ page }) => {
  await seedOnDate(page, WEEK_3_DAY_1, false);
  await page.goto(`/?date=${WEEK_3_DAY_1}#/today`);

  const card = page.locator(".checkin-card");
  await expect(card.getByText("Skip while your shoulder is flagged")).toHaveCount(0);
  await expect(card.getByText("Max pull-ups")).toBeVisible();
});

test("History tags a flagged day with logged sets: Right shoulder, what was left out and what stood in", async ({ page }) => {
  await seedOnDate(page, TODAY, true);
  await page.addInitScript(() => {
    if (window.localStorage.getItem("explosive-endurance.log") === null) {
      window.localStorage.setItem(
        "explosive-endurance.log",
        JSON.stringify({
          version: 1,
          sessions: [
            { date: "2026-11-02", programWeek: 1, day: 1, sets: [{ exerciseId: "med_ball_slam", blockPosition: 2, setNumber: 1, reps: 6, loggedAt: "2026-11-02T18:00:00.000Z" }] },
          ],
        }),
      );
    }
  });
  await page.goto("/#/history");

  const dayCard = page.locator(".history-session", { hasText: "2 Nov" });
  await expect(dayCard.locator(".history-injury-tag")).toHaveText("Right shoulder");
  await expect(dayCard).toContainText("Left out:");
  await expect(dayCard).toContainText("Pull-ups");
  await expect(dayCard).toContainText("Lying leg raise instead of Hanging leg raise");
});

test("History shows no shoulder tag on a day before the flag", async ({ page }) => {
  await seedOnDate(page, TODAY, false);
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "explosive-endurance.log",
      JSON.stringify({
        version: 1,
        sessions: [{ date: "2026-11-02", programWeek: 1, day: 1, sets: [{ exerciseId: "med_ball_slam", blockPosition: 2, setNumber: 1, reps: 6, loggedAt: "2026-11-02T18:00:00.000Z" }] }],
      }),
    );
  });
  await page.goto("/#/history");

  await expect(page.locator(".history-session", { hasText: "2 Nov" })).toBeVisible();
  await expect(page.locator(".history-injury-tag")).toHaveCount(0);
});

test("export then import restores the injury", async ({ page }, testInfo) => {
  // Seed once per tab session, so removing the injury below is not undone by the reload.
  await page.clock.install({ time: new Date(`${TODAY}T12:00:00`) });
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("seeded") !== null) return;
    window.sessionStorage.setItem("seeded", "yes");
    window.localStorage.setItem("explosive-endurance.settings", JSON.stringify({ version: 2, startDate: "2026-11-02", maxReps: { pull_up: 12, dip: 15 }, maxSavedOn: {} }));
    window.localStorage.setItem("explosive-endurance.injuries", JSON.stringify({ version: 1, injuries: [{ area: "shoulder", side: "right", from: "2026-11-01" }] }));
  });
  await page.goto("/#/settings");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export everything as JSON" }).click();
  const file = testInfo.outputPath("export.json");
  await (await downloadPromise).saveAs(file);
  expect(JSON.parse(readFileSync(file, "utf-8")).injuries.injuries).toEqual([{ area: "shoulder", side: "right", from: "2026-11-01" }]);

  // Forget the injury (and everything else), then import the file.
  await page.evaluate(() => {
    window.localStorage.removeItem("explosive-endurance.injuries");
  });
  await page.goto("/#/today");
  await page.reload();
  await expect(page.locator(".injury-banner")).toHaveCount(0);

  await page.goto("/#/settings");
  await page.getByLabel("Import from JSON").setInputFiles(file);
  await page.getByRole("button", { name: "Replace my data" }).click();
  await page.getByRole("button", { name: "Yes, replace my data" }).click();
  await expect(page.locator(".toast")).toContainText("Imported");

  await page.goto("/#/today");
  await expect(page.locator(".injury-banner")).toContainText("Right shoulder · since 1 Nov");
});

test("the week 8 retest holds pull-ups and dips back while the shoulder is flagged, and keeps the jump", async ({ page }) => {
  const weekEightDayOne = "2026-12-21";
  await seedOnDate(page, weekEightDayOne, true);
  await page.goto(`/?date=${weekEightDayOne}#/today`);

  const card = page.locator(".retest-card");
  await expect(card).toContainText("Pull-ups and dips aren't retested while your shoulder is flagged or in its first two weeks back.");
  await expect(card.getByRole("button", { name: /Save max/ })).toHaveCount(0);
  await expect(card.getByText("Best broad jump")).toBeVisible();
  await expect(card.getByRole("button", { name: "Skip jump" })).toBeVisible();
});

test("week 5 Day 1 with the shoulder flagged: the rotated-in Ab raises (hanging raises) are left out", async ({ page }) => {
  await seedOnDate(page, "2026-11-30", true);
  await page.goto("/?date=2026-11-30#/today");

  const abRaises = page.locator(".item-row", { hasText: "Ab raises" });
  await expect(abRaises).toContainText("Left out for your shoulder");
  await expect(abRaises.getByRole("button", { name: "Add it back, Ab raises" })).toBeVisible();
});
