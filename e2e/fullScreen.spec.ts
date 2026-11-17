import { expect, test } from "@playwright/test";

/**
 * The "Full screen" nav button (PR 36 of PLAN.md). In this headless Chromium
 * the Fullscreen API is available, so a tap should enter full screen and the
 * label should flip to "Exit full screen". On iPhone Safari the API is missing
 * and a tap shows the Add to Home Screen hint instead; that path is covered by
 * the unit tests in src/ui/fullScreen.test.ts, not here.
 */
test("the Full screen nav button enters full screen, then exits it", async ({ page }) => {
  await page.goto("/#/today");

  const fullScreenButton = page.locator("nav.bottom-nav .full-screen-button");
  // The icon sits in the button too, so match the label at the end of its text.
  await expect(fullScreenButton).toContainText(/Full screen$/);

  await fullScreenButton.click();
  await expect(fullScreenButton).toContainText(/Exit full screen$/);
  expect(await page.evaluate(() => document.fullscreenElement !== null)).toBe(true);

  await fullScreenButton.click();
  await expect(fullScreenButton).toContainText(/^⛶Full screen$/);
  expect(await page.evaluate(() => document.fullscreenElement === null)).toBe(true);
});
