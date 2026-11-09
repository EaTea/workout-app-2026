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
    scope.__audioContextCount = 0;
    scope.__audioSessionTypes = [];
    navigator.vibrate = (pattern) => {
      (scope.__vibrations as unknown[]).push(pattern);
      return true;
    };
    Object.defineProperty(navigator, "audioSession", {
      configurable: true,
      value: {
        set type(value: string) { (scope.__audioSessionTypes as string[]).push(value); },
      },
    });
    scope.AudioContext = class {
      constructor() { (scope.__audioContextCount as number) += 1; }
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

  const startEmom = page.getByRole("button", { name: "Start EMOM, Pull-ups" });
  await expect(startEmom).toBeVisible();
  await startEmom.click();

  const overlay = page.getByRole("dialog", { name: "Pull-ups EMOM timer" });
  await expect(overlay).toBeVisible();
  await expect(overlay.locator(".timer-title")).toHaveText("Pull-ups EMOM · 9 min");
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

  // Finished reads DONE (not the green WORK/neutral minute styling) and the ring is gone.
  await expect(overlay.locator(".timer-phase")).toHaveText("DONE");
  await expect(overlay.locator(".timer-ring")).toBeHidden();

  await overlay.getByRole("button", { name: "Done" }).click();
  await expect(overlay).toBeHidden();
  await expect(startEmom).toBeFocused();
});

test("pausing stops the EMOM from progressing", async ({ page }) => {
  await openToday(page);
  await page.getByRole("button", { name: "Start EMOM, Pull-ups" }).click();
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
  await page.getByRole("button", { name: "Start timer, Heavy bag finisher" }).click();

  // The dialog's accessible name is stable while the visible title follows the rounds.
  const overlay = page.getByRole("dialog", { name: "Heavy bag timer" });
  await expect(overlay).toBeVisible();
  await expect(overlay.locator(".timer-title")).toHaveText("Heavy bag · 5 rounds");
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
  await expect(overlay.locator(".timer-title")).toHaveText("Heavy bag · 3 rounds");
  await expect(overlay).toBeVisible();
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

  await page.getByRole("button", { name: "Start timer, Heavy bag finisher" }).click();

  const overlay = page.getByRole("dialog", { name: "Heavy bag timer" });
  await expect(overlay.locator(".timer-title")).toHaveText("Heavy bag · 2 rounds");
});

test("a rest timer from a set: default 30s, raise to 35s, finish cue and buzz", async ({ page }) => {
  await openToday(page);

  const restButton = page.getByRole("button", { name: "Rest 30s, Med ball slams" });
  await expect(restButton).toHaveText("Rest 30s");
  await restButton.click();

  const overlay = page.getByRole("dialog", { name: "Rest timer" });
  await expect(overlay.locator(".timer-title")).toHaveText("Rest · Med ball slams");
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
  // The adjusted 35s was started, so the button now says so (same element, still focused).
  await expect(page.getByRole("button", { name: "Rest 35s, Med ball slams" })).toBeFocused();
});

test("the superset block has a between-pairs rest button defaulting to 45s", async ({ page }) => {
  await openToday(page);

  // The visible caption is the whole accessible name, so voice control ("tap Rest 45s between pairs") works.
  const betweenPairs = page.getByRole("button", { name: "Rest 45s between pairs", exact: true });
  await expect(betweenPairs).toHaveText("Rest 45s between pairs");
  await betweenPairs.click();

  const overlay = page.getByRole("dialog", { name: "Rest timer" });
  await expect(overlay.locator(".timer-title")).toHaveText("Rest · Between pairs");
  await expect(overlay.locator(".timer-digits")).toHaveText("0:45");
});

/** Everything the fake navigator.wakeLock has handed out so far, and whether each lock was released. */
function wakeLocks(page: Page): Promise<{ type: string; released: boolean }[]> {
  return page.evaluate(() => (window as unknown as { __wakeLocks: { type: string; released: boolean }[] }).__wakeLocks);
}

test("the screen wake lock is held for as long as the timer is open, and released on close", async ({ page }) => {
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
  expect(await wakeLocks(page)).toEqual([]);

  await page.getByRole("button", { name: "Start EMOM, Pull-ups" }).click();
  const overlay = page.getByRole("dialog", { name: "Pull-ups EMOM timer" });

  // Held while merely ready, and still held through pause and resume.
  await expect.poll(() => wakeLocks(page)).toEqual([{ type: "screen", released: false }]);
  await overlay.getByRole("button", { name: "Start" }).click();
  await overlay.getByRole("button", { name: "❚❚ Pause" }).click();
  await overlay.getByRole("button", { name: "▶ Resume" }).click();
  expect(await wakeLocks(page)).toEqual([{ type: "screen", released: false }]);

  await overlay.getByRole("button", { name: "✕ Close" }).click();
  await expect(overlay).toBeHidden();
  await expect.poll(() => wakeLocks(page)).toEqual([{ type: "screen", released: true }]);
});

test("every timer shares one audio context, and taps resume it and ask for playback audio", async ({ page }) => {
  await openToday(page);
  const audioContextCount = () => page.evaluate(() => (window as unknown as { __audioContextCount: number }).__audioContextCount);

  // Before any tap no context exists (browsers only allow audio after a gesture).
  expect(await audioContextCount()).toBe(0);

  for (let timerNumber = 0; timerNumber < 3; timerNumber += 1) {
    await page.getByRole("button", { name: "Rest 30s, Med ball slams" }).click();
    const overlay = page.getByRole("dialog", { name: "Rest timer" });
    await overlay.getByRole("button", { name: "Start" }).click();
    await page.clock.runFor(31_000);
    await expect(overlay.getByRole("button", { name: "Done" })).toBeVisible();
    await overlay.getByRole("button", { name: "Done" }).click();
    await expect(overlay).toBeHidden();
  }

  expect(await audioContextCount()).toBe(1);
  // The silent-switch hint was requested once, when the context was made.
  expect(await page.evaluate(() => (window as unknown as { __audioSessionTypes: string[] }).__audioSessionTypes)).toEqual(["playback"]);
});

