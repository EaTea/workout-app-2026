import { expect, test, type Page } from "@playwright/test";

/**
 * Optional boxing on Today (PR 29): start date 2 Nov 2026, so 9 Nov is week 2
 * day 1 (heavy bag finisher marked optional) and 10 Nov is day 2 (no
 * optional block). The clock is fixed at noon on 9 Nov, so 9 Nov is "today"
 * and later dates are in the future.
 */

/** Saves settings before the app first loads, only when nothing is stored yet (so a reload keeps what the app saved), and fixes the clock. */
async function seedAt(page: Page, isoDate = "2026-11-09"): Promise<void> {
  await page.addInitScript((settings) => {
    if (window.localStorage.getItem("explosive-endurance.settings") === null) {
      window.localStorage.setItem("explosive-endurance.settings", JSON.stringify(settings));
    }
  }, { version: 1, startDate: "2026-11-02", maxReps: { pull_up: 12, dip: 15 } });
  await page.clock.install({ time: new Date(`${isoDate}T12:00:00`) });
}

/** The "Yes" and "Skip" answers of the boxing question, found by their accessible names. */
function yesButton(page: Page) {
  return page.getByRole("button", { name: "Yes, Boxing today" });
}

function skipButton(page: Page) {
  return page.getByRole("button", { name: "Skip Boxing today" });
}

test("week 2 day 1: skip boxing, keep it across a reload, add it back, and the question goes once a round is logged", async ({ page }) => {
  await seedAt(page);
  await page.goto("/");

  // The question, with Yes chosen by default, and the full session.
  await expect(page.getByText("Boxing today?")).toBeVisible();
  await expect(yesButton(page)).toHaveAttribute("aria-pressed", "true");
  await expect(skipButton(page)).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByText("~50 min · 6 blocks")).toBeVisible();

  // Skip: one line replaces the finisher (which keeps its number), the header drops 5 min and a block,
  // the question is gone, and focus lands on "Add it back".
  await skipButton(page).click();
  await expect(page.getByText("Boxing skipped today")).toBeVisible();
  await expect(page.getByText("~43 min · 5 blocks")).toBeVisible();
  await expect(page.locator(".block-title").last()).toHaveText("6 · Finisher");
  await expect(page.locator(".item-row", { hasText: "Heavy bag" })).toHaveCount(0);
  await expect(page.getByText("Boxing today?")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add it back" })).toBeFocused();

  // The choice is stored and survives a reload.
  await page.reload();
  await expect(page.getByText("Boxing skipped today")).toBeVisible();
  await expect(page.getByText("~43 min · 5 blocks")).toBeVisible();

  // Add it back restores the program as written, with focus on the question's Skip button.
  await page.getByRole("button", { name: "Add it back" }).click();
  await expect(page.getByText("~50 min · 6 blocks")).toBeVisible();
  await expect(page.getByText("Boxing skipped today")).toHaveCount(0);
  await expect(page.locator(".item-row", { hasText: "Heavy bag" })).toBeVisible();
  await expect(skipButton(page)).toBeFocused();

  // Logging one bag round settles the choice: the question is gone.
  await page.locator(".item-row", { hasText: "Heavy bag" }).locator(".item-open").click();
  await page.getByRole("button", { name: "✓ Log set" }).click();
  await page.getByRole("link", { name: "Back to Today", exact: true }).click();
  await expect(page.getByText("Boxing today?")).toHaveCount(0);
  await expect(skipButton(page)).toHaveCount(0);
});

test("a round logged after skipping wins: boxing is back on Today and History does not say it was skipped", async ({ page }) => {
  await seedAt(page);
  await page.goto("/");
  await skipButton(page).click();
  await expect(page.getByText("~43 min · 5 blocks")).toBeVisible();

  // Log a round through a direct link to the skipped block's log screen.
  await page.goto("/#/log/2026-11-09/6/heavy_bag/day/1");
  await page.getByRole("button", { name: "✓ Log set" }).click();

  await page.goto("/#/today");
  await expect(page.getByText("Boxing skipped today")).toHaveCount(0);
  await expect(page.getByText("~50 min · 6 blocks")).toBeVisible();
  await expect(page.locator(".item-row", { hasText: "Heavy bag" })).toBeVisible();

  await page.goto("/#/history");
  await expect(page.getByText("Boxing skipped", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/Heavy bag/).first()).toBeVisible();
});

test("a skipped boxing block is noted in History once another set is logged that day", async ({ page }) => {
  await seedAt(page);
  await page.goto("/");
  await skipButton(page).click();

  await page.locator(".item-row", { hasText: "Pull-ups" }).locator(".item-open").click();
  await page.getByRole("button", { name: /✓ Log set/ }).click();

  await page.goto("/#/history");
  await expect(page.getByText("Boxing skipped", { exact: true })).toBeVisible();
});

test("a combined day (Day 1 + Day 2) asks about boxing with a D1 tag, and skipping drops the minutes", async ({ page }) => {
  await seedAt(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Short on time? Add Day 2 to today" }).click();
  await expect(page.getByText("~73 min · 9 blocks")).toBeVisible();

  const question = page.locator(".optional-block-question");
  await expect(question.locator(".item-day-label")).toHaveText("D1");
  await expect(question).toContainText("Boxing today?");

  await skipButton(page).click();
  await expect(page.getByText("~66 min · 8 blocks")).toBeVisible();
  await expect(page.getByText("Boxing skipped today")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add it back" })).toBeFocused();
});

test("a date after today shows no boxing question to answer", async ({ page }) => {
  await seedAt(page);
  await page.goto("/?date=2026-11-16");

  await expect(page.getByRole("heading", { name: "Upper: pull" })).toBeVisible();
  await expect(page.getByText("Boxing today?")).toHaveCount(0);
  await expect(skipButton(page)).toHaveCount(0);
  await expect(page.getByText("~50 min · 6 blocks")).toBeVisible();
});

test("a past date still asks about boxing", async ({ page }) => {
  await seedAt(page, "2026-11-12");
  await page.goto("/?date=2026-11-09");

  await expect(page.getByText("Boxing today?")).toBeVisible();
  await skipButton(page).click();
  await expect(page.getByText("~43 min · 5 blocks")).toBeVisible();
});

test("week 2 day 2 has no optional block, so no boxing question", async ({ page }) => {
  await seedAt(page, "2026-11-10");
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Lower: knee" })).toBeVisible();
  await expect(page.getByText(/today\?$/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Skip / })).toHaveCount(0);
});
