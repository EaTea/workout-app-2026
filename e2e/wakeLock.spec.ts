import { expect, test, type Page } from "@playwright/test";

/** Records every navigator.wakeLock request in window.__wakeLocks, before the app first loads. */
async function installFakeWakeLock(page: Page): Promise<void> {
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
}

/** How many fake wake locks are held right now (requested and not yet released). */
function heldLockCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __wakeLocks: { released: boolean }[] }).__wakeLocks.filter((lock) => !lock.released).length);
}

/** Saves settings the way the app stores them (start 2 Nov, so 9 Nov is a training day), before the app first loads. */
async function seedSettings(page: Page): Promise<void> {
  await page.addInitScript((settings) => {
    window.localStorage.setItem("explosive-endurance.settings", JSON.stringify(settings));
  }, { version: 1, startDate: "2026-11-02", maxReps: { pull_up: 12, dip: 15 } });
}

/**
 * Saves a log for 9 Nov (week 2, day 1) in the stored (wire) format with every
 * set of every item logged except heavy bag round 4, which is the last one
 * the session needs (the program says 4-5 rounds, so 4 completes it). The
 * item set counts match the program on that date: block 1 ytwi 2 and
 * pallof_press 2, block 2 med_ball_slam 6, block 3 pull_up 9, block 4 dip 2,
 * block 5 back_extension 4, hanging_leg_raise 3 and side_plank 2, block 6
 * heavy_bag 3 (of 4-5). Logged "now", so the 45-minute idle timeout has not passed.
 */
async function seedAllButLastNeededHeavyBagRound(page: Page): Promise<void> {
  const items: [number, string, number][] = [
    [1, "ytwi", 2], [1, "pallof_press", 2], [2, "med_ball_slam", 6], [3, "pull_up", 9], [4, "dip", 2],
    [5, "back_extension", 4], [5, "hanging_leg_raise", 3], [5, "side_plank", 2], [6, "heavy_bag", 3],
  ];
  const sets = items.flatMap(([blockPosition, exerciseId, count]) =>
    Array.from({ length: count }, (_unused, index) => ({ exerciseId, blockPosition, setNumber: index + 1, loggedAt: new Date().toISOString() })),
  );
  await page.addInitScript((log) => {
    window.localStorage.setItem("explosive-endurance.log", JSON.stringify(log));
  }, { version: 1, sessions: [{ date: "2026-11-09", programWeek: 2, day: 1, sets }] });
}

test("the screen stays awake from the first logged set, only on Today and the log screen", async ({ page }) => {
  await installFakeWakeLock(page);
  await seedSettings(page);
  await page.goto("/?date=2026-11-09");

  // Nothing logged yet: no lock.
  await expect(page.getByRole("heading", { name: "Upper: pull" })).toBeVisible();
  expect(await heldLockCount(page)).toBe(0);

  // Log one set of med ball slams: the session is now in progress.
  await page.locator(".item-row", { hasText: "Med ball slams" }).locator(".item-open").click();
  await page.getByRole("button", { name: /✓ Log set/ }).click();
  await page.getByRole("dialog", { name: "Rest timer" }).getByRole("button", { name: "✕ Close" }).click();
  await expect.poll(() => heldLockCount(page)).toBe(1);

  // History is not a session screen: released. Back on Today: held again.
  await page.getByRole("link", { name: "History" }).click();
  await expect(page.getByRole("heading", { name: "History" })).toBeVisible();
  await expect.poll(() => heldLockCount(page)).toBe(0);

  await page.getByRole("link", { name: "Today" }).click();
  await expect.poll(() => heldLockCount(page)).toBe(1);

  // Settings releases it too.
  await page.getByRole("link", { name: "Settings" }).click();
  await expect.poll(() => heldLockCount(page)).toBe(0);
});

test("logging the last set the session needs releases the lock", async ({ page }) => {
  await installFakeWakeLock(page);
  await seedSettings(page);
  await seedAllButLastNeededHeavyBagRound(page);
  await page.goto("/?date=2026-11-09#/log/2026-11-09/6/heavy_bag");

  // One round short of the 4 the session needs: it is in progress.
  await expect.poll(() => heldLockCount(page)).toBe(1);

  // Round 4 completes a 4-5 round item, so the session is done even though round 5 is unlogged.
  await page.getByRole("button", { name: /✓ Log/ }).click();
  await expect(page.getByRole("button", { name: "Round 4, Done, tap to edit" })).toBeVisible();
  await expect.poll(() => heldLockCount(page)).toBe(0);
});

test("the lock is released when the clock passes midnight, though the session is only minutes old", async ({ page }) => {
  await installFakeWakeLock(page);
  await seedSettings(page);
  await page.clock.install({ time: new Date("2026-11-09T23:50:00") });
  await page.goto("/");
  await expect(page.getByText("9 Nov · Week 2 of 8 · Day 1")).toBeVisible();

  // Log one set at 23:50: in progress, lock held.
  await page.locator(".item-row", { hasText: "Med ball slams" }).locator(".item-open").click();
  await page.getByRole("button", { name: /✓ Log set/ }).click();
  await page.getByRole("dialog", { name: "Rest timer" }).getByRole("button", { name: "✕ Close" }).click();
  await expect.poll(() => heldLockCount(page)).toBe(1);

  // 15 minutes later it is 00:05 on 10 Nov: well inside the 45-minute idle timeout, but the day is over.
  await page.clock.runFor(15 * 60_000);
  await expect.poll(() => heldLockCount(page)).toBe(0);
});

test("the lock is released 45 minutes after the last logged set", async ({ page }) => {
  await installFakeWakeLock(page);
  await seedSettings(page);
  await page.clock.install({ time: new Date("2026-11-09T18:00:00") });
  await page.goto("/");
  await expect(page.getByText("9 Nov · Week 2 of 8 · Day 1")).toBeVisible();

  await page.locator(".item-row", { hasText: "Med ball slams" }).locator(".item-open").click();
  await page.getByRole("button", { name: /✓ Log set/ }).click();
  await page.getByRole("dialog", { name: "Rest timer" }).getByRole("button", { name: "✕ Close" }).click();
  await expect.poll(() => heldLockCount(page)).toBe(1);

  await page.clock.runFor(30 * 60_000);
  expect(await heldLockCount(page)).toBe(1);

  await page.clock.runFor(16 * 60_000);
  await expect.poll(() => heldLockCount(page)).toBe(0);
});
