import { expect, test, type Page } from "@playwright/test";

// The real "today" is fixed at 22 Nov 2026; the program started on 2 Nov.
const TODAY = "2026-11-22";

/** Fixes the clock at noon on `TODAY` and seeds Explosive Endurance settings. */
async function seedExplosiveEndurance(page: Page): Promise<void> {
  await page.clock.install({ time: new Date(`${TODAY}T12:00:00`) });
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "explosive-endurance.settings",
      JSON.stringify({ version: 2, startDate: "2026-11-02", maxReps: { pull_up: 12, dip: 15 }, maxSavedOn: {} }),
    );
  });
}

/** Flags the right shoulder in Settings and closes the sheet that opens. */
async function flagRightShoulder(page: Page): Promise<void> {
  await page.goto("/#/settings");
  await page.getByLabel("Side").selectOption("right");
  await page.getByLabel("Note (optional)").fill("Fell on it on a rest day");
  await page.getByRole("button", { name: "Flag it" }).click();

  const sheet = page.getByRole("dialog", { name: "Get your shoulder checked" });
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText("It popped, slipped out or changed shape, or you fell on it.");
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(sheet).toHaveCount(0);
}

test("flagging the right shoulder shows the sheet, then a banner on Today that survives a reload; clearing removes it", async ({ page }) => {
  await seedExplosiveEndurance(page);
  await flagRightShoulder(page);

  // Settings now shows the flag, the note and the way to clear it.
  await expect(page.locator(".injury-section")).toContainText("Right shoulder · since 22 Nov");
  await expect(page.locator(".injury-section")).toContainText("Fell on it on a rest day");

  await page.goto("/#/today");
  const banner = page.locator(".injury-banner");
  await expect(banner).toContainText("Right shoulder · since 22 Nov");
  await expect(banner).toContainText("Pain-free only.");

  await page.reload();
  await expect(page.locator(".injury-banner")).toContainText("Right shoulder · since 22 Nov");

  // The banner's button opens the same sheet.
  await page.locator(".injury-banner").getByRole("button", { name: "When to get it checked" }).click();
  await expect(page.getByRole("dialog", { name: "Get your shoulder checked" })).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();

  // Clearing asks first, in words that make no medical claim.
  await page.goto("/#/settings");
  await page.getByRole("button", { name: "My shoulder feels OK" }).click();
  await expect(page.locator(".injury-confirm")).toContainText("The app can't tell whether your shoulder is ready.");
  await page.getByRole("button", { name: "Yes, clear it" }).click();

  await expect(page.locator(".injury-section")).toContainText("Past injuries");
  await page.goto("/#/today");
  await expect(page.locator(".injury-banner")).toHaveCount(0);
});

test("Today's I'm injured link leads to the Injury section", async ({ page }) => {
  await seedExplosiveEndurance(page);
  await page.goto("/#/today");

  await page.getByRole("link", { name: "I'm injured" }).click();

  await expect(page).toHaveURL(/#\/settings$/);
  await expect(page.getByRole("heading", { name: "Flag an injury" })).toBeVisible();
});

test("Steady Strength has no Injury section and no I'm injured link", async ({ page }) => {
  await page.clock.install({ time: new Date(`${TODAY}T12:00:00`) });
  await page.addInitScript(() => {
    window.localStorage.setItem("workout-app.active-program", JSON.stringify({ version: 1, programId: "steady-strength" }));
    window.localStorage.setItem("steady-strength.settings", JSON.stringify({ version: 2, startDate: "2026-11-02", maxReps: {}, maxSavedOn: {} }));
  });

  await page.goto("/#/today");
  await expect(page.locator(".app-main h1, .app-main .card-title").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "I'm injured" })).toHaveCount(0);

  await page.goto("/#/settings");
  await expect(page.getByLabel("Start date")).toBeVisible();
  await expect(page.locator(".injury-section")).toHaveCount(0);
});
