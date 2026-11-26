import { expect, test } from "@playwright/test";

/**
 * The "Full screen" nav button (PR 36 of PLAN.md). The enter-and-exit test runs
 * in headless Chromium, where the Fullscreen API exists. The other tests fake
 * the browser states that matter for iPhone: no Fullscreen API, a Home Screen
 * app, and a refused request. The fakes run before the app loads, as
 * `addInitScript` does.
 */

/** The button's text is its icon and then its label, so match the whole text. */
const FULL_SCREEN_LABEL = /^⛶Full screen$/;
const EXIT_FULL_SCREEN_LABEL = /^⛶Exit full screen$/;

test("the Full screen nav button enters full screen, then exits it", async ({ page }) => {
  await page.goto("/#/today");

  const fullScreenButton = page.locator("nav.bottom-nav .full-screen-button");
  await expect(fullScreenButton).toContainText(FULL_SCREEN_LABEL);

  await fullScreenButton.click();
  await expect(fullScreenButton).toContainText(EXIT_FULL_SCREEN_LABEL);
  expect(await page.evaluate(() => document.fullscreenElement !== null)).toBe(true);

  await fullScreenButton.click();
  await expect(fullScreenButton).toContainText(FULL_SCREEN_LABEL);
  expect(await page.evaluate(() => document.fullscreenElement === null)).toBe(true);
});

test("on a browser with no Fullscreen API (iPhone Safari), the button shows the Home Screen hint", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, "fullscreenEnabled", { get: () => false });
  });
  await page.goto("/#/today");

  const fullScreenButton = page.locator("nav.bottom-nav .full-screen-button");
  await fullScreenButton.click();
  await expect(page.getByRole("status")).toContainText("Add to Home Screen");
  await expect(fullScreenButton).toContainText(FULL_SCREEN_LABEL);
});

test("a refused full-screen request shows a message that does not give iPhone advice", async ({ page }) => {
  await page.addInitScript(() => {
    Element.prototype.requestFullscreen = () => Promise.reject(new TypeError("refused"));
  });
  await page.goto("/#/today");

  await page.locator("nav.bottom-nav .full-screen-button").click();
  await expect(page.getByRole("status")).toContainText("Couldn't go full screen");
  await expect(page.getByRole("status")).not.toContainText("iPhone");
});

test("a Home Screen app has no Full screen button, since it already has no browser bars", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "standalone", { get: () => true });
  });
  await page.goto("/#/today");

  await expect(page.locator("nav.bottom-nav")).toBeVisible();
  await expect(page.locator("nav.bottom-nav .full-screen-button")).toHaveCount(0);
});
