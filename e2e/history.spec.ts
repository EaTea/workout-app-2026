import { expect, test, type Page } from "@playwright/test";

/** Saves settings the way the app stores them, before the app first loads. */
async function seedSettings(page: Page): Promise<void> {
  await page.addInitScript((settings) => {
    window.localStorage.setItem("explosive-endurance.settings", JSON.stringify(settings));
  }, { version: 1, startDate: "2026-11-02", maxReps: { pull_up: 12, dip: 15 } });
}

/** A seeded set in the stored (wire) format. */
function wireSet(exerciseId: string, blockPosition: number, setNumber: number, reps: number, extra: Record<string, unknown> = {}) {
  return { exerciseId, blockPosition, setNumber, reps, loggedAt: "2026-11-02T18:00:00.000Z", ...extra };
}

/**
 * Seeds a log with two sessions, in the stored (wire) format, but only the
 * first time the page loads (so edits survive the reloads in these tests):
 *   2 Nov (W1 D1): med ball slams 6, 6, 5 (note on set 3), pull-ups 5, 5 at 8 kg
 *   4 Nov (W1 D3): plyo push-ups 5, 5; dips, one set of 7 at 10 kg
 */
async function seedTwoSessions(page: Page): Promise<void> {
  const log = {
    version: 1,
    sessions: [
      {
        date: "2026-11-02", programWeek: 1, day: 1,
        sets: [
          wireSet("med_ball_slam", 2, 1, 6), wireSet("med_ball_slam", 2, 2, 6), wireSet("med_ball_slam", 2, 3, 5, { note: "slowed down" }),
          wireSet("pull_up", 3, 1, 5, { loadKg: 8 }), wireSet("pull_up", 3, 2, 5, { loadKg: 8 }),
        ],
      },
      {
        date: "2026-11-04", programWeek: 1, day: 3,
        sets: [wireSet("plyo_push_up", 2, 1, 5), wireSet("plyo_push_up", 2, 2, 5), wireSet("dip", 3, 1, 7, { loadKg: 10 })],
      },
    ],
  };
  await page.addInitScript((seed) => {
    if (window.localStorage.getItem("explosive-endurance.log") === null) {
      window.localStorage.setItem("explosive-endurance.log", JSON.stringify(seed));
    }
  }, log);
}

/** The History card for a header text prefix such as "2 Nov". */
function card(page: Page, headerStart: string) {
  return page.locator(".history-session", { hasText: headerStart });
}

/** An exercise row inside a card. */
function exerciseRow(page: Page, headerStart: string, name: string) {
  return card(page, headerStart).locator(".history-exercise", { hasText: name });
}

test("History lists sessions newest first with summaries and notes", async ({ page }) => {
  await seedSettings(page);
  await seedTwoSessions(page);
  await page.goto("/?date=2026-11-09#/history");

  const headers = page.locator(".history-session-header");
  await expect(headers).toHaveText(["4 Nov · Week 1 · Day 3 · Upper: push", "2 Nov · Week 1 · Day 1 · Upper: pull"]);

  await expect(exerciseRow(page, "2 Nov", "Med ball slams")).toContainText("6, 6, 5");
  await expect(exerciseRow(page, "2 Nov", "Med ball slams")).toContainText("slowed down");
  await expect(exerciseRow(page, "2 Nov", "Pull-ups")).toContainText("2 × 5 at 8 kg");
  await expect(exerciseRow(page, "4 Nov", "Plyo push-ups")).toContainText("2 × 5");
  await expect(exerciseRow(page, "4 Nov", "Dips")).toContainText("1 × 7 at 10 kg");

  // Rows follow block order.
  await expect(card(page, "2 Nov").locator(".history-exercise-name")).toHaveText(["Med ball slams", "Pull-ups"]);

  // The History tab is a real link and is the highlighted one.
  await expect(page.getByRole("link", { name: "History" })).toHaveAttribute("aria-current", "page");
});

