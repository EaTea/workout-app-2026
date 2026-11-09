import { expect, test } from "@playwright/test";

// This file exercises the real service worker, so it opts back in
// (playwright.config.ts blocks workers for every other spec).
test.use({ serviceWorkers: "allow" });

/** Visits the app and waits until the service worker is installed and controls the page (after a reload). */
async function installAndControl(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.reload();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
}

test("the app loads offline from the cache, with the program", async ({ page, context }) => {
  // A program start date makes Today show a real session built from program.json.
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "explosive-endurance.settings",
      JSON.stringify({ version: 1, startDate: "2026-11-02", maxReps: { pull_up: 12, dip: 15 } }),
    );
  });
  await installAndControl(page);

  await context.setOffline(true);
  await page.reload();

  await expect(page.locator(".item-row").first()).toBeVisible();
  await expect(page.locator(".startup-error")).toHaveCount(0);
});

test("program.json edits are picked up when online (network-first)", async ({ page, context }) => {
  await installAndControl(page);

  const original = await (await page.request.get("/program.json")).json();
  const edited = { ...original, program: { ...original.program, name: "EDITED PROGRAM NAME" } };
  await context.route("**/program.json", (route) => route.fulfill({ json: edited }));

  await page.reload();
  const loaded = await page.evaluate(async () => (await fetch("./program.json")).json());
  expect(JSON.stringify(loaded)).toContain("EDITED PROGRAM NAME");

  // And the edited copy is what the cache serves offline afterwards.
  await context.unroute("**/program.json");
  await context.setOffline(true);
  const offlineLoaded = await page.evaluate(async () => (await fetch("./program.json")).json());
  expect(JSON.stringify(offlineLoaded)).toContain("EDITED PROGRAM NAME");
});
