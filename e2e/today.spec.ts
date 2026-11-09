import { expect, test, type Page } from "@playwright/test";

/** Saves settings the way the app stores them, before the app first loads. */
async function seedSettings(page: Page, maxReps: Record<string, number> = { pull_up: 12, dip: 15 }): Promise<void> {
  await page.addInitScript((settings) => {
    window.localStorage.setItem("explosive-endurance.settings", JSON.stringify(settings));
  }, { version: 1, startDate: "2026-11-02", maxReps });
}

/** The row for an exercise name on the Today screen. */
function row(page: Page, name: string) {
  return page.locator(".item-row", { hasText: name });
}

test("week 2 Monday shows header, six blocks in order and computed doses", async ({ page }) => {
  await seedSettings(page);
  await page.goto("/?date=2026-11-09");

  await expect(page.getByText("Mon 9 Nov · Week 2 of 8")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Upper: pull" })).toBeVisible();
  await expect(page.getByText("~50 min · 6 blocks")).toBeVisible();

  await expect(page.locator(".block-title")).toHaveText([
    "1 · Warm-up · 2 rounds",
    "2 · Explosive",
    "3 · Main strength · 9 min",
    "4 · Mini-dose",
    "5 · Core · superset",
    "6 · Finisher",
  ]);

  await expect(row(page, "Pull-ups").locator(".item-dose-main")).toHaveText("5 / min");
  await expect(row(page, "Pull-ups").locator(".item-dose-sub")).toHaveText("9 min");
  await expect(row(page, "Dips").locator(".item-dose-main")).toHaveText("2 × 7");
  await expect(row(page, "Med ball slams").locator(".item-dose-main")).toHaveText("6 × 6");
  await expect(page.locator(".deload-note")).toHaveCount(0);

  // The phase strip expands to show every change for the phase.
  await expect(page.locator(".phase-changes")).toBeHidden();
  await page.getByText("BASE").click();
  await expect(page.locator(".phase-changes")).toBeVisible();
});

test("deload week shows the note and halved doses", async ({ page }) => {
  await seedSettings(page);
  await page.goto("/?date=2026-11-23");

  await expect(page.getByText("Deload week: sets halved")).toBeVisible();
  await expect(page.getByText("Week 4 of 8")).toBeVisible();
  await expect(row(page, "Med ball slams").locator(".item-dose-main")).toHaveText("3 × 6");
  await expect(row(page, "Pull-ups").locator(".item-dose-main")).toHaveText("4 / min");
  await expect(row(page, "Pull-ups").locator(".item-dose-sub")).toHaveText("5 min");

  await page.locator(".phase-summary").click();
  await expect(page.getByRole("listitem").filter({ hasText: "Keep intensity" })).toBeVisible();
});

test("the rest day shows a rest card", async ({ page }) => {
  await seedSettings(page);
  await page.goto("/?date=2026-11-08");

  await expect(page.getByRole("heading", { name: "Rest day" })).toBeVisible();
  await expect(page.locator(".block-card")).toHaveCount(0);
});

test("before the start date and after the program show friendly cards", async ({ page }) => {
  await seedSettings(page);
  await page.goto("/?date=2026-10-30");
  await expect(page.getByRole("heading", { name: "Program starts Mon 2 Nov" })).toBeVisible();

  await page.goto("/?date=2027-03-01");
  await expect(page.getByRole("heading", { name: "Program complete" })).toBeVisible();
});

test("tapping an exercise opens the details sheet; Escape closes it", async ({ page }) => {
  await seedSettings(page);
  await page.goto("/?date=2026-11-09");

  const opener = row(page, "Pull-ups").getByRole("button");
  await opener.click();

  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("heading", { name: "Pull-ups" })).toBeVisible();
  const link = sheet.getByRole("link", { name: /Read the evidence/ });
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");

  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(opener).toBeFocused();
});

test("backdrop and close button also close the sheet", async ({ page }) => {
  await seedSettings(page);
  await page.goto("/?date=2026-11-09");

  await row(page, "Pull-ups").getByRole("button").click();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();

  await row(page, "Pull-ups").getByRole("button").click();
  await page.locator(".sheet-backdrop").click({ position: { x: 10, y: 10 } });
  await expect(page.getByRole("dialog")).toBeHidden();
});

test("evidence shows a link for URLs and plain text for coaching practice", async ({ page }) => {
  await seedSettings(page);

  await page.goto("/?date=2026-11-03");
  await row(page, "Split-squat jumps").getByRole("button").click();
  await expect(page.getByRole("dialog").getByRole("link", { name: /Read the evidence/ })).toBeVisible();

  await page.goto("/?date=2026-11-04");
  await row(page, "Plyo push-ups").getByRole("button").click();
  await expect(page.getByRole("dialog").getByText("Based on coaching practice")).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("link", { name: /Read the evidence/ })).toHaveCount(0);
});

test("a missing max shows 'Set max' linking to Settings", async ({ page }) => {
  await seedSettings(page, { pull_up: 12 });
  await page.goto("/?date=2026-11-09");

  await row(page, "Dips").getByRole("link", { name: "Set max" }).click();
  await expect(page).toHaveURL(/#\/settings$/);
  await expect(page.getByLabel("Max reps: Dips")).toBeVisible();
});

test("no horizontal overflow on training, rest and sheet views", async ({ page }) => {
  await seedSettings(page);

  for (const date of ["2026-11-09", "2026-11-14", "2026-11-23", "2026-11-08"]) {
    await page.goto(`/?date=${date}`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, date).toBeLessThanOrEqual(0);
  }

  await page.goto("/?date=2026-11-09");
  await row(page, "Pull-ups").getByRole("button").click();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
