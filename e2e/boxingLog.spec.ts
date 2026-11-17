import { expect, test, type Page } from "@playwright/test";

/**
 * Logging a round from the heavy bag timer (PR 35 of PLAN.md): Week 2 Day 1,
 * 9 Nov 2026, the program started 2 Nov. The round button is hidden during
 * the gear-up break (there is no round yet) and appears once round 1 starts.
 */
async function openWeekTwoDayOne(page: Page): Promise<void> {
  await page.clock.install({ time: new Date("2026-11-09T09:00:00") });
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "explosive-endurance.settings",
      JSON.stringify({ version: 2, startDate: "2026-11-02", maxReps: { pull_up: 12, dip: 15 }, maxSavedOn: {} }),
    );
  });
  await page.goto("/");
}

test("Log set on the heavy bag timer logs that round, and Today counts it", async ({ page }) => {
  await openWeekTwoDayOne(page);

  await page.getByRole("button", { name: "Start timer, Heavy bag finisher" }).click();
  const overlay = page.getByRole("dialog", { name: "Heavy bag timer" });
  await expect(overlay.locator(".timer-phase")).toHaveText("GEAR UP");
  // No round yet during the gear-up break, so no log button.
  await expect(overlay.getByRole("button", { name: /Log set/ })).toHaveCount(0);

  await overlay.getByRole("button", { name: "Start" }).click();
  await overlay.getByRole("button", { name: "Ready, start round 1" }).click();
  await expect(overlay.getByText("Round 1 of 5")).toBeVisible();

  await overlay.getByRole("button", { name: "Log set 1" }).click();
  await expect(overlay.getByRole("button", { name: "Logged set 1" })).toBeFocused();

  await overlay.getByRole("button", { name: /Close/ }).click();
  await expect(overlay).toBeHidden();
  await expect(page.locator(".item-row").filter({ hasText: "Heavy bag finisher" }).first().locator(".item-progress")).toContainText("1/5");
});
