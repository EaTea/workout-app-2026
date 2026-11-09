import { expect, test, type Page } from "@playwright/test";

/**
 * Opens Today on Day 1 (week 1) with a fake clock, a recording stand-in for
 * navigator.vibrate and a recording fake AudioContext, so the EMOM timer can
 * be run in seconds and its cues checked.
 */
async function openToday(page: Page): Promise<void> {
  await page.clock.install({ time: new Date("2026-11-02T09:00:00") });
  await page.addInitScript((settings) => {
    window.localStorage.setItem("explosive-endurance.settings", JSON.stringify(settings));

    const scope = window as unknown as Record<string, unknown>;
    scope.__vibrations = [];
    scope.__beeps = [];
    navigator.vibrate = (pattern) => {
      (scope.__vibrations as unknown[]).push(pattern);
      return true;
    };
    scope.AudioContext = class {
      currentTime = 0;
      state = "running";
      destination = {};
      resume() {}
      createGain() { return { gain: { value: 0 }, connect() {} }; }
      createOscillator() {
        const oscillator = {
          frequency: { value: 0 },
          connect() {},
          start() { (scope.__beeps as unknown[]).push(oscillator.frequency.value); },
          stop() {},
        };
        return oscillator;
      }
    };
  }, { version: 2, startDate: "2026-11-02", maxReps: { pull_up: 12, dip: 15 }, maxSavedOn: {} });

  await page.goto("/");
}

/** Everything the page recorded through the fake navigator.vibrate. */
function vibrations(page: Page): Promise<number[][]> {
  return page.evaluate(() => (window as unknown as { __vibrations: number[][] }).__vibrations);
}

test("an EMOM runs minute by minute, vibrates, finishes and returns focus to Today", async ({ page }) => {
  await openToday(page);

  const startEmom = page.getByRole("button", { name: "Start EMOM for Pull-ups" });
  await expect(startEmom).toBeVisible();
  await startEmom.click();

  const overlay = page.getByRole("dialog", { name: "Pull-ups EMOM · 9 min" });
  await expect(overlay).toBeVisible();
  await expect(overlay.locator(".timer-ring-number")).toHaveText("1/9");
  await expect(overlay.getByText("Target 4 reps")).toBeVisible();

  await overlay.getByRole("button", { name: "Start" }).click();
  expect(await vibrations(page)).toEqual([[150]]);

  await page.clock.runFor(61_000);
  await expect(overlay.locator(".timer-ring-number")).toHaveText("2/9");
  expect((await vibrations(page)).length).toBeGreaterThanOrEqual(2);

  // Beeps were played through the (fake) audio context, including the 3-2-1 ticks.
  const beeps = await page.evaluate(() => (window as unknown as { __beeps: number[] }).__beeps);
  expect(beeps).toContain(880);
  expect(beeps.filter((frequency) => frequency === 660)).toHaveLength(3);

  await page.clock.runFor(8 * 60_000);
  await expect(overlay.getByRole("button", { name: "Done" })).toBeVisible();
  expect(await vibrations(page)).toContainEqual([300, 100, 300]);

  await overlay.getByRole("button", { name: "Done" }).click();
  await expect(overlay).toBeHidden();
  await expect(startEmom).toBeFocused();
});

test("pausing stops the EMOM from progressing", async ({ page }) => {
  await openToday(page);
  await page.getByRole("button", { name: "Start EMOM for Pull-ups" }).click();
  const overlay = page.getByRole("dialog");

  await overlay.getByRole("button", { name: "Start" }).click();
  await page.clock.runFor(5_000);
  await overlay.getByRole("button", { name: "❚❚ Pause" }).click();

  await page.clock.runFor(30_000);
  await expect(overlay.locator(".timer-ring-number")).toHaveText("1/9");
  await expect(overlay.locator(".timer-digits")).toHaveText("0:55");

  await overlay.getByRole("button", { name: "▶ Resume" }).click();
  await page.clock.runFor(56_000);
  await expect(overlay.locator(".timer-ring-number")).toHaveText("2/9");
});

test("the row button still opens the exercise details", async ({ page }) => {
  await openToday(page);
  await page.locator(".item-open", { hasText: "Pull-ups" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog", { name: /EMOM/ })).toHaveCount(0);
});