test("after the page sleeps, a catch-up plays only the latest cue", async ({ page }) => {
  await openToday(page);
  await page.getByRole("button", { name: "Start timer, Heavy bag finisher" }).click();
  const overlay = page.getByRole("dialog", { name: "Heavy bag timer" });
  await overlay.getByRole("button", { name: "Start" }).click();
  const beepsBefore = await page.evaluate(() => (window as unknown as { __beeps: number[] }).__beeps.length);

  // One big jump of 100s covers work(30) rest(30) work(30) rest(10): several segment starts in one update.
  await page.clock.fastForward(100_000);
  await expect(overlay.locator(".timer-phase")).toHaveText("REST");

  const beepsAfter = await page.evaluate(
    (skip) => (window as unknown as { __beeps: number[] }).__beeps.slice(skip),
    beepsBefore,
  );
  // Only the latest segment's cue (a rest beep); no burst for the work/rest starts that were jumped over.
  expect(beepsAfter.filter((frequency) => frequency === 523)).toHaveLength(1);
  expect(beepsAfter.filter((frequency) => frequency === 1175)).toHaveLength(0);
});

test("focus moves to a working control when the focused one becomes disabled", async ({ page }) => {
  await openToday(page);
  await page.getByRole("button", { name: "Start timer, Heavy bag finisher" }).click();
  const overlay = page.getByRole("dialog", { name: "Heavy bag timer" });

  // Rounds 5 -> 1: the decrease button disables itself, focus goes to its opposite.
  const decrease = overlay.getByRole("button", { name: "Decrease rounds" });
  for (let click = 0; click < 4; click += 1) await decrease.click();
  await expect(decrease).toBeDisabled();
  await expect(overlay.getByRole("button", { name: "Increase rounds" })).toBeFocused();

  // Skip through the only round: Skip disables itself on finish, focus goes to the primary button.
  await overlay.getByRole("button", { name: "Start" }).click();
  await overlay.getByRole("button", { name: "Skip ›" }).click();
  await expect(overlay.locator(".timer-phase")).toHaveText("DONE");
  await expect(overlay.getByRole("button", { name: "Done" })).toBeFocused();
});

test("a rest adjusted and started is remembered for the next open and the button label", async ({ page }) => {
  await openToday(page);
  await page.getByRole("button", { name: "Rest 30s, Med ball slams" }).click();
  const overlay = page.getByRole("dialog", { name: "Rest timer" });
  await overlay.getByRole("button", { name: "Increase rest" }).click();
  await expect(overlay.locator(".timer-digits")).toHaveText("0:35");
  await overlay.getByRole("button", { name: "Start" }).click();
  await overlay.getByRole("button", { name: "✕ Close" }).click();
  await expect(overlay).toBeHidden();

  // The button label follows, and reopening starts at the remembered value.
  const restButton = page.getByRole("button", { name: "Rest 35s, Med ball slams" });
  await expect(restButton).toHaveText("Rest 35s");
  await restButton.click();
  await expect(page.getByRole("dialog", { name: "Rest timer" }).locator(".timer-digits")).toHaveText("0:35");
});

test("an adjusted rest that was never started is not remembered", async ({ page }) => {
  await openToday(page);
  await page.getByRole("button", { name: "Rest 30s, Med ball slams" }).click();
  const overlay = page.getByRole("dialog", { name: "Rest timer" });
  await overlay.getByRole("button", { name: "Increase rest" }).click();
  await overlay.getByRole("button", { name: "✕ Close" }).click();

  await expect(page.getByRole("button", { name: "Rest 30s, Med ball slams" })).toHaveText("Rest 30s");
});

test("Skip during an EMOM moves to the next minute and round", async ({ page }) => {
  await openToday(page);
  await page.getByRole("button", { name: "Start EMOM, Pull-ups" }).click();
  const overlay = page.getByRole("dialog", { name: "Pull-ups EMOM timer" });
  await overlay.getByRole("button", { name: "Start" }).click();
  await expect(overlay.locator(".timer-ring-number")).toHaveText("1/9");

  await overlay.getByRole("button", { name: "Skip ›" }).click();
  await expect(overlay.locator(".timer-ring-number")).toHaveText("2/9");
  await expect(overlay.locator(".timer-digits")).toHaveText("1:00");
});

test("after the page was hidden for several segments, becoming visible shows the right later segment", async ({ page }) => {
  await openToday(page);
  await page.getByRole("button", { name: "Start timer, Heavy bag finisher" }).click();
  const overlay = page.getByRole("dialog", { name: "Heavy bag timer" });
  await overlay.getByRole("button", { name: "Start" }).click();

  // Hide the page and let the clock jump 70s (work 30, rest 30, work 10 into round 2) with no timers firing.
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
  });
  await page.clock.setSystemTime(new Date("2026-11-02T09:01:10"));
  await expect(overlay.locator(".timer-phase")).toHaveText("WORK");
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });

  await expect(overlay.getByText("Round 2 of 5")).toBeVisible();
  await expect(overlay.locator(".timer-phase")).toHaveText("WORK");
  await expect(overlay.locator(".timer-digits")).toHaveText("0:20");
});
