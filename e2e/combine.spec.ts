import { expect, test, type Page } from "@playwright/test";

/**
 * Combining two days on Today (PR 25): start date 2 Nov 2026, so 9 Nov is
 * week 2 day 1, 10 Nov day 2, 11 Nov day 3 and 12 Nov day 4.
 */

/** Saves settings before the app first loads and fixes the real clock at noon on `isoDate`, so that date is "today". */
async function seedAt(page: Page, isoDate: string): Promise<void> {
  await page.addInitScript((settings) => {
    window.localStorage.setItem("explosive-endurance.settings", JSON.stringify(settings));
  }, { version: 1, startDate: "2026-11-02", maxReps: { pull_up: 12, dip: 15 } });
  await page.clock.install({ time: new Date(`${isoDate}T12:00:00`) });
}

/** The stored (wire) log session for `date`, read from localStorage. */
async function storedSessionOn(page: Page, date: string) {
  return page.evaluate((wantedDate) => {
    const log = JSON.parse(window.localStorage.getItem("explosive-endurance.log") ?? "{}");
    return log.sessions?.find((session: { date: string }) => session.date === wantedDate);
  }, date);
}

/** Today's row for an exercise name. */
function row(page: Page, name: string) {
  return page.locator(".item-row", { hasText: name });
}

/** The rest timer overlay. */
function restTimer(page: Page) {
  return page.getByRole("dialog", { name: "Rest timer" });
}

