import { expect, test, type Page } from "@playwright/test";

const LOG_PATH = "/?date=2026-11-09#/log/2026-11-09/2/med_ball_slam";

/** Seeds settings (Day 1 on 2 Nov) and fixes the clock at 9 Nov 2026, then opens the med ball slam log screen. */
async function openLogScreen(page: Page): Promise<void> {
  await page.clock.install({ time: new Date("2026-11-09T12:00:00") });
  await page.addInitScript((settings) => {
    window.localStorage.setItem("explosive-endurance.settings", JSON.stringify(settings));
  }, { version: 1, startDate: "2026-11-02", maxReps: { pull_up: 12, dip: 15 } });
  await page.goto(LOG_PATH);
  await expect(page.getByRole("heading", { name: "Med ball slams" })).toBeVisible();
}

test("Back closes the exercise details sheet and the log screen stays", async ({ page }) => {
  await openLogScreen(page);
  const logUrl = page.url();

  await page.getByRole("button", { name: "Exercise details" }).click();
  const sheet = page.getByRole("dialog", { name: "Med ball slams" });
  await expect(sheet).toBeVisible();

  await page.goBack();

  await expect(sheet).toBeHidden();
  await expect(page.getByRole("heading", { name: "Med ball slams" })).toBeVisible();
  expect(page.url()).toBe(logUrl);
});

test("after closing the sheet with its close button, one Back goes where it would have gone before", async ({ page }) => {
  await openLogScreen(page);

  await page.getByRole("button", { name: "Exercise details" }).click();
  const sheet = page.getByRole("dialog", { name: "Med ball slams" });
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(sheet).toBeHidden();

  await page.goBack(); // the sheet's history entry is gone, so this leaves the log page
  expect(page.url()).toBe("about:blank");
});

test("the rest timer still closes on Back after the sheet was closed", async ({ page }) => {
  await openLogScreen(page);
  const logUrl = page.url();

  await page.getByRole("button", { name: "Exercise details" }).click();
  await page.getByRole("dialog", { name: "Med ball slams" }).getByRole("button", { name: "Close" }).click();

  await page.getByRole("button", { name: "✓ Log set · rest 0:30" }).click();
  const rest = page.getByRole("dialog", { name: "Rest timer" });
  await expect(rest).toBeVisible();
  await page.goBack();
  await expect(rest).toBeHidden();
  expect(page.url()).toBe(logUrl);
});

test("the kg value button is at least 48px tall", async ({ page }) => {
  await openLogScreen(page);

  const box = await page.locator(".log-stepper-value-button").first().boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
});
