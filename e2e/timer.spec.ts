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

test("the heavy bag timer: adjust rounds, run work and rest, finish after 3 rounds", async ({ page }) => {
  await openToday(page);
  await page.getByRole("button", { name: "Start interval timer for Heavy bag finisher" }).click();

  // The dialog's name follows the plan title, which changes with the rounds, so find it by class.
  const overlay = page.locator(".timer-view");
  await expect(page.getByRole("dialog", { name: "Heavy bag · 5 rounds" })).toBeVisible();
  await expect(overlay.locator(".timer-phase")).toHaveText("WORK");
  await expect(overlay.locator(".timer-digits")).toHaveText("0:30");
  await expect(overlay.getByText("Round 1 of 5")).toBeVisible();
  await expect(overlay.getByText("5 rounds", { exact: true })).toBeVisible();

  // Stepper buttons are thumb-sized.
  const decrease = overlay.getByRole("button", { name: "Decrease rounds" });
  const box = await decrease.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(48);
  expect(box?.height).toBeGreaterThanOrEqual(48);

  await decrease.click();
  await decrease.click();
  await expect(page.getByRole("dialog", { name: "Heavy bag · 3 rounds" })).toBeVisible();
  await expect(overlay.getByText("Round 1 of 3")).toBeVisible();

  await overlay.getByRole("button", { name: "Start" }).click();
  // Once started the setup is locked: no steppers, just the summary.
  await expect(overlay.getByRole("button", { name: "Decrease rounds" })).toBeHidden();
  await expect(overlay.getByText("Work 30s · Rest 30s · 3 rounds")).toBeVisible();
  expect(await vibrations(page)).toEqual([[150]]);

  await page.clock.runFor(31_000);
  await expect(overlay.locator(".timer-phase")).toHaveText("REST");
  await expect(overlay.getByText("Round 1 of 3")).toBeVisible();
  expect(await vibrations(page)).toContainEqual([80, 60, 80]);
  const beeps = await page.evaluate(() => (window as unknown as { __beeps: number[] }).__beeps);
  expect(beeps).toContain(1175);
  expect(beeps).toContain(523);

  await page.clock.runFor(120_000);
  await expect(overlay.getByRole("button", { name: "Done" })).toBeVisible();
  expect(await vibrations(page)).toContainEqual([300, 100, 300]);
});

test("a deload week heavy bag timer defaults to 2 rounds", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-11-23T09:00:00") });
  await page.addInitScript((settings) => {
    window.localStorage.setItem("explosive-endurance.settings", JSON.stringify(settings));
  }, { version: 2, startDate: "2026-11-02", maxReps: { pull_up: 12, dip: 15 }, maxSavedOn: {} });
  await page.goto("/");

  await page.getByRole("button", { name: "Start interval timer for Heavy bag finisher" }).click();

  await expect(page.getByRole("dialog", { name: "Heavy bag · 2 rounds" })).toBeVisible();
});

test("a rest timer from a set: default 30s, raise to 35s, finish cue and buzz", async ({ page }) => {
  await openToday(page);

  const restButton = page.getByRole("button", { name: "Start rest timer for Med ball slams" });
  await expect(restButton).toHaveText("Rest 30s");
  await restButton.click();

  // The dialog's name follows the plan title, so find the overlay by class.
  const overlay = page.locator(".timer-view");
  await expect(page.getByRole("dialog", { name: "Rest · Med ball slams" })).toBeVisible();
  await expect(overlay.locator(".timer-digits")).toHaveText("0:30");
  await expect(overlay.locator(".timer-stepper-value")).toHaveText("Rest 30s");

  await overlay.getByRole("button", { name: "Increase rest" }).click();
  await expect(overlay.locator(".timer-digits")).toHaveText("0:35");
  await expect(overlay.locator(".timer-stepper-value")).toHaveText("Rest 35s");

  await overlay.getByRole("button", { name: "Start" }).click();
  await expect(overlay.locator(".timer-phase")).toHaveText("REST");
  await expect(overlay.getByText("Next set when it ends")).toBeVisible();

  await page.clock.runFor(36_000);
  await expect(overlay.getByRole("button", { name: "Done" })).toBeVisible();
  expect(await vibrations(page)).toContainEqual([300, 100, 300]);

  await overlay.getByRole("button", { name: "Done" }).click();
  await expect(overlay).toBeHidden();
  await expect(restButton).toBeFocused();
});

test("the superset block has a between-pairs rest button defaulting to 45s", async ({ page }) => {
  await openToday(page);

  const betweenPairs = page.getByRole("button", { name: "Start rest timer between pairs" });
  await expect(betweenPairs).toHaveText("Rest 45s");
  await betweenPairs.click();

  await expect(page.getByRole("dialog", { name: "Rest · Between pairs" })).toBeVisible();
  await expect(page.locator(".timer-view .timer-digits")).toHaveText("0:45");
});

test("the screen wake lock is held while a timer runs, dropped on pause, and released on close", async ({ page }) => {
  await page.addInitScript(() => {
    const scope = window as unknown as { __wakeLocks: { type: string; released: boolean }[] };
    scope.__wakeLocks = [];
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: {
        request: async (type: string) => {
          const record = { type, released: false };
          scope.__wakeLocks.push(record);
          return { release: async () => { record.released = true; } };
        },
      },
    });
  });
  await openToday(page);

  const wakeLocks = () => page.evaluate(() => (window as unknown as { __wakeLocks: { type: string; released: boolean }[] }).__wakeLocks);

  await page.getByRole("button", { name: "Start EMOM for Pull-ups" }).click();
  const overlay = page.getByRole("dialog", { name: "Pull-ups EMOM · 9 min" });
  expect(await wakeLocks()).toEqual([]);

  await overlay.getByRole("button", { name: "Start" }).click();
  await expect.poll(wakeLocks).toEqual([{ type: "screen", released: false }]);

  await overlay.getByRole("button", { name: "❚❚ Pause" }).click();
  await expect.poll(wakeLocks).toEqual([{ type: "screen", released: true }]);

  await overlay.getByRole("button", { name: "▶ Resume" }).click();
  await expect.poll(wakeLocks).toEqual([
    { type: "screen", released: true },
    { type: "screen", released: false },
  ]);

  await overlay.getByRole("button", { name: "✕ Close" }).click();
  await expect(overlay).toBeHidden();
  await expect.poll(wakeLocks).toEqual([
    { type: "screen", released: true },
    { type: "screen", released: true },
  ]);
});