test("edit a set's reps, delete a set, and delete the last set of a session", async ({ page }) => {
  await seedSettings(page);
  await seedTwoSessions(page);
  await page.goto("/?date=2026-11-09#/history");

  // Expand the slams and raise set 3 from 5 to 6 reps: the summary becomes 3 × 6.
  await exerciseRow(page, "2 Nov", "Med ball slams").locator(".history-exercise-row").click();
  await expect(page.getByRole("button", { name: /^Set 3 · 5 reps/ })).toBeVisible();
  await page.getByRole("button", { name: /^Set 3 · 5 reps/ }).click();
  await page.getByRole("button", { name: "Increase reps" }).click();
  await page.getByRole("button", { name: "✓ Save changes" }).click();
  await expect(exerciseRow(page, "2 Nov", "Med ball slams")).toContainText("3 × 6");

  // Reload: the edit was saved.
  await page.reload();
  await expect(exerciseRow(page, "2 Nov", "Med ball slams")).toContainText("3 × 6");

  // Delete one of the two plyo sets.
  await exerciseRow(page, "4 Nov", "Plyo push-ups").locator(".history-exercise-row").click();
  await page.getByRole("button", { name: /^Set 2 · 5 reps/ }).click();
  await page.getByRole("button", { name: "Delete set" }).click();
  await page.getByRole("button", { name: "Tap again to delete" }).click();
  await expect(exerciseRow(page, "4 Nov", "Plyo push-ups")).toContainText("1 × 5");

  // The card is still there, so focus goes to its heading, not the page.
  await expect(card(page, "4 Nov").locator(".history-session-header")).toBeFocused();

  // Delete the remaining sets of 4 Nov: the card goes with the last one.
  await page.getByRole("button", { name: /^Set 1 · 5 reps/ }).click();
  await page.getByRole("button", { name: "Delete set" }).click();
  await page.getByRole("button", { name: "Tap again to delete" }).click();
  await exerciseRow(page, "4 Nov", "Dips").locator(".history-exercise-row").click();
  await page.getByRole("button", { name: /^Min 1 · 7 reps/ }).click();
  await page.getByRole("button", { name: "Delete set" }).click();
  await page.getByRole("button", { name: "Tap again to delete" }).click();
  await expect(card(page, "4 Nov")).toHaveCount(0);

  // The card is gone, so focus goes to the page heading rather than the page.
  await expect(page.getByRole("heading", { name: "History" })).toBeFocused();
  await expect(page.locator(".history-session")).toHaveCount(1);

  // Reload: still gone.
  await page.reload();
  await expect(card(page, "4 Nov")).toHaveCount(0);
  await expect(card(page, "2 Nov")).toHaveCount(1);
});

test("History is empty at first, and shows what was just logged on Today", async ({ page }) => {
  await seedSettings(page);
  await page.goto("/?date=2026-11-09#/history");
  await expect(page.getByText("Nothing logged yet. Tap an exercise on Today to log it.")).toBeVisible();

  await page.getByRole("link", { name: "Today" }).click();
  await page.locator(".item-row", { hasText: "Pull-ups" }).locator(".item-open").click();
  await page.getByRole("button", { name: "Log all as planned" }).click();
  await expect(page.getByText("All sets logged.")).toBeVisible();

  await page.getByRole("link", { name: "History" }).click();
  await expect(page.locator(".history-session-header")).toHaveText("9 Nov · Week 2 · Day 1 · Upper: pull");
  await expect(exerciseRow(page, "9 Nov", "Pull-ups")).toContainText("9 × 5");
});

test("a log with one bad set shows a warning and keeps the good set", async ({ page }) => {
  await seedSettings(page);
  const log = {
    version: 1,
    sessions: [
      {
        date: "2026-11-02", programWeek: 1, day: 1,
        sets: [wireSet("med_ball_slam", 2, 1, 6), wireSet("med_ball_slam", 2, 2, 6, { reps: "six" })],
      },
    ],
  };
  await page.addInitScript((seed) => {
    window.localStorage.setItem("explosive-endurance.log", JSON.stringify(seed));
  }, log);
  await page.goto("/?date=2026-11-09#/history");

  await expect(page.locator(".warning-banner")).toContainText("1 set of your saved workout log could not be read and was set aside");
  await expect(exerciseRow(page, "2 Nov", "Med ball slams")).toContainText("1 × 6");

  // The original text was copied aside before anything could be saved over it.
  const backupCount = await page.evaluate(() => Object.keys(window.localStorage).filter((key) => key.startsWith("explosive-endurance.log.corrupt-")).length);
  expect(backupCount).toBe(1);
});

test("focus follows each History action, and reps can be added to a set logged without them", async ({ page }) => {
  await seedSettings(page);
  const log = {
    version: 1,
    sessions: [
      {
        date: "2026-11-02", programWeek: 1, day: 1,
        // A pull-up minute logged with no reps (the plan could not give a number).
        sets: [{ exerciseId: "pull_up", blockPosition: 3, setNumber: 1, loggedAt: "2026-11-02T18:00:00.000Z" }],
      },
    ],
  };
  await page.addInitScript((seed) => {
    if (window.localStorage.getItem("explosive-endurance.log") === null) {
      window.localStorage.setItem("explosive-endurance.log", JSON.stringify(seed));
    }
  }, log);
  await page.goto("/?date=2026-11-09#/history");

  // Expanding keeps focus on the exercise row.
  await exerciseRow(page, "2 Nov", "Pull-ups").locator(".history-exercise-row").click();
  await expect(exerciseRow(page, "2 Nov", "Pull-ups").locator(".history-exercise-row")).toBeFocused();

  // Opening the set puts focus in the edit panel, which offers reps even though none were stored.
  await page.getByRole("button", { name: /^Min 1 · Done/ }).click();
  await expect(page.getByRole("button", { name: "Increase reps" })).toBeVisible();
  await expect(page.locator(".history-editor .log-stepper-button").first()).toBeFocused();

  await page.getByRole("button", { name: "Increase reps" }).click();
  await page.getByRole("button", { name: "✓ Save changes" }).click();
  await expect(page.getByRole("button", { name: /^Min 1 · 1 rep/ })).toBeFocused();

  await page.reload();
  await expect(exerciseRow(page, "2 Nov", "Pull-ups")).toContainText("1 × 1");
});
