import { expect, test, type Page } from "@playwright/test";

/** Saves settings the way the app stores them, before the app first loads. */
async function seedStartDate(page: Page, startDate: string): Promise<void> {
  await page.addInitScript((settings) => {
    window.localStorage.setItem("explosive-endurance.settings", JSON.stringify(settings));
  }, { version: 1, startDate, maxReps: { pull_up: 12, dip: 15 } });
}

test("first visit lands on the overview and its one call to action starts Day 1", async ({ page }) => {
  await page.goto("/?date=2026-11-09");

  await expect(page.getByRole("heading", { level: 1, name: "Program overview" })).toBeVisible();
  await expect(page.getByText("8 weeks · 6 training days a week · about 4 h a week")).toBeVisible();

  // The week strip and the four phases.
  await expect(page.locator(".overview-week")).toHaveText(["1", "2", "3", "4", "5", "6", "7", "8"]);
  await expect(page.locator(".overview-phase-name")).toHaveText([
    "Weeks 1–3 · Base",
    "Week 4 · Deload",
    "Weeks 5–7 · Power endurance",
    "Week 8 · Deload + retest",
  ]);

  // Every change of a phase is listed, so Week 8's retest is not hidden behind "Halve all sets".
  await expect(page.locator(".overview-phase").last()).toContainText("Retest max pull-ups and dips");

  // Seven day rows: Day 1 is a training day, Day 7 is rest.
  await expect(page.locator(".overview-day")).toHaveCount(7);
  const dayOne = page.locator(".overview-day").first();
  await expect(dayOne).toContainText("Day 1");
  await expect(dayOne).toContainText("Upper: pull");
  await expect(dayOne).toContainText("~50 min");
  const daySeven = page.locator(".overview-day").last();
  await expect(daySeven).toContainText("Day 7");
  await expect(daySeven).toContainText("Rest");

  // Exactly one primary call to action.
  await expect(page.locator(".primary-button")).toHaveCount(1);
  const startButton = page.getByRole("button", { name: "Start Day 1: Upper: pull" });
  await expect(startButton).toBeVisible();

  await startButton.click();

  await expect(page.getByText("9 Nov · Week 1 of 8 · Day 1")).toBeVisible();
  const heading = page.getByRole("heading", { name: "Upper: pull" });
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();

  // The start date was saved, so a reload opens Today, not the overview.
  await page.reload();
  await expect(page.getByText("9 Nov · Week 1 of 8 · Day 1")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Program overview" })).toHaveCount(0);
});

test("a started program opens on Today; the overview highlights the week and returns to Today", async ({ page }) => {
  await seedStartDate(page, "2026-11-02");
  await page.goto("/?date=2026-11-09");

  await expect(page.getByText("9 Nov · Week 2 of 8 · Day 1")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Program overview" })).toHaveCount(0);

  await page.getByRole("link", { name: "Program overview" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Program overview" })).toBeVisible();
  await expect(page.locator(".overview-week[aria-current='true']")).toHaveText("2");
  await expect(page.locator(".overview-week[aria-current='true']")).toHaveCount(1);

  await page.getByRole("link", { name: "Go to today: Week 2 · Day 1" }).click();
  await expect(page.getByText("9 Nov · Week 2 of 8 · Day 1")).toBeVisible();
  expect(page.url()).toContain("date=2026-11-09");
});

test("on a rest day the call to action says so", async ({ page }) => {
  await seedStartDate(page, "2026-11-02");
  await page.goto("/?date=2026-11-08#/overview");

  await expect(page.getByRole("link", { name: "Go to today: Rest day" })).toBeVisible();
});

test("a future start date shows when it starts and previews Day 1", async ({ page }) => {
  await seedStartDate(page, "2026-11-16");
  await page.goto("/?date=2026-11-09#/overview");

  await expect(page.getByText("Program starts 16 Nov")).toBeVisible();
  await page.getByRole("link", { name: "Preview Day 1" }).click();

  await expect(page.getByText("16 Nov · Week 1 of 8 · Day 1")).toBeVisible();
});

test("a finished program offers a new start date in Settings", async ({ page }) => {
  await seedStartDate(page, "2026-09-01");
  await page.goto("/?date=2026-11-09#/overview");

  await page.getByRole("link", { name: "Set a new start date" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
});

test("Settings links to the overview", async ({ page }) => {
  await seedStartDate(page, "2026-11-02");
  await page.goto("/?date=2026-11-09#/settings");

  await page.getByRole("link", { name: "Program overview" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Program overview" })).toBeVisible();
});

test("first run still shows the program.json warnings banner on the overview", async ({ page }) => {
  await page.route("**/program.json", async (route) => {
    const response = await route.fetch();
    const program = await response.json();
    program.exercises.pull_up.notes = "x";
    await route.fulfill({ response, json: program });
  });
  await page.goto("/?date=2026-11-09");

  await expect(page.getByRole("heading", { level: 1, name: "Program overview" })).toBeVisible();
  await expect(page.locator(".warning-banner")).toContainText("program.json has 1 field the app doesn't recognise");
});

test("first run with a ?date= preview shows the previewing strip on the overview", async ({ page }) => {
  await page.goto("/?date=2026-11-09");

  await expect(page.getByRole("heading", { level: 1, name: "Program overview" })).toBeVisible();
  await expect(page.getByText(/Previewing 9 Nov/)).toBeVisible();
});

test("an explicit #/today with no start date shows the overview and keeps the hash", async ({ page }) => {
  await page.goto("/?date=2026-11-09#/today");

  await expect(page.getByRole("heading", { level: 1, name: "Program overview" })).toBeVisible();
  expect(new URL(page.url()).hash).toBe("#/today");
});

test("the call to action is pinned in view above the bottom nav without scrolling", async ({ page }) => {
  await page.goto("/?date=2026-11-09");

  const startButton = page.getByRole("button", { name: "Start Day 1: Upper: pull" });
  await expect(startButton).toBeVisible();
  await expect(startButton).toBeInViewport({ ratio: 1 });

  // The button must sit above the nav, not underneath it.
  const buttonBox = await startButton.boundingBox();
  const navBox = await page.locator(".bottom-nav").boundingBox();
  expect(buttonBox).not.toBeNull();
  expect(navBox).not.toBeNull();
  expect(buttonBox!.y + buttonBox!.height).toBeLessThanOrEqual(navBox!.y);

  // The Settings link in the same bar is also reachable on the first screen.
  await expect(page.getByRole("link", { name: "Or pick another start date in Settings" })).toBeInViewport({ ratio: 1 });
});