test("9 Nov: add Day 2, see the merged blocks with day labels, log a Day 2 set, see it in History and on 10 Nov", async ({ page }) => {
  await seedAt(page, "2026-11-09");
  await page.goto("/");

  // Day 1 offers Day 2 only (no pair ends on Day 1), as a big button right under the header.
  const addDayTwo = page.getByRole("button", { name: "Short on time? Add Day 2 to today" });
  await expect(addDayTwo).toBeVisible();
  await expect(page.getByRole("button", { name: /Add missed/ })).toHaveCount(0);
  const box = await addDayTwo.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(48);
  // Short on time means no scrolling: the button is on the first screen, above the first block.
  expect(box!.y + box!.height).toBeLessThan(page.viewportSize()!.height);
  const firstBlockBox = await page.locator(".block-card").first().boundingBox();
  expect(box!.y).toBeLessThan(firstBlockBox!.y);

  await addDayTwo.click();

  // The header names both days, both focuses and the length.
  await expect(page.getByText("9 Nov · Week 2 of 8 · Day 1 + Day 2")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Upper: pull + Lower: knee" })).toBeVisible();
  await expect(page.getByText("~73 min · 9 blocks")).toBeVisible();

  // Merged order: both warm-ups, the explosive blocks as one alternate block, then each day's main work.
  await expect(page.locator(".block-title")).toHaveText([
    "1 · Warm-up · 2 rounds",
    "2 · Warm-up · 2 rounds",
    "3 · Explosive · alternate",
    "4 · Main strength · 9 min",
    "5 · Main strength · 9 min",
    "6 · Mini-dose",
    "7 · Mini-dose",
    "8 · Core · superset",
    "9 · Finisher",
  ]);
  await expect(page.locator(".combine-alternate-note")).toContainText("Alternate set by set");

  // Every row says which day it comes from.
  await expect(row(page, "Med ball slams").locator(".item-day-label")).toHaveText("D1");
  await expect(row(page, "Split-squat jumps").locator(".item-day-label")).toHaveText("D2");
  await expect(row(page, "Pull-ups").locator(".item-day-label")).toHaveText("D1");
  await expect(row(page, "Zercher").locator(".item-day-label")).toHaveText("D2");

  // The optional side plank is left out of the combined core block.
  await expect(row(page, "Side plank")).toHaveCount(0);

  // Undo is available while nothing is logged, and the combine survives a reload.
  await expect(page.getByRole("button", { name: "Undo combine" })).toBeVisible();
  await page.reload();
  await expect(page.getByText("9 Nov · Week 2 of 8 · Day 1 + Day 2")).toBeVisible();

  // Rows keep their rest buttons, and each row's log link names its own day.
  await expect(row(page, "Split-squat jumps").getByRole("button", { name: /^Rest \d+s/ })).toBeVisible();
  await row(page, "Split-squat jumps").locator(".item-open").click();
  await expect(page).toHaveURL(/#\/log\/2026-11-09\/2\/split_squat_jump\/day\/2$/);
  await expect(page.getByRole("heading", { name: "Split-squat jumps" })).toBeVisible();

  // Log one set of the Day 2 block 2 exercise (Day 1's block 2 is the slams).
  // An alternate block spends each rest on the other exercise, so logging a set does not start the rest timer.
  await expect(page.getByRole("button", { name: /^✓ Log set$/ })).toBeVisible();
  await page.getByRole("button", { name: /^✓ Log set/ }).click();
  await expect(restTimer(page)).toHaveCount(0);
  await expect(page.locator(".log-set-row", { hasText: "Set 1" })).toContainText("reps");

  // Back on Today: that row shows progress, Day 1's block 2 row does not, and Undo is gone.
  await page.getByRole("link", { name: "Back to Today" }).click();
  await expect(row(page, "Split-squat jumps").locator(".item-progress")).toHaveText("1/5");
  // The stored set carries its own day (Day 2) while the session keeps the date's day (Day 1).
  const storedSession = await storedSessionOn(page, "2026-11-09");
  expect(storedSession.day).toBe(1);
  expect(storedSession.sets.map((set: { exerciseId: string; day?: number; blockPosition: number }) => [set.exerciseId, set.day, set.blockPosition])).toEqual([["split_squat_jump", 2, 2]]);
  await expect(row(page, "Med ball slams").locator(".item-progress")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Undo combine" })).toHaveCount(0);

  // 10 Nov is Day 2's own date: a "done with" card and no session.
  await page.goto("/?date=2026-11-10");
  await expect(page.getByRole("heading", { name: "Day 2 done with Day 1 on 9 Nov" })).toBeVisible();
  await expect(page.locator(".block-title")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Add .*Day/ })).toHaveCount(0);

  // History files the set under both days.
  await page.getByRole("link", { name: /History/ }).click();
  await expect(page.locator(".history-session-header")).toHaveText(["9 Nov · Week 2 · Day 1 + Day 2"]);
  await expect(page.locator(".history-exercise", { hasText: "Split-squat jumps" })).toBeVisible();
});

test("the day plans by week note the combine on both days", async ({ page }) => {
  await seedAt(page, "2026-11-09");
  await page.goto("/");
  await page.getByRole("button", { name: "Short on time? Add Day 2 to today" }).click();

  await page.goto("/#/plan/1/2");
  await expect(page.getByText("Combined with Day 2 on 10 Nov")).toBeVisible();
  await page.goto("/#/plan/2/2");
  await expect(page.getByText("Combined with Day 1 on 9 Nov")).toBeVisible();
  await page.goto("/#/plan/3/2");
  await expect(page.locator(".combine-note")).toHaveCount(0);
});

test("undo before logging puts both days back", async ({ page }) => {
  await seedAt(page, "2026-11-09");
  await page.goto("/");

  await page.getByRole("button", { name: "Short on time? Add Day 2 to today" }).click();
  await expect(page.getByText("~73 min")).toBeVisible();

  await page.getByRole("button", { name: "Undo combine" }).click();

  // Day 1 alone again, offering Day 2 once more.
  await expect(page.getByText("9 Nov · Week 2 of 8 · Day 1", { exact: true })).toBeVisible();
  await expect(page.getByText("~50 min · 6 blocks")).toBeVisible();
  await expect(page.getByRole("button", { name: "Short on time? Add Day 2 to today" })).toBeVisible();

  // A normal session's sets do not store a day, exactly as before combining existed.
  await row(page, "Med ball slams").locator(".item-open").click();
  await page.getByRole("button", { name: /^✓ Log set/ }).click();
  await restTimer(page).getByRole("button", { name: "✕ Close" }).click();
  expect((await storedSessionOn(page, "2026-11-09")).sets[0]).not.toHaveProperty("day");

  // And 10 Nov is Day 2's own session again.
  await page.goto("/?date=2026-11-10");
  await expect(page.getByText("10 Nov · Week 2 of 8 · Day 2")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Lower: knee" })).toBeVisible();
});

test("12 Nov: add the missed Day 3, with the kettlebell swings as their own block", async ({ page }) => {
  await seedAt(page, "2026-11-12");
  await page.goto("/");

  // Day 4 + Day 5 is not an allowed pair, so only the missed Day 3 is offered.
  await expect(page.getByRole("button", { name: /Add Day 5/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Add missed Day 3 to today" }).click();

  await expect(page.getByText("12 Nov · Week 2 of 8 · Day 3 + Day 4")).toBeVisible();
  await expect(page.getByText("~70 min")).toBeVisible();
  // Week 2 is even, so Day 3's explosive item is the wall throws (PR 26).
  await expect(row(page, "Rotational med ball wall throws").locator(".item-day-label")).toHaveText("D3");
  await expect(row(page, "Kettlebell swings").locator(".item-day-label")).toHaveText("D4");
  await expect(page.locator(".combine-alternate-note")).toHaveCount(0);

  // 11 Nov (Day 3's date) is the donor.
  await page.goto("/?date=2026-11-11");
  await expect(page.getByRole("heading", { name: "Day 3 done with Day 4 on 12 Nov" })).toBeVisible();
});

test("the No equipment tick works per row on a combined day, and the swap is what gets logged", async ({ page }) => {
  await seedAt(page, "2026-11-09");
  await page.goto("/");
  await page.getByRole("button", { name: "Short on time? Add Day 2 to today" }).click();

  // Day 2's single-leg RDL (its block 4) swaps; Day 1's block 4 (dips) is untouched.
  await page.getByRole("checkbox", { name: "No equipment, Single-leg RDL" }).check();
  await expect(row(page, "Backpack single-leg RDL").locator(".item-day-label")).toHaveText("D2");
  await expect(row(page, "Backpack single-leg RDL")).toContainText("Instead of Single-leg RDL");
  await expect(row(page, "Dips")).not.toContainText("Instead of");

  await row(page, "Backpack single-leg RDL").locator(".item-open").click();
  await expect(page).toHaveURL(/#\/log\/2026-11-09\/4\/backpack_single_leg_rdl\/day\/2$/);
  await page.getByRole("button", { name: /^✓ Log set/ }).click();

  // The choice is now locked to the logged sets of that row.
  await page.getByRole("link", { name: "Back to Today" }).click();
  await expect(row(page, "Backpack single-leg RDL").locator(".item-progress")).toContainText("1/");
  await expect(page.getByRole("checkbox", { name: "No equipment, Single-leg RDL" })).toBeDisabled();
});

test("10 Nov: both buttons show, and tapping Add missed Day 1 combines the days on 10 Nov", async ({ page }) => {
  await seedAt(page, "2026-11-10");
  await page.goto("/");

  await expect(page.getByRole("button", { name: "Short on time? Add Day 3 to today" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add missed Day 1 to today" })).toBeVisible();

  await page.getByRole("button", { name: "Add missed Day 1 to today" }).click();

  await expect(page.getByText("10 Nov · Week 2 of 8 · Day 1 + Day 2")).toBeVisible();
  await expect(row(page, "Med ball slams").locator(".item-day-label")).toHaveText("D1");
  await expect(row(page, "Split-squat jumps").locator(".item-day-label")).toHaveText("D2");
  await expect(page.getByRole("button", { name: /Add .*Day/ })).toHaveCount(0);

  // 9 Nov (Day 1's date) is now the donor.
  await page.goto("/?date=2026-11-09");
  await expect(page.getByRole("heading", { name: "Day 1 done with Day 2 on 10 Nov" })).toBeVisible();
});

test("a combine whose host day passed with nothing logged lapses: both days are back on their dates", async ({ page }) => {
  await seedAt(page, "2026-11-09");
  await page.goto("/");
  await page.getByRole("button", { name: "Short on time? Add Day 2 to today" }).click();
  await expect(page.getByText("~73 min")).toBeVisible();

  // The next day comes and nothing was logged on 9 Nov.
  await page.clock.setSystemTime(new Date("2026-11-10T12:00:00"));
  await page.reload();

  // 10 Nov is Day 2 again (not "done with Day 1"), and Day 1 can be caught up.
  await expect(page.getByText("10 Nov · Week 2 of 8 · Day 2")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Lower: knee" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add missed Day 1 to today" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Short on time? Add Day 3 to today" })).toBeVisible();

  // 9 Nov's past view is the normal single day, and the day plans show no note.
  await page.goto("/?date=2026-11-09");
  await expect(page.getByText("9 Nov · Week 2 of 8 · Day 1", { exact: true })).toBeVisible();
  await page.goto("/#/plan/1/2");
  await expect(page.locator(".combine-note")).toHaveCount(0);
});

test("a combine with sets logged on its host day stays after that day passes", async ({ page }) => {
  await seedAt(page, "2026-11-09");
  await page.goto("/");
  await page.getByRole("button", { name: "Short on time? Add Day 2 to today" }).click();
  await row(page, "Split-squat jumps").locator(".item-open").click();
  await page.getByRole("button", { name: /^✓ Log set/ }).click();

  await page.clock.setSystemTime(new Date("2026-11-10T12:00:00"));
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Day 2 done with Day 1 on 9 Nov" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Add .*Day/ })).toHaveCount(0);
});

test("a preview of another date shows no offer buttons and no Undo", async ({ page }) => {
  await seedAt(page, "2026-11-09");
  await page.goto("/?date=2026-11-10");
  await expect(page.getByText("10 Nov · Week 2 of 8 · Day 2")).toBeVisible();
  await expect(page.getByRole("button", { name: /Add .*Day/ })).toHaveCount(0);

  await page.goto("/");
  await page.getByRole("button", { name: "Short on time? Add Day 2 to today" }).click();
  await expect(page.getByRole("button", { name: "Undo combine" })).toBeVisible();

  // The real clock goes back a day: 9 Nov is now a future preview, still combined, but nothing can be undone.
  await page.clock.setSystemTime(new Date("2026-11-08T12:00:00"));
  await page.goto("/?date=2026-11-09");
  await expect(page.getByText("9 Nov · Week 2 of 8 · Day 1 + Day 2")).toBeVisible();
  await expect(page.getByRole("button", { name: "Undo combine" })).toHaveCount(0);
});

test("a direct link to a donor date's exercise shows Nothing to log here and saves nothing", async ({ page }) => {
  await seedAt(page, "2026-11-09");
  await page.goto("/");
  await page.getByRole("button", { name: "Short on time? Add Day 2 to today" }).click();

  await page.goto("/?date=2026-11-10#/log/2026-11-10/2/split_squat_jump");
  await expect(page.getByRole("heading", { name: "Nothing to log here" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^✓ Log set/ })).toHaveCount(0);
  expect(await storedSessionOn(page, "2026-11-10")).toBeUndefined();
});

test("a No equipment tick made before combining survives Add Day 2, and Undo still shows it", async ({ page }) => {
  await seedAt(page, "2026-11-09");
  await page.goto("/");

  await page.getByRole("checkbox", { name: "No equipment, Pull-ups" }).check();
  await expect(row(page, "Pull-ups")).toContainText("Instead of Pull-ups");

  await page.getByRole("button", { name: "Short on time? Add Day 2 to today" }).click();
  await expect(page.getByRole("checkbox", { name: "No equipment, Pull-ups" })).toBeChecked();
  await expect(row(page, "Pull-ups")).toContainText("Instead of Pull-ups");

  await page.getByRole("button", { name: "Undo combine" }).click();
  await expect(page.getByRole("checkbox", { name: "No equipment, Pull-ups" })).toBeChecked();
});
