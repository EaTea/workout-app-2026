import { expect, test, type Page } from "@playwright/test";

/** Saves settings the way the app stores them, before the app first loads. */
async function seedStartedProgram(page: Page): Promise<void> {
  await page.addInitScript((settings) => {
    window.localStorage.setItem("explosive-endurance.settings", JSON.stringify(settings));
  }, { version: 1, startDate: "2026-11-02", maxReps: { pull_up: 12, dip: 15 } });
}

/** The row for an exercise name on the Day plan screen. */
function row(page: Page, name: string) {
  return page.locator(".item-row", { hasText: name });
}

/** Opens the Overview of a started program (Week 2) and taps the Day 1 row. */
async function openDayOnePlanFromOverview(page: Page): Promise<void> {
  await seedStartedProgram(page);
  await page.goto("/?date=2026-11-09#/overview");
  await page.locator(".overview-day").first().getByRole("link").click();
}

test("tapping Day 1 on the overview shows that day's plan for the current week", async ({ page }) => {
  await openDayOnePlanFromOverview(page);

  await expect(page.getByRole("heading", { level: 1, name: "Upper: pull" })).toBeVisible();
  await expect(page.locator(".kicker")).toHaveText("Day 1 · Week 2 of 8 · Base");
  await expect(page.locator(".plan-week[aria-current='true']")).toHaveText("2");
  await expect(page.locator(".plan-week[aria-current='true']")).toHaveCount(1);

  await expect(page.locator(".block-title")).toHaveText([
    "1 · Warm-up · 2 rounds",
    "2 · Explosive",
    "3 · Main strength · 9 min",
    "4 · Mini-dose",
    "5 · Core · superset",
    "6 · Finisher",
  ]);

  // Pull-ups went up from week 1; med ball slams did not change.
  await expect(row(page, "Pull-ups").locator(".item-dose-main")).toHaveText("5 / min");
  await expect(row(page, "Pull-ups").locator(".plan-changed")).toHaveText("Changed: 4 / min in week 1");
  await expect(row(page, "Med ball slams").locator(".plan-changed")).toHaveCount(0);
});

test("picking week 4 swaps the plan in place without adding history", async ({ page }) => {
  await openDayOnePlanFromOverview(page);

  await page.getByRole("link", { name: "Week 4" }).click();

  await expect(page.locator(".kicker")).toHaveText("Day 1 · Week 4 of 8 · Deload");
  await expect(page.locator(".plan-week[aria-current='true']")).toHaveText("4");
  await expect(row(page, "Med ball slams").locator(".item-dose-main")).toHaveText("3 × 6");
  await expect(row(page, "Med ball slams").locator(".plan-changed")).toHaveText("Changed: 6 × 6 in week 3");
  await expect(row(page, "Dips").locator(".item-dose-main")).toHaveText("1 × 7");
  await expect(row(page, "Dips").locator(".plan-changed")).toContainText(/^Changed: .* in week 3$/);

  const url = new URL(page.url());
  expect(url.hash).toBe("#/plan/1/4");
  expect(url.search).toContain("date=2026-11-09");

  // One Back press leaves the plan entirely: the week tap replaced the entry.
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: "Program overview" })).toBeVisible();
});

test("week 1 shows no Changed lines", async ({ page }) => {
  await openDayOnePlanFromOverview(page);

  await page.getByRole("link", { name: "Week 1" }).click();

  await expect(page.locator(".kicker")).toHaveText("Day 1 · Week 1 of 8 · Base");
  await expect(page.locator(".plan-changed")).toHaveCount(0);
});

test("the rest day on the overview is not a link", async ({ page }) => {
  await seedStartedProgram(page);
  await page.goto("/?date=2026-11-09#/overview");

  const restRow = page.locator(".overview-day").last();
  await expect(restRow).toContainText("Day 7");
  await expect(restRow).toContainText("Rest");
  await expect(restRow.getByRole("link")).toHaveCount(0);
});

test("before the program is started the plan previews week 1 and saves nothing", async ({ page }) => {
  await page.goto("/?date=2026-11-09#/overview");
  await page.locator(".overview-day").first().getByRole("link").click();

  await expect(page.locator(".kicker")).toHaveText("Day 1 · Week 1 of 8 · Base");
  await expect(row(page, "Pull-ups").locator(".item-dose-main")).toHaveText("Set max");

  // Without maxes, week 4 must describe the previous dose by structure, never "Set max".
  await page.getByRole("link", { name: "Week 4" }).click();
  await expect(row(page, "Dips").locator(".plan-changed")).toHaveText("Changed: 2 sets in week 3");
  await expect(row(page, "Pull-ups").locator(".plan-changed")).toHaveCount(0);
  await expect(page.locator(".plan-changed", { hasText: "Set max" })).toHaveCount(0);

  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: "Program overview" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start Day 1: Upper: pull" })).toBeVisible();

  // Looking at a plan must not start the program.
  const savedStartDate = await page.evaluate(() => {
    const saved = window.localStorage.getItem("explosive-endurance.settings");
    return saved === null ? null : (JSON.parse(saved).startDate ?? null);
  });
  expect(savedStartDate).toBeNull();
});

test("a plan address outside the program shows the overview", async ({ page }) => {
  await page.goto("/#/plan/9/1");
  await expect(page.getByRole("heading", { level: 1, name: "Program overview" })).toBeVisible();

  await page.goto("/#/plan/1/9");
  await expect(page.getByRole("heading", { level: 1, name: "Program overview" })).toBeVisible();
});
