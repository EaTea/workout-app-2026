import { expect, test, type Page } from "@playwright/test";

/** Fixes the page's clock at Monday 2 Nov 2026, so a program started today is on Week 1 · Day 1. */
async function fixClockOnDayOne(page: Page): Promise<void> {
  await page.clock.install({ time: new Date("2026-11-02T09:00:00") });
}

/** Reads a stored value (a JSON string, or null) straight from localStorage, to check what was saved. */
async function readStored(page: Page, key: string): Promise<unknown> {
  return page.evaluate((storageKey) => {
    const raw = window.localStorage.getItem(storageKey);
    return raw === null ? null : JSON.parse(raw);
  }, key);
}

/** Today's row for an exercise name. */
function row(page: Page, name: string) {
  return page.locator(".item-row", { hasText: name });
}

test.describe("first visit", () => {
  // A fresh browser: nothing stored, so no program has been chosen.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("lists both programs, and a started Steady Strength then keeps its own data apart from Explosive Endurance", async ({ page }) => {
    await fixClockOnDayOne(page);
    await page.goto("/");

    // 1. The picker lists both programs.
    await expect(page.getByRole("heading", { name: "Choose your program" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Explosive Endurance Program/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Steady Strength/ })).toBeVisible();

    // 2. Choosing Steady Strength opens its overview, with the safety card.
    await page.getByRole("button", { name: /Steady Strength/ }).click();
    await expect(page.getByRole("heading", { name: "Program overview" })).toBeVisible();
    await expect(page.locator(".overview-program-row")).toContainText("Steady Strength");
    await expect(page.locator(".safety-notes-card").getByRole("heading", { name: "Before you start" })).toBeVisible();

    // "Start Day 1: Legs and core" opens Today at Week 1 · Day 1.
    await page.getByRole("button", { name: "Start Day 1: Legs and core" }).click();
    await expect(page.getByText("2 Nov · Week 1 of 8 · Day 1")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Legs and core" })).toBeVisible();
    await expect(page.locator(".block-title")).toHaveCount(6);
    const blockTitles = await page.locator(".block-title").allTextContents();
    for (const title of ["Warm-up", "Balance", "Isometric holds", "Strength", "Core", "Cool-down"]) {
      expect(blockTitles.some((text) => text.includes(title)), `block "${title}"`).toBe(true);
    }
    await expect(page.locator(".checkin-card")).toHaveCount(0);
    await expect(page.getByText("Set max")).toHaveCount(0);
    expect(await readStored(page, "steady-strength.settings")).toMatchObject({ startDate: "2026-11-02" });

    // 3. An interval hold starts the timer: 4 rounds of 20s.
    await page.getByRole("button", { name: "Start timer, Single-leg stand at the counter" }).click();
    const timer = page.getByRole("dialog", { name: /timer/i });
    await expect(timer.locator(".timer-title")).toContainText("4 rounds");
    await expect(timer.locator(".timer-phase")).toHaveText("WORK");
    await expect(timer.locator(".timer-digits")).toHaveText("0:20");
    await timer.getByRole("button", { name: /Close/ }).click();
    await expect(timer).toBeHidden();

    // 4. Log one set of sit-to-stand.
    await row(page, "Sit-to-stand").locator(".item-open").click();
    await page.getByRole("button", { name: /✓ Log set/ }).click();
    await page.getByRole("dialog", { name: "Rest timer" }).getByRole("button", { name: "✕ Close" }).click();
    await page.getByRole("link", { name: "Back to Today", exact: true }).click();
    await expect(row(page, "Sit-to-stand").locator(".item-progress")).toHaveText("1/3");

    // Switch to Explosive Endurance: it starts with no start date (first-run state).
    await page.goto("/#/overview");
    await page.getByRole("link", { name: "Switch program" }).click();
    await expect(page.getByRole("heading", { name: "Choose your program" })).toBeVisible();
    await page.getByRole("button", { name: /Explosive Endurance Program/ }).click();
    await expect(page.getByRole("heading", { name: "Program overview" })).toBeVisible();
    await expect(page.locator(".overview-program-row")).toContainText("Explosive Endurance");
    expect(await readStored(page, "explosive-endurance.settings")).toBeNull();
    await expect(page.getByRole("button", { name: /^Start Day 1/ })).toBeVisible();

    // Give Explosive a different start date (26 Oct, so it is on Week 2), and log nothing.
    await page.evaluate(() =>
      window.localStorage.setItem("explosive-endurance.settings", JSON.stringify({ version: 2, startDate: "2026-10-26", maxReps: { pull_up: 12, dip: 15 }, maxSavedOn: {} })),
    );
    await page.goto("/#/today");
    await page.reload(); // the app reads its saved data at startup
    await expect(page.getByText("2 Nov · Week 2 of 8 · Day 1")).toBeVisible();

    // Back to Steady Strength: its start date and its logged set are untouched.
    await page.goto("/#/overview");
    await page.getByRole("link", { name: "Switch program" }).click();
    await page.getByRole("button", { name: /Steady Strength/ }).click();
    await page.goto("/#/today");
    await expect(page.getByText("2 Nov · Week 1 of 8 · Day 1")).toBeVisible();
    await expect(row(page, "Sit-to-stand").locator(".item-progress")).toHaveText("1/3");
    expect(await readStored(page, "steady-strength.settings")).toMatchObject({ startDate: "2026-11-02" });

    // And Explosive Endurance, again, still has its own start date and no sets.
    await page.goto("/#/settings");
    await page.getByRole("link", { name: "Switch program" }).click();
    await page.getByRole("button", { name: /Explosive Endurance Program/ }).click();
    await page.goto("/#/today");
    await expect(page.getByText("2 Nov · Week 2 of 8 · Day 1")).toBeVisible();
    expect(await readStored(page, "explosive-endurance.settings")).toMatchObject({ startDate: "2026-10-26" });
    expect(await readStored(page, "explosive-endurance.log")).toBeNull();
  });

  test("with no chosen program but saved Explosive Endurance data, the app opens Explosive's Today, not the picker", async ({ page }) => {
    await fixClockOnDayOne(page);
    await page.addInitScript(() => {
      window.localStorage.setItem(
        "explosive-endurance.settings",
        JSON.stringify({ version: 2, startDate: "2026-11-02", maxReps: { pull_up: 12, dip: 15 }, maxSavedOn: {} }),
      );
    });
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Choose your program" })).toHaveCount(0);
    await expect(page.getByText("2 Nov · Week 1 of 8 · Day 1")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Upper: pull" })).toBeVisible();
  });
});
