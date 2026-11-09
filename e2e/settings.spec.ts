import { expect, test } from "@playwright/test";

test("first run prompts for a start date; settings save, drive Today and persist", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Set your program start date")).toBeVisible();

  await page.getByRole("link", { name: "Or set a different date in Settings" }).click();
  await page.getByLabel("Start date").fill("2026-11-02");
  await page.getByLabel("Max reps: Pull-ups").fill("12");
  await page.getByLabel("Max reps: Dips").fill("15");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByRole("status")).toHaveText("Saved");
  await expect(page).toHaveURL(/#\/today$/);

  // Preview week 2 day 1 via the ?date= override.
  await page.goto("/?date=2026-11-09");
  await expect(page.getByText("Week 2 of 8 · Day 1")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Upper: pull" })).toBeVisible();

  await page.goto("/#/settings");
  await expect(page.getByLabel("Start date")).toHaveValue("2026-11-02");
  await expect(page.getByLabel("Max reps: Pull-ups")).toHaveValue("12");
  await expect(page.getByLabel("Max reps: Dips")).toHaveValue("15");
});

test("Start today on first run saves today as day 1 and survives a reload", async ({ page }) => {
  // 4 Nov: a mid-week start is day 1 and shows the program's first session.
  await page.goto("/?date=2026-11-04");
  await page.getByRole("button", { name: "Start today" }).click();

  await expect(page.getByText("Week 1 of 8 · Day 1")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Upper: pull" })).toBeVisible();

  await page.reload();
  await expect(page.getByText("Week 1 of 8 · Day 1")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Upper: pull" })).toBeVisible();
});

test("Start today shows an inline alert and keeps the nav when saving fails", async ({ page }) => {
  await page.goto("/?date=2026-11-04");
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new Error("storage is full");
    };
  });
  await page.getByRole("button", { name: "Start today" }).click();

  await expect(page.getByRole("alert")).toHaveText("Couldn't save on this device, so the start date won't be remembered.");
  await expect(page.getByRole("button", { name: "Start today" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
});

test("invalid max reps show an inline error and do not save", async ({ page }) => {
  await page.goto("/#/settings");
  await page.getByLabel("Start date").fill("2026-11-02");
  await page.getByLabel("Max reps: Pull-ups").fill("0");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByText("Enter a whole number of reps")).toBeVisible();
  await expect(page).toHaveURL(/#\/settings$/);
});

test("a mistyped max shows an error and keeps the stored max", async ({ page }) => {
  await page.addInitScript(() => {
    if (!window.localStorage.getItem("explosive-endurance.settings")) {
      window.localStorage.setItem(
        "explosive-endurance.settings",
        JSON.stringify({ version: 1, startDate: "2026-11-02", maxReps: { pull_up: 12 } }),
      );
    }
  });
  await page.goto("/#/settings");

  await page.getByLabel("Max reps: Pull-ups").fill("1e");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Enter a whole number of reps")).toBeVisible();
  await expect(page).toHaveURL(/#\/settings$/);

  const stored = await page.evaluate(() => window.localStorage.getItem("explosive-endurance.settings"));
  expect(JSON.parse(stored ?? "{}").maxReps.pull_up).toBe(12);
});

test("a broken program.json shows the error card", async ({ page }) => {
  await page.route("**/program.json", (route) =>
    route.fulfill({ contentType: "application/json", body: '{"name": "broken"}' }),
  );
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Could not load the program" })).toBeVisible();
});

test("saving a changed max records today's date (format v2); an unchanged max keeps its date", async ({ page }) => {
  await page.addInitScript(() => {
    if (!window.localStorage.getItem("explosive-endurance.settings")) {
      window.localStorage.setItem(
        "explosive-endurance.settings",
        JSON.stringify({ version: 1, startDate: "2026-11-02", maxReps: { pull_up: 12, dip: 15 } }),
      );
    }
  });
  await page.goto("/?date=2026-12-21#/settings");

  await page.getByLabel("Max reps: Pull-ups").fill("15");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved");

  const stored = await page.evaluate(() => window.localStorage.getItem("explosive-endurance.settings"));
  expect(JSON.parse(stored ?? "{}")).toEqual({
    version: 2,
    startDate: "2026-11-02",
    maxReps: { pull_up: 15, dip: 15 },
    maxSavedOn: { pull_up: "2026-12-21" },
  });
});
