import { expect, test, type BrowserContext, type Page } from "@playwright/test";

/** Saves settings the way the app stores them, before the app first loads (in every page of a context, if given one). */
async function seedStoredSettings(page: Page | BrowserContext): Promise<void> {
  await page.addInitScript((settings) => {
    window.localStorage.setItem("explosive-endurance.settings", JSON.stringify(settings));
  }, { version: 1, startDate: "2026-11-02", maxReps: { pull_up: 12, dip: 15 } });
}

/**
 * Seeds the settings and fixes the real clock at 9 Nov 2026, so a `?date=`
 * preview of 9 Nov (or earlier) can be logged to and 16 Nov is "the future"
 * whenever the tests run (the app refuses to log to dates after the real today).
 */
async function seedSettings(page: Page | BrowserContext): Promise<void> {
  await seedStoredSettings(page);
  await page.clock.install({ time: new Date("2026-11-09T12:00:00") });
}

/** Saves a log with 6 x 6 at 6 kg of med ball slams on 2 Nov, in the stored (wire) format, before the app first loads. */
async function seedLastTimeLog(page: Page): Promise<void> {
  const sets = Array.from({ length: 6 }, (_unused, index) => ({
    exerciseId: "med_ball_slam", blockPosition: 2, setNumber: index + 1, reps: 6, loadKg: 6, loggedAt: "2026-11-02T18:00:00.000Z",
  }));
  await page.addInitScript((log) => {
    window.localStorage.setItem("explosive-endurance.log", JSON.stringify(log));
  }, { version: 1, sessions: [{ date: "2026-11-02", programWeek: 1, day: 1, sets }] });
}

/** Today's row for an exercise name. */
function row(page: Page, name: string) {
  return page.locator(".item-row", { hasText: name });
}

/** The rest timer overlay. */
function restTimer(page: Page) {
  return page.getByRole("dialog", { name: "Rest timer" });
}

/** The element that has keyboard focus, as a short description: its tag name, which is BODY when nothing has focus. */
async function focusedTagName(page: Page): Promise<string> {
  return page.evaluate(() => document.activeElement?.tagName ?? "NONE");
}

/** A set's row in the log screen's list, found by its label ("Set 2"). */
function setRow(page: Page, label: string) {
  return page.locator(".log-set-row", { hasText: label });
}

