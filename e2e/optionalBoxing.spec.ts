import { expect, test, type Page } from "@playwright/test";

/**
 * Optional boxing on Today (PR 29): start date 2 Nov 2026, so 9 Nov is week 2
 * day 1 (heavy bag finisher marked optional) and 10 Nov is day 2 (no
 * optional block).
 */

/** Saves settings before the app first loads, only when nothing is stored yet (so a reload keeps what the app saved). */
async function seedSettings(page: Page): Promise<void> {
  await page.addInitScript((settings) => {
    if (window.localStorage.getItem("explosive-endurance.settings") === null) {
      window.localStorage.setItem("explosive-endurance.settings", JSON.stringify(settings));
    }
  }, { version: 1, startDate: "2026-11-02", maxReps: { pull_up: 12, dip: 15 } });
}

test("week 2 day 1: skip boxing, keep it across a reload, add it back, and the card goes once a round is logged", async ({ page }) => {
  await seedSettings(page);
  await page.goto("/?date=2026-11-09");

  // The question, with Box chosen by default, and the full session.
  await expect(page.getByText("Boxing today?")).toBeVisible();
  await expect(page.getByRole("button", { name: "Box", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Skip boxing" })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByText("~50 min · 6 blocks")).toBeVisible();

  // Skip: one line replaces the finisher (which keeps its number), and the header drops 5 min and a block.
  await page.getByRole("button", { name: "Skip boxing" }).click();
  await expect(page.getByText("Boxing skipped today")).toBeVisible();
  await expect(page.getByText("~45 min · 5 blocks")).toBeVisible();
  await expect(page.locator(".block-title").last()).toHaveText("6 · Finisher");
  await expect(page.locator(".item-row", { hasText: "Heavy bag" })).toHaveCount(0);

  // The choice is stored and survives a reload.
  await page.reload();
  await expect(page.getByText("Boxing skipped today")).toBeVisible();
  await expect(page.getByText("~45 min · 5 blocks")).toBeVisible();

  // Add it back restores the program as written.
  await page.getByRole("button", { name: "Add it back" }).click();
  await expect(page.getByText("~50 min · 6 blocks")).toBeVisible();
  await expect(page.getByText("Boxing skipped today")).toHaveCount(0);
  await expect(page.locator(".item-row", { hasText: "Heavy bag" })).toBeVisible();

  // Logging one bag round settles the choice: the question is gone.
  await page.locator(".item-row", { hasText: "Heavy bag" }).locator(".item-open").click();
  await page.getByRole("button", { name: "✓ Log set" }).click();
  await page.getByRole("link", { name: "Back to Today", exact: true }).click();
  await expect(page.getByText("Boxing today?")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Skip boxing" })).toHaveCount(0);
});

test("a skipped boxing block is noted in History once another set is logged that day", async ({ page }) => {
  await seedSettings(page);
  await page.goto("/?date=2026-11-09");
  await page.getByRole("button", { name: "Skip boxing" }).click();

  await page.locator(".item-row", { hasText: "Pull-ups" }).locator(".item-open").click();
  await page.getByRole("button", { name: /✓ Log set/ }).click();

  await page.goto("/?date=2026-11-09#/history");
  await expect(page.getByText("Boxing skipped", { exact: true })).toBeVisible();
});

test("week 2 day 2 has no optional block, so no boxing question", async ({ page }) => {
  await seedSettings(page);
  await page.goto("/?date=2026-11-10");

  await expect(page.getByRole("heading", { name: "Lower: knee" })).toBeVisible();
  await expect(page.getByText(/today\?$/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Skip boxing" })).toHaveCount(0);
});
