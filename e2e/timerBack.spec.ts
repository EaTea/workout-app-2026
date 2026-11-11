import { expect, test, type Page } from "@playwright/test";

/** Seeds settings (Day 1 on 2 Nov) and fixes the clock at 9 Nov 2026 so the log screen accepts sets. */
async function openApp(page: Page, path: string): Promise<void> {
  await page.clock.install({ time: new Date("2026-11-09T12:00:00") });
  await page.addInitScript((settings) => {
    window.localStorage.setItem("explosive-endurance.settings", JSON.stringify(settings));
  }, { version: 1, startDate: "2026-11-02", maxReps: { pull_up: 12, dip: 15 } });
  await page.goto(path);
}

test("Back closes the EMOM timer and Today is still shown", async ({ page }) => {
  await openApp(page, "/?date=2026-11-02");
  const startButton = page.getByRole("button", { name: "Start EMOM, Pull-ups" });
  await startButton.click();
  const overlay = page.getByRole("dialog", { name: "Pull-ups EMOM timer" });
  await expect(overlay).toBeVisible();

  await page.goBack();

  await expect(overlay).toBeHidden();
  await expect(startButton).toBeVisible();
  expect(new URL(page.url()).search).toBe("?date=2026-11-02");
  // Focus returns to the button that opened the timer.
  await expect(startButton).toBeFocused();
});

test("Back closes the rest timer opened by Log set and the log screen stays", async ({ page }) => {
  await openApp(page, "/?date=2026-11-09");
  await page.locator(".item-row", { hasText: "Med ball slams" }).locator(".item-open").click();
  await expect(page.getByRole("heading", { name: "Med ball slams" })).toBeVisible();
  const logUrl = page.url();

  await page.getByRole("button", { name: "✓ Log set · rest 0:30" }).click();
  const rest = page.getByRole("dialog", { name: "Rest timer" });
  await expect(rest).toBeVisible();

  await page.goBack();

  await expect(rest).toBeHidden();
  await expect(page.getByRole("heading", { name: "Med ball slams" })).toBeVisible();
  expect(page.url()).toBe(logUrl);
});

test("after closing with the close button, one Back goes where it would have gone before the timer", async ({ page }) => {
  await openApp(page, "/?date=2026-11-02");
  await page.getByRole("button", { name: "Start EMOM, Pull-ups" }).click();
  const overlay = page.getByRole("dialog", { name: "Pull-ups EMOM timer" });
  await overlay.getByRole("button", { name: "✕ Close" }).click();
  await expect(overlay).toBeHidden();

  // Today is still shown, and the history entry the timer pushed is gone again.
  await expect(page.getByRole("button", { name: "Start EMOM, Pull-ups" })).toBeVisible();
  await page.goBack(); // to about:blank, where the page came from
  expect(page.url()).toBe("about:blank");
});

test("a second timer opened after the first was closed also closes on Back", async ({ page }) => {
  await openApp(page, "/?date=2026-11-02");
  const startButton = page.getByRole("button", { name: "Start EMOM, Pull-ups" });
  const overlay = page.getByRole("dialog", { name: "Pull-ups EMOM timer" });

  await startButton.click();
  await overlay.getByRole("button", { name: "✕ Close" }).click();
  await expect(overlay).toBeHidden();

  await startButton.click();
  await expect(overlay).toBeVisible();
  await page.goBack();
  await expect(overlay).toBeHidden();
  await expect(startButton).toBeVisible();
});

test("Back closes the heavy bag interval timer and Today is still shown", async ({ page }) => {
  await openApp(page, "/?date=2026-11-02");
  const startButton = page.getByRole("button", { name: "Start timer, Heavy bag finisher" });
  await startButton.click();
  const overlay = page.getByRole("dialog", { name: "Heavy bag timer" });
  await expect(overlay).toBeVisible();

  await page.goBack();

  await expect(overlay).toBeHidden();
  await expect(startButton).toBeVisible();
  expect(new URL(page.url()).search).toBe("?date=2026-11-02");
});