test("log two sets of med ball slams, with rest timers, and see them again after a reload", async ({ page }) => {
  await seedSettings(page);
  await page.goto("/?date=2026-11-09");

  await row(page, "Med ball slams").locator(".item-open").click();
  await expect(page.getByRole("heading", { name: "Med ball slams" })).toBeVisible();
  await expect(page.locator(".log-set-current")).toContainText("Set 1");
  await expect(page.getByLabel("reps", { exact: true })).toHaveText("6");

  // Steppers are thumb-sized.
  const increaseReps = page.getByRole("button", { name: "Increase reps" });
  const box = await increaseReps.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(48);
  expect(box?.height).toBeGreaterThanOrEqual(48);

  // Set 1 as planned: logging opens the rest timer, which closes again.
  await page.getByRole("button", { name: "✓ Log set · rest 0:30" }).click();
  await expect(restTimer(page)).toBeVisible();

  // The rest is already running (no Start to tap, no stepper to adjust).
  await expect(restTimer(page).getByRole("button", { name: "❚❚ Pause" })).toBeVisible();
  await expect(restTimer(page).getByRole("button", { name: "Increase rest" })).toBeHidden();

  await restTimer(page).getByRole("button", { name: "✕ Close" }).click();
  await expect(restTimer(page)).toBeHidden();
  await expect(setRow(page, "Set 1")).toContainText("6 reps");

  // Closing the timer returns focus to the new current set, not the page.
  await expect(page.locator(".log-set-current .log-stepper-button").first()).toBeFocused();

  // Set 2: 7 reps, 5 kg (two 2.5 kg steps) and a note.
  await expect(page.locator(".log-set-current")).toContainText("Set 2");
  await increaseReps.click();
  for (let presses = 0; presses < 2; presses++) {
    await page.getByRole("button", { name: "Increase kg" }).click();
  }
  await page.getByRole("button", { name: "+ Add note" }).click();
  await page.getByLabel("Note").fill("felt fast");
  await page.getByRole("button", { name: "✓ Log set · rest 0:30" }).click();
  await expect(restTimer(page)).toBeVisible();
  await restTimer(page).getByRole("button", { name: "✕ Close" }).click();

  await expect(setRow(page, "Set 2")).toContainText("7 reps · 5 kg");
  await expect(setRow(page, "Set 2")).toContainText("felt fast");

  // Set 3 starts from set 2's numbers.
  await expect(page.locator(".log-set-current")).toContainText("Set 3");
  await expect(page.getByLabel("reps", { exact: true })).toHaveText("7");
  await expect(page.getByLabel("kg", { exact: true })).toHaveText("5");

  // Back on Today, the row shows progress.
  await page.getByRole("link", { name: "Back to Today", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Upper: pull" })).toBeVisible();
  await expect(row(page, "Med ball slams").locator(".item-progress")).toHaveText("2/6");

  // Still there after a reload.
  await page.reload();
  await expect(row(page, "Med ball slams").locator(".item-progress")).toHaveText("2/6");
  await row(page, "Med ball slams").locator(".item-open").click();
  await expect(setRow(page, "Set 1")).toContainText("6 reps");
  await expect(setRow(page, "Set 2")).toContainText("7 reps · 5 kg");
  await expect(setRow(page, "Set 2")).toContainText("felt fast");
});

test("edit a logged set, then delete one", async ({ page }) => {
  await seedSettings(page);
  await page.goto("/?date=2026-11-09#/log/2026-11-09/2/med_ball_slam");

  await page.getByRole("button", { name: "Skip" }).click();
  await expect(page.locator(".log-set-current")).toContainText("Set 2");
  await page.getByRole("button", { name: "Skip" }).click();
  await expect(page.locator(".log-set-current")).toContainText("Set 3");

  // Log sets 3 and 4 (the rest timer opens each time).
  for (let count = 0; count < 2; count++) {
    await page.getByRole("button", { name: /✓ Log set/ }).click();
    await restTimer(page).getByRole("button", { name: "✕ Close" }).click();
  }
  await expect(setRow(page, "Set 3")).toContainText("6 reps");
  await expect(setRow(page, "Set 4")).toContainText("6 reps");

  // Edit set 3 to 9 reps.
  await setRow(page, "Set 3").click();
  await expect(page.getByRole("button", { name: "✓ Save changes" })).toBeVisible();
  for (let presses = 0; presses < 3; presses++) {
    await page.getByRole("button", { name: "Increase reps" }).click();
  }
  await page.getByRole("button", { name: "✓ Save changes" }).click();
  await expect(setRow(page, "Set 3")).toContainText("9 reps");

  // Delete set 4: the first tap only arms the button, the second deletes.
  await setRow(page, "Set 4").click();
  await page.getByRole("button", { name: "Delete set" }).click();
  await expect(page.getByRole("button", { name: "Tap again to delete" })).toBeVisible();
  await expect(page.getByRole("button", { name: "✓ Save changes" })).toBeVisible();
  await page.getByRole("button", { name: "Tap again to delete" }).click();
  await expect(page.getByRole("button", { name: "✓ Save changes" })).toBeHidden();
  await expect(page.locator(".log-set-logged")).toHaveCount(1);

  // Redrawing after the delete must not leave focus on the page.
  expect(await focusedTagName(page)).not.toBe("BODY");

  await page.getByRole("link", { name: "Back to Today", exact: true }).click();
  await expect(row(page, "Med ball slams").locator(".item-progress")).toHaveText("1/6");
});

test("an armed delete button reverts after a few seconds", async ({ page }) => {
  await seedSettings(page);
  await page.goto("/?date=2026-11-09#/log/2026-11-09/2/med_ball_slam");
  await page.getByRole("button", { name: /✓ Log set/ }).click();
  await restTimer(page).getByRole("button", { name: "✕ Close" }).click();

  await setRow(page, "Set 1").click();
  await page.getByRole("button", { name: "Delete set" }).click();
  await expect(page.getByRole("button", { name: "Tap again to delete" })).toBeVisible();

  // The fake clock is controlled by the test: 4 seconds later the label is back.
  await page.clock.runFor(4100);
  await expect(page.getByRole("button", { name: "Delete set" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Tap again to delete" })).toHaveCount(0);

  // Nothing was deleted: the set is still logged.
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(setRow(page, "Set 1")).toContainText("6 reps");
});

test("log all as planned on an EMOM, and a complete item shows a tick on Today", async ({ page }) => {
  await seedSettings(page);
  await page.goto("/?date=2026-11-09");

  await row(page, "Pull-ups").locator(".item-open").click();
  await expect(page.locator(".log-set-row, .log-set-current")).toHaveCount(9);
  await page.getByRole("button", { name: "Log all as planned" }).click();

  // No rest timer for an EMOM; every minute is logged at the planned 5 reps.
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".log-set-logged")).toHaveCount(9);
  await expect(setRow(page, "Min 9")).toContainText("5 reps");
  await expect(page.getByText("All sets logged.")).toBeVisible();

  await page.getByRole("link", { name: "Back to Today", exact: true }).click();
  await expect(row(page, "Pull-ups").locator(".item-progress")).toHaveText("✓ 9/9");
});

test("heavy-bag rounds are just ticked, and a ?date= preview logs to that date", async ({ page }) => {
  await seedSettings(page);
  await page.goto("/?date=2026-11-09");

  await row(page, "Heavy bag").locator(".item-open").click();
  await expect(page.getByRole("button", { name: "Increase reps" })).toHaveCount(0);
  await page.getByRole("button", { name: "✓ Log set" }).click();
  await expect(setRow(page, "Round 1")).toContainText("Done");

  // No rest timer here, and the redraw must not drop focus to the page.
  expect(await focusedTagName(page)).not.toBe("BODY");

  const storedDates = await page.evaluate(() => {
    const stored = JSON.parse(window.localStorage.getItem("explosive-endurance.log") ?? "{}");
    return (stored.sessions ?? []).map((session: { date: string }) => session.date);
  });
  expect(storedDates).toEqual(["2026-11-09"]);

  // Another date has nothing logged.
  await page.goto("/?date=2026-11-16");
  await expect(row(page, "Heavy bag").locator(".item-progress")).toHaveCount(0);
});

test("an unknown item or a rest day shows 'Nothing to log here' with a way back", async ({ page }) => {
  await seedSettings(page);

  await page.goto("/?date=2026-11-09#/log/2026-11-09/9/nothing");
  await expect(page.getByRole("heading", { name: "Nothing to log here" })).toBeVisible();
  await page.getByRole("link", { name: "Back to Today", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Upper: pull" })).toBeVisible();

  await page.goto("/?date=2026-11-08#/log/2026-11-08/2/med_ball_slam");
  await expect(page.getByRole("heading", { name: "Nothing to log here" })).toBeVisible();
});

test("a failed save shows an inline error and keeps the set on screen", async ({ page }) => {
  await seedSettings(page);
  await page.goto("/?date=2026-11-09#/log/2026-11-09/2/med_ball_slam");

  await page.evaluate(() => {
    Storage.prototype.setItem = () => { throw new Error("quota"); };
  });
  await page.getByRole("button", { name: /✓ Log set/ }).click();
  await restTimer(page).getByRole("button", { name: "✕ Close" }).click();

  await expect(page.getByRole("alert")).toContainText("Couldn't save on this device");
  await expect(setRow(page, "Set 1")).toContainText("6 reps");
});

test("last time shows on the Today row and the log screen, and pre-fills the kg", async ({ page }) => {
  await seedSettings(page);
  await seedLastTimeLog(page);
  await page.goto("/?date=2026-11-09");

  const hint = "Last time (2 Nov): 6 × 6 at 6 kg";
  await expect(row(page, "Med ball slams").locator(".item-last-time")).toHaveText(hint);
  // Nothing for exercises never logged.
  await expect(row(page, "Pull-ups").locator(".item-last-time")).toHaveCount(0);

  await row(page, "Med ball slams").locator(".item-open").click();
  await expect(page.locator(".log-last-time")).toHaveText(hint);
  await expect(page.getByLabel("reps", { exact: true })).toHaveText("6");
  await expect(page.getByLabel("kg", { exact: true })).toHaveText("6");

  // The day itself shows no last time before the log's date.
  await page.goto("/?date=2026-11-02");
  await expect(row(page, "Med ball slams").locator(".item-last-time")).toHaveCount(0);
});

test("a log screen opened before midnight keeps logging to its own day afterwards", async ({ page }) => {
  await seedStoredSettings(page);
  await page.clock.install({ time: new Date("2026-11-09T23:50:00") });
  await page.goto("/");
  // Wait for the app to start before running the clock, or the interval it sets up would never fire.
  await expect(page.getByText("9 Nov · Week 2 of 8 · Day 1")).toBeVisible();

  await page.clock.runFor(15 * 60_000);
  await expect(page.getByText("It's a new day.")).toBeVisible();
  await expect(page.getByText("9 Nov · Week 2 of 8 · Day 1")).toBeVisible();

  // The row still opens the session it shows (9 Nov), not the new day's.
  await row(page, "Med ball slams").locator(".item-open").click();
  await expect(page.getByRole("heading", { name: "Med ball slams" })).toBeVisible();
  await expect(page).toHaveURL(/#\/log\/2026-11-09\/2\/med_ball_slam$/);

  await page.getByRole("button", { name: /✓ Log set/ }).click();
  await restTimer(page).getByRole("button", { name: "✕ Close" }).click();
  await expect(setRow(page, "Set 1")).toContainText("6 reps");

  const storedDates = await page.evaluate(() => {
    const stored = JSON.parse(window.localStorage.getItem("explosive-endurance.log") ?? "{}");
    return (stored.sessions ?? []).map((session: { date: string }) => session.date);
  });
  expect(storedDates).toEqual(["2026-11-09"]);

  // Back returns to the session on screen, still 9 Nov, with its banner.
  await page.getByRole("link", { name: "Back to Today", exact: true }).click();
  await expect(page.getByText("9 Nov · Week 2 of 8 · Day 1")).toBeVisible();
  await expect(row(page, "Med ball slams").locator(".item-progress")).toHaveText("1/6");
});

test("an old-form log address without a date falls back to Today", async ({ page }) => {
  await seedSettings(page);
  await page.goto("/?date=2026-11-09#/log/2/med_ball_slam");
  await expect(page.getByRole("heading", { name: "Upper: pull" })).toBeVisible();
});

test("two open copies of the app do not wipe each other's sets", async ({ context }) => {
  await seedSettings(context);
  const pageA = await context.newPage();
  const pageB = await context.newPage();
  await pageA.goto("/?date=2026-11-09");
  await pageB.goto("/?date=2026-11-09");
  await expect(pageA.getByRole("heading", { name: "Upper: pull" })).toBeVisible();
  await expect(pageB.getByRole("heading", { name: "Upper: pull" })).toBeVisible();

  // Copy A logs a med ball slam set.
  await row(pageA, "Med ball slams").locator(".item-open").click();
  await pageA.getByRole("button", { name: /✓ Log set/ }).click();
  await restTimer(pageA).getByRole("button", { name: "✕ Close" }).click();
  await expect(setRow(pageA, "Set 1")).toContainText("6 reps");

  // Copy B was opened before that, and logs a pull-up minute.
  await row(pageB, "Pull-ups").locator(".item-open").click();
  await pageB.getByRole("button", { name: /✓ Log set/ }).click();
  await expect(setRow(pageB, "Min 1")).toContainText("reps");

  const storedExercises = await pageB.evaluate(() => {
    const stored = JSON.parse(window.localStorage.getItem("explosive-endurance.log") ?? "{}");
    return (stored.sessions ?? []).flatMap((session: { sets: { exerciseId: string }[] }) => session.sets.map((set) => set.exerciseId));
  });
  expect(storedExercises.sort()).toEqual(["med_ball_slam", "pull_up"]);
});

test("kg moves in 2.5 steps, and tapping the value lets you type 22.5", async ({ page }) => {
  await seedSettings(page);
  await page.goto("/?date=2026-11-09#/log/2026-11-09/2/med_ball_slam");

  const kilograms = page.getByLabel("kg", { exact: true });
  await page.getByRole("button", { name: "Increase kg" }).click();
  await expect(kilograms).toHaveText("2.5");

  // Type a number: the field takes decimals, and Enter commits it.
  await kilograms.click();
  const field = page.getByLabel("kg", { exact: true });
  await expect(field).toHaveAttribute("inputmode", "decimal");
  await field.fill("22.5");
  await field.press("Enter");
  await expect(page.getByLabel("kg", { exact: true })).toHaveText("22.5");

  // An invalid entry reverts to what was there.
  await page.getByLabel("kg", { exact: true }).click();
  await page.getByLabel("kg", { exact: true }).fill("abc");
  await page.getByLabel("kg", { exact: true }).press("Enter");
  await expect(page.getByLabel("kg", { exact: true })).toHaveText("22.5");

  // The typed value is stored as is.
  await page.getByRole("button", { name: /✓ Log set/ }).click();
  await restTimer(page).getByRole("button", { name: "✕ Close" }).click();
  await expect(setRow(page, "Set 1")).toContainText("6 reps · 22.5 kg");
  await expect(page.getByLabel("kg", { exact: true })).toHaveText("22.5");
});

test("log all as planned keeps the edits made to the current set", async ({ page }) => {
  await seedSettings(page);
  await page.goto("/?date=2026-11-09#/log/2026-11-09/2/med_ball_slam");

  // Raise the current set to 8 reps and add a note, then log everything.
  await page.getByRole("button", { name: "Increase reps" }).click();
  await page.getByRole("button", { name: "Increase reps" }).click();
  await page.getByRole("button", { name: "+ Add note" }).click();
  await page.getByLabel("Note").fill("explosive");
  await page.getByRole("button", { name: "Log all as planned" }).click();

  await expect(page.locator(".log-set-logged")).toHaveCount(6);
  await expect(setRow(page, "Set 1")).toContainText("8 reps");
  await expect(setRow(page, "Set 1")).toContainText("explosive");
  // The others use their own pre-fill: each follows the set before it (8 reps), without its note.
  await expect(setRow(page, "Set 2")).toContainText("8 reps");
  await expect(setRow(page, "Set 2")).not.toContainText("explosive");
  expect(await focusedTagName(page)).not.toBe("BODY");
});

test("a ?date= preview shows a strip on Today and the log screen; past dates can be logged to", async ({ page }) => {
  await seedSettings(page);
  await page.goto("/?date=2026-11-02");

  const strip = page.locator(".preview-strip");
  await expect(strip).toHaveText("Previewing 2 Nov · back to today");

  await row(page, "Med ball slams").locator(".item-open").click();
  await expect(strip).toHaveText("Previewing 2 Nov · back to today");

  // A past date can be backfilled.
  await page.getByRole("button", { name: /✓ Log set/ }).click();
  await restTimer(page).getByRole("button", { name: "✕ Close" }).click();
  await expect(setRow(page, "Set 1")).toContainText("6 reps");

  // "back to today" leaves the preview: no strip on the real date.
  await strip.getByRole("link", { name: "back to today" }).click();
  await expect(page.locator(".preview-strip")).toHaveCount(0);
  await expect(page).not.toHaveURL(/date=/);
});

test("no strip without a ?date=", async ({ page }) => {
  await seedSettings(page);
  await page.goto("/");
  await expect(page.locator(".today-title, .message-card").first()).toBeVisible();
  await expect(page.locator(".preview-strip")).toHaveCount(0);
});

test("a future preview date cannot be logged to: the Log buttons are disabled with a message", async ({ page }) => {
  await seedSettings(page);
  await page.goto("/?date=2026-11-16");
  await expect(page.locator(".preview-strip")).toHaveText("Previewing 16 Nov · back to today");

  await row(page, "Med ball slams").locator(".item-open").click();
  await expect(page.getByText("This date is in the future, so nothing can be logged to it yet.")).toBeVisible();
  await expect(page.getByRole("button", { name: /✓ Log set/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Log all as planned" })).toBeDisabled();

  const storedLog = await page.evaluate(() => window.localStorage.getItem("explosive-endurance.log"));
  expect(storedLog).toBeNull();
});
