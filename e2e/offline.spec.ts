import { expect, test, type Page } from "@playwright/test";

// This file exercises the real service worker, so it opts back in
// (playwright.config.ts blocks workers for every other spec).
test.use({ serviceWorkers: "allow" });

/** Visits the app and waits until the service worker is installed and controls the page (after a reload). */
async function installAndControl(page: Page): Promise<void> {
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

/** Saves a program start date before the app loads, so Today shows a real session. */
async function seedStartDate(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "explosive-endurance.settings",
      JSON.stringify({ version: 1, startDate: "2026-11-02", maxReps: { pull_up: 12, dip: 15 } }),
    );
  });
}

/** Reads the text of the shell ("./") stored in this worker version's cache. */
async function readCachedShell(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const names = (await caches.keys()).filter((name) => name.startsWith("explosive-endurance-"));
    const cache = await caches.open(names[0] as string);
    const shell = await cache.match("./");
    return shell ? shell.text() : "MISSING";
  });
}

test("visiting another URL online never replaces the offline shell", async ({ page, context }) => {
  await seedStartDate(page);
  await installAndControl(page);

  // A stray page load (the manifest as a page) used to be cached as the shell.
  await page.goto("/manifest.webmanifest");

  await context.setOffline(true);
  await page.goto("/");

  await expect(page.locator(".item-row").first()).toBeVisible();
  await expect(page.locator(".startup-error")).toHaveCount(0);
});

test("a deep link with a query and hash opens offline", async ({ page, context }) => {
  await seedStartDate(page);
  await installAndControl(page);

  await context.setOffline(true);
  await page.goto("/?date=2026-11-09#/history");

  await expect(page.locator(".history-screen")).toBeVisible();
  await expect(page.locator(".startup-error")).toHaveCount(0);
});

test("a half-arrived newer deploy can't break the offline app", async ({ page, context }) => {
  await seedStartDate(page);
  await installAndControl(page);
  const shellBefore = await readCachedShell(page);

  // The "new deploy": index.html already points at a hashed script the server
  // doesn't have yet (404). Page loads never reach the network, so it must
  // not matter, and the cached shell must stay exactly as installed.
  await context.route("**/", (route) =>
    route.fulfill({ contentType: "text/html", body: '<!doctype html><div id="app"></div><script type="module" src="./assets/index-NEWHASH.js"></script>' }),
  );
  await context.route("**/assets/index-NEWHASH.js", (route) => route.fulfill({ status: 404, body: "not found" }));

  await page.reload();
  await expect(page.locator(".item-row").first()).toBeVisible();
  expect(await readCachedShell(page)).toBe(shellBefore);

  await context.unroute("**/");
  await context.setOffline(true);
  await page.reload();

  await expect(page.locator(".item-row").first()).toBeVisible();
  await expect(page.locator(".startup-error")).toHaveCount(0);
});
