import { expect, test, type Page } from "@playwright/test";

/** A seeded set in the stored (wire) format. */
function wireSet(exerciseId: string, blockPosition: number, setNumber: number, reps: number, extra: Record<string, unknown> = {}) {
  return { exerciseId, blockPosition, setNumber, reps, loggedAt: "2026-11-02T18:00:00.000Z", ...extra };
}

/**
 * Seeds settings and a three-week log in the stored (wire) format, all on
 * program day 1 (slams are block 2, pull-ups block 3):
 *   2 Nov W1: slams 6, 6; pull-ups 5, 4 at 8 kg
 *   9 Nov W2: slams 7;    pull-ups 6 at 8 kg
 *  16 Nov W3: slams 7, 8; pull-ups 7, 5 at 10 kg
 */
async function seedThreeWeeks(page: Page): Promise<void> {
  await page.addInitScript((seed) => {
    window.localStorage.setItem("explosive-endurance.settings", JSON.stringify(seed.settings));
    window.localStorage.setItem("explosive-endurance.log", JSON.stringify(seed.log));
  }, {
    settings: { version: 1, startDate: "2026-11-02", maxReps: { pull_up: 12, dip: 15 } },
    log: {
      version: 1,
      sessions: [
        { date: "2026-11-02", programWeek: 1, day: 1, sets: [wireSet("med_ball_slam", 2, 1, 6), wireSet("med_ball_slam", 2, 2, 6), wireSet("pull_up", 3, 1, 5, { loadKg: 8 }), wireSet("pull_up", 3, 2, 4, { loadKg: 8 })] },
        { date: "2026-11-09", programWeek: 2, day: 1, sets: [wireSet("med_ball_slam", 2, 1, 7), wireSet("pull_up", 3, 1, 6, { loadKg: 8 })] },
        { date: "2026-11-16", programWeek: 3, day: 1, sets: [wireSet("med_ball_slam", 2, 1, 7), wireSet("med_ball_slam", 2, 2, 8), wireSet("pull_up", 3, 1, 7, { loadKg: 10 }), wireSet("pull_up", 3, 2, 5, { loadKg: 10 })] },
      ],
    },
  });
}

test("Progress section charts best reps per week and picks another exercise", async ({ page }) => {
  await seedThreeWeeks(page);
  await page.goto("/?date=2026-11-16#/history");

  const progress = page.locator(".progress-card");
  await expect(progress.getByRole("heading", { name: "Progress" })).toBeVisible();

  // Both exercises were logged on the same latest date, so the picker lists both by name.
  const picker = progress.getByLabel("Exercise");
  await expect(picker.locator("option")).toHaveText(["Med ball slams", "Pull-ups"]);
  expect((await picker.boundingBox())?.height).toBeGreaterThanOrEqual(44);

  await picker.selectOption({ label: "Pull-ups" });
  const chart = progress.getByRole("img", { name: /^Pull-ups best reps rose from 5 in week 1 to 7 in week 3$/ });
  await expect(chart).toBeVisible();
  await expect(chart.locator("circle")).toHaveCount(3);
  await expect(chart.getByText("Deload")).toHaveCount(2);
  await expect(chart.getByText("W8")).toHaveCount(1);

  // The table is the accessible source of truth.
  const rows = progress.locator("table tbody tr");
  await expect(rows).toHaveText(["W12 Nov58", "W29 Nov68", "W316 Nov710"]);

  // Loads were logged, so the kg chart appears too.
  const loadChart = progress.getByRole("img", { name: /^Pull-ups heaviest load rose from 8 kg in week 1 to 10 kg in week 3$/ });
  await expect(loadChart).toBeVisible();
  await expect(loadChart.locator("circle")).toHaveCount(3);

  // Slams have no loads: one chart only, with their own best reps.
  await picker.selectOption({ label: "Med ball slams" });
  await expect(progress.getByRole("img")).toHaveCount(1);
  await expect(progress.getByRole("img")).toHaveAttribute("aria-label", "Med ball slams best reps rose from 6 in week 1 to 8 in week 3");
  await expect(rows).toHaveText(["W12 Nov6–", "W29 Nov7–", "W316 Nov8–"]);
});

test("the picker choice is remembered when History is redrawn", async ({ page }) => {
  await seedThreeWeeks(page);
  await page.goto("/?date=2026-11-16#/history");

  await page.getByLabel("Exercise").selectOption({ label: "Med ball slams" });

  // Expanding an exercise redraws the screen; the pick must survive.
  await page.locator(".history-exercise-row").first().click();
  await expect(page.getByLabel("Exercise")).toHaveValue("med_ball_slam");
});

test("an empty log shows no Progress section", async ({ page }) => {
  await page.goto("/?date=2026-11-16#/history");

  await expect(page.getByText("Nothing logged yet")).toBeVisible();
  await expect(page.locator(".progress-card")).toHaveCount(0);
});
