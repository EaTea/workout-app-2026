import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * E2E for the "Show me" animations (PR 21): the buttons on Today, the day
 * plan and the log screen, and the full-screen view they open. The view is
 * read through the data-* test hooks on its root (see ui/demoView.ts) rather
 * than by sleeping, so timing stays generous and the tests stay steady.
 */

// Software WebGL, so headless Chromium can draw the 3D figure. If it still
// can't, the view falls back to the flat figure, which most tests accept.
test.use({ launchOptions: { args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } });

/** Chooses Steady Strength, started on Mon 2 Nov 2026 (so 2 Nov is Week 1 · Day 1), and pins the clock to that day. */
async function openSteadyStrength(page: Page, hash = ""): Promise<void> {
  await page.clock.install({ time: new Date("2026-11-02T09:00:00") });
  await page.addInitScript(() => {
    window.localStorage.setItem("workout-app.active-program", JSON.stringify({ version: 1, programId: "steady-strength" }));
    window.localStorage.setItem("steady-strength.settings", JSON.stringify({ version: 2, startDate: "2026-11-02", maxReps: {}, maxSavedOn: {} }));
  });
  await page.goto(`/${hash}`);
}

/** The "Show me" overlay's root element. */
function demoView(page: Page): Locator {
  return page.locator(".demo-view");
}

/** The row on Today / the plan for an exercise name. */
function row(page: Page, name: string): Locator {
  return page.locator(".item-row", { hasText: name }).first();
}

/** Opens the high wall sit view from Today and waits for the renderer to be ready. */
async function openWallSitView(page: Page): Promise<void> {
  await openSteadyStrength(page);
  await page.getByRole("button", { name: "Show me how, High wall sit" }).click();
  await expect(demoView(page)).toBeVisible();
  await expect(demoView(page)).toHaveAttribute("data-renderer", /^(3d|flat)$/, { timeout: 20_000 });
}

