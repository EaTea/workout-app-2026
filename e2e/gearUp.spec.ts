import { expect, test } from "@playwright/test";

/**
 * The heavy bag's gear-up break (PLAN PR 28, rule 4): Week 2 Day 1 starts
 * 9 Nov 2026 with the program starting 2 Nov. The timer opens with a 2:00
 * "GEAR UP" countdown; "Ready" (Skip) starts round 1.
 */
test("the heavy bag timer opens with a gear-up break that Ready ends", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-11-09T09:00:00") });
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "explosive-endurance.settings",
      JSON.stringify({ version: 2, startDate: "2026-11-02", maxReps: { pull_up: 12, dip: 15 }, maxSavedOn: {} }),
    );
  });
  await page.goto("/");

  await page.getByRole("button", { name: "Start timer, Heavy bag finisher" }).click();
  const overlay = page.getByRole("dialog", { name: "Heavy bag timer" });
  await expect(overlay.locator(".timer-stepper-value", { hasText: "Gear up 2:00" })).toBeVisible();
  await expect(overlay.locator(".timer-phase")).toHaveText("GEAR UP");
  await expect(overlay.locator(".timer-digits")).toHaveText("2:00");

  // With four steppers the whole setup screen must still fit a phone: Start fully inside the viewport, steppers still 48px.
  await page.setViewportSize({ width: 390, height: 664 });
  const startBox = await overlay.getByRole("button", { name: "Start" }).boundingBox();
  expect((startBox?.y ?? 0) + (startBox?.height ?? 0)).toBeLessThanOrEqual(664);
  const stepperBox = await overlay.getByRole("button", { name: "Increase gear up" }).boundingBox();
  expect(stepperBox?.width).toBeGreaterThanOrEqual(48);
  expect(stepperBox?.height).toBeGreaterThanOrEqual(48);

  await overlay.getByRole("button", { name: "Start" }).click();
  await expect(overlay.locator(".timer-phase")).toHaveText("GEAR UP");
  await expect(overlay.getByText("Round 1 starts after the countdown")).toBeVisible();
  await expect(overlay.getByRole("button", { name: "Ready, start round 1" })).toHaveText("Ready ›");

  await overlay.getByRole("button", { name: "Ready, start round 1" }).click();
  await expect(overlay.locator(".timer-phase")).toHaveText("WORK");
  await expect(overlay.getByText("Round 1 of 5")).toBeVisible();
  await expect(overlay.getByRole("button", { name: "Skip ›" })).toBeVisible();
});

test("the gear-up round start happens by itself when the countdown ends", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-11-09T09:00:00") });
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "explosive-endurance.settings",
      JSON.stringify({ version: 2, startDate: "2026-11-02", maxReps: { pull_up: 12, dip: 15 }, maxSavedOn: {} }),
    );
  });
  await page.goto("/");

  await page.getByRole("button", { name: "Start timer, Heavy bag finisher" }).click();
  const overlay = page.getByRole("dialog", { name: "Heavy bag timer" });
  await overlay.getByRole("button", { name: "Start" }).click();
  await page.clock.runFor(121_000);

  await expect(overlay.locator(".timer-phase")).toHaveText("WORK");
  await expect(overlay.getByText("Round 1 of 5")).toBeVisible();
});