test("every Steady Strength Day 1 row on Today has Show me, and the row still opens its log screen", async ({ page }) => {
  await openSteadyStrength(page);

  await expect(page.locator(".item-row")).toHaveCount(15);
  await expect(page.getByRole("button", { name: /^Show me how, / })).toHaveCount(15);

  await row(page, "High wall sit").locator(".item-open").click();
  await expect(page).toHaveURL(/#\/log\/2026-11-02\/\d+\/high_wall_sit$/);
  await expect(page.getByRole("heading", { name: "High wall sit" })).toBeVisible();
});

test("Show me on the high wall sit plays Start, a move, then Hold; Pause freezes it; Back and Escape close it", async ({ page }) => {
  await openSteadyStrength(page);
  const opener = page.getByRole("button", { name: "Show me how, High wall sit" });
  await opener.click();

  const view = demoView(page);
  await expect(view.getByRole("heading")).toContainText("High wall sit");
  await expect(view.getByRole("heading")).toContainText("3 × 20s");
  await expect(view.getByText("Back on the wall, slide down a little and hold.")).toBeVisible();
  await expect(view).toHaveAttribute("data-renderer", /^(3d|flat)$/, { timeout: 20_000 });

  // Start, then a move, then Hold, in real time (about 1.5 s, 2.5 s, then the hold).
  await expect.poll(() => view.getAttribute("data-step-label"), { timeout: 15_000 }).toBe("Start");
  await expect.poll(() => view.getAttribute("data-step-label"), { timeout: 15_000 }).toBe("Slide down a little");
  await expect.poll(() => view.getAttribute("data-step-label"), { timeout: 15_000 }).toBe("Hold");

  // Pause: the label stays put for 2 s (the hold lasts 4 s, so it would only change after a restart).
  await view.getByRole("button", { name: /Pause/ }).click();
  await expect(view).toHaveAttribute("data-paused", "true");
  const labelWhenPaused = await view.getAttribute("data-step-label");
  await page.waitForTimeout(2000);
  expect(await view.getAttribute("data-step-label")).toBe(labelWhenPaused);

  // Back closes the view and focus returns to the button that opened it.
  await page.goBack();
  await expect(view).toHaveCount(0);
  await expect(opener).toBeFocused();

  // Escape closes it too.
  await opener.click();
  await expect(view).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(view).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test("the 3D figure is drawn when software WebGL is available", async ({ page }) => {
  await openWallSitView(page);
  await expect(demoView(page)).toHaveAttribute("data-renderer", "3d");
  await expect(demoView(page).locator("canvas")).toBeVisible();
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("shows still positions, no Slower button, and Next step moves from Start to Hold", async ({ page }) => {
    await openWallSitView(page);
    const view = demoView(page);

    await expect(view).toHaveAttribute("data-reduced-motion", "true");
    await expect(view.getByRole("button", { name: "Next step" })).toBeVisible();
    await expect(view.getByRole("button", { name: "Slower" })).toHaveCount(0);
    await expect(view).toHaveAttribute("data-step-label", "Start");

    await view.getByRole("button", { name: "Next step" }).click();
    await expect(view).toHaveAttribute("data-step-label", "Hold");
  });
});

test("Turn on the single-leg stand moves to the next camera angle", async ({ page }) => {
  await openSteadyStrength(page);
  await page.getByRole("button", { name: "Show me how, Single-leg stand" }).click();

  const view = demoView(page);
  await expect(view).toHaveAttribute("data-view", "threeQuarter");
  await view.getByRole("button", { name: /Turn/ }).click();
  await expect(view).not.toHaveAttribute("data-view", "threeQuarter");
  await expect(view).toHaveAttribute("data-view", /^(side|front)$/);
});

test("the day plan rows have Show me and it opens the view", async ({ page }) => {
  await openSteadyStrength(page, "#/plan/1/1");

  await expect(page.getByRole("button", { name: /^Show me how, / })).toHaveCount(15);
  await page.getByRole("button", { name: "Show me how, High wall sit" }).click();
  await expect(demoView(page).getByRole("heading")).toContainText("High wall sit");
});

test("the log screen header has Show me, and it opens the view", async ({ page }) => {
  await openSteadyStrength(page);
  await row(page, "High wall sit").locator(".item-open").click();
  await expect(page.getByRole("heading", { name: "High wall sit" })).toBeVisible();

  await page.getByRole("button", { name: "Show me how, High wall sit" }).click();
  await expect(demoView(page).getByRole("heading")).toContainText("High wall sit");
  await expect(demoView(page).getByText("Back on the wall, slide down a little and hold.")).toBeVisible();
});

test("Explosive Endurance has no Show me buttons", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-11-02T09:00:00") });
  // The default storage state already chose Explosive Endurance; only the start date is needed.
  await page.addInitScript(() => {
    window.localStorage.setItem("explosive-endurance.settings", JSON.stringify({ version: 1, startDate: "2026-11-02", maxReps: { pull_up: 12, dip: 15 } }));
  });
  await page.goto("/?date=2026-11-02");

  await expect(page.locator(".item-row").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Show me/ })).toHaveCount(0);
});

test.describe("without WebGL", () => {
  test("the flat figure and the cue show instead", async ({ page }) => {
    // Make every WebGL context request fail, as on a phone with WebGL off.
    await page.addInitScript(() => {
      const originalGetContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, contextId: string, ...rest: unknown[]) {
        if (contextId === "webgl" || contextId === "webgl2" || contextId === "experimental-webgl") return null;
        return (originalGetContext as (...args: unknown[]) => unknown).call(this, contextId, ...rest);
      } as typeof HTMLCanvasElement.prototype.getContext;
    });
    await openWallSitView(page);

    await expect(demoView(page)).toHaveAttribute("data-renderer", "flat");
    await expect(demoView(page).getByText("Back on the wall, slide down a little and hold.")).toBeVisible();
  });
});
