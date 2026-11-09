import { expect, test, type Page } from "@playwright/test";

/** Saves settings the way the app stores them, before the app first loads. */
async function seedSettings(page: Page, maxReps: Record<string, number> = { pull_up: 12, dip: 15 }): Promise<void> {
  await page.addInitScript((settings) => {
    window.localStorage.setItem("explosive-endurance.settings", JSON.stringify(settings));
  }, { version: 1, startDate: "2026-11-02", maxReps });
}

/** Opens the log screen for a row, then its exercise details sheet via the ⓘ button; returns the ⓘ button. */
async function openDetails(page: Page, name: string) {
  await row(page, name).locator(".item-open").click();
  const infoButton = page.getByRole("button", { name: "Exercise details" });
  await infoButton.click();
  return infoButton;
}

/** The row for an exercise name on the Today screen. */
function row(page: Page, name: string) {
  return page.locator(".item-row", { hasText: name });
}

test("week 2 day 1 shows header, six blocks in order and computed doses", async ({ page }) => {
  await seedSettings(page);
  await page.goto("/?date=2026-11-09");

  await expect(page.getByText("9 Nov · Week 2 of 8 · Day 1")).toBeVisible();
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
  await expect(row(page, "Pull-ups").locator(".item-details")).toHaveText("40% of max 12 · +1 this week");
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
  await expect(page.getByText("Week 4 of 8 · Day 1")).toBeVisible();
  await expect(row(page, "Med ball slams").locator(".item-dose-main")).toHaveText("3 × 6");
  await expect(row(page, "Pull-ups").locator(".item-dose-main")).toHaveText("6 / min");
  await expect(row(page, "Pull-ups").locator(".item-dose-sub")).toHaveText("5 min");
  await expect(row(page, "Pull-ups").locator(".item-details")).toHaveText("40% of max 12 · +2, held for deload");

  await page.locator(".phase-summary").click();
  await expect(page.getByRole("listitem").filter({ hasText: "Keep intensity" })).toBeVisible();
});

test("the rest day shows a rest card", async ({ page }) => {
  await seedSettings(page);
  await page.goto("/?date=2026-11-08");

  await expect(page.getByRole("heading", { name: "Rest day" })).toBeVisible();
  await expect(page.getByText("8 Nov · Week 1 of 8 · Day 7")).toBeVisible();
  await expect(page.locator(".block-card")).toHaveCount(0);
});

test("before the start date and after the program show friendly cards", async ({ page }) => {
  await seedSettings(page);
  await page.goto("/?date=2026-10-30");
  await expect(page.getByRole("heading", { name: "Program starts 2 Nov" })).toBeVisible();

  await page.goto("/?date=2027-03-01");
  await expect(page.getByRole("heading", { name: "Program complete" })).toBeVisible();
});

test("a mid-week start date makes the start date day 1 and day 7 the rest day", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "explosive-endurance.settings",
      JSON.stringify({ version: 1, startDate: "2026-11-04", maxReps: {} }),
    );
  });

  await page.goto("/?date=2026-11-03");
  await expect(page.getByRole("heading", { name: "Program starts 4 Nov" })).toBeVisible();

  await page.goto("/?date=2026-11-04");
  await expect(page.getByText("4 Nov · Week 1 of 8 · Day 1")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Upper: pull" })).toBeVisible();

  await page.goto("/?date=2026-11-10");
  await expect(page.getByRole("heading", { name: "Rest day" })).toBeVisible();
  await expect(page.getByText("10 Nov · Week 1 of 8 · Day 7")).toBeVisible();

  await page.goto("/?date=2026-11-11");
  await expect(page.getByText("11 Nov · Week 2 of 8 · Day 1")).toBeVisible();
});

test("the log screen's ⓘ button opens the details sheet; Escape closes it", async ({ page }) => {
  await seedSettings(page);
  await page.goto("/?date=2026-11-09");

  const opener = await openDetails(page, "Pull-ups");

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

test("the sheet traps focus, freezes the page behind it, and restores both on close", async ({ page }) => {
  await seedSettings(page);
  await page.goto("/?date=2026-11-09");

  await openDetails(page, "Pull-ups");
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("button", { name: "Close" })).toBeFocused();
  await expect(page.locator("nav.bottom-nav")).toHaveJSProperty("inert", true);
  await expect(page.locator("main.app-main")).toHaveJSProperty("inert", true);
  await expect(page.locator("body")).toHaveCSS("overflow", "hidden");

  for (let presses = 0; presses < 4; presses++) {
    await page.keyboard.press("Shift+Tab");
    expect(await page.evaluate(() => document.activeElement?.closest("[role=dialog]") !== null)).toBe(true);
  }

  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(page.locator("nav.bottom-nav")).toHaveJSProperty("inert", false);
  await expect(page.locator("main.app-main")).toHaveJSProperty("inert", false);
  await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
});

test("backdrop and close button also close the sheet", async ({ page }) => {
  await seedSettings(page);
  await page.goto("/?date=2026-11-09");

  await openDetails(page, "Pull-ups");
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();

  await page.getByRole("button", { name: "Exercise details" }).click();
  await page.locator(".sheet-backdrop").click({ position: { x: 10, y: 10 } });
  await expect(page.getByRole("dialog")).toBeHidden();
});

test("evidence shows a link for URLs and plain text for coaching practice", async ({ page }) => {
  await seedSettings(page);

  await page.goto("/?date=2026-11-03");
  await openDetails(page, "Split-squat jumps");
  await expect(page.getByRole("dialog").getByRole("link", { name: /Read the evidence/ })).toBeVisible();

  await page.goto("/?date=2026-11-04");
  await openDetails(page, "Plyo push-ups");
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
  await openDetails(page, "Pull-ups");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("a render that throws after a navigation shows the error card, not a blank screen", async ({ page }) => {
  await seedSettings(page);
  await page.goto("/?date=2026-11-09");
  await expect(page.locator(".item-row").first()).toBeVisible();

  // Make the next full-screen render fail once; the error card's own render then succeeds.
  await page.evaluate(() => {
    const original = Element.prototype.replaceChildren;
    Element.prototype.replaceChildren = function () {
      Element.prototype.replaceChildren = original;
      throw new Error("boom");
    };
    window.location.hash = "#/settings";
  });

  await expect(page.getByRole("alert")).toContainText("boom");
});

test("an unknown program.json field shows a dismissible warning but the session still loads", async ({ page }) => {
  await seedSettings(page);
  await page.route("**/program.json", async (route) => {
    const response = await route.fetch();
    const program = await response.json();
    program.exercises.pull_up.notes = "x";
    await route.fulfill({ response, json: program });
  });
  await page.goto("/?date=2026-11-09");

  // The session renders as normal...
  await expect(page.getByRole("heading", { name: "Upper: pull" })).toBeVisible();
  await expect(row(page, "Pull-ups").locator(".item-dose-main")).toHaveText("5 / min");

  // ...with a banner naming the ignored field.
  const banner = page.locator(".warning-banner");
  await expect(banner).toContainText("program.json has 1 field the app doesn't recognise, so it was ignored");
  await expect(banner.getByText("exercises.pull_up.notes")).toBeHidden();
  await banner.getByText("Show which fields").click();
  await expect(banner.getByText("exercises.pull_up.notes")).toBeVisible();

  // Dismissing hides it, and it stays hidden after navigating away and back.
  await banner.getByRole("button", { name: "Dismiss" }).click();
  await expect(banner).toHaveCount(0);
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("link", { name: "Today" }).click();
  await expect(page.locator(".warning-banner")).toHaveCount(0);
});

test("a typo in a known field shows a did-you-mean hint without expanding anything", async ({ page }) => {
  await seedSettings(page);
  await page.route("**/program.json", async (route) => {
    const response = await route.fetch();
    const program = await response.json();
    program.days[0].blocks[1].items[0].weeklyIncreese = "+1 rep";
    await route.fulfill({ response, json: program });
  });
  await page.goto("/?date=2026-11-09");

  const banner = page.locator(".warning-banner");
  await expect(banner).toContainText("Some look like typos, so parts of today's session may be missing.");
  await expect(banner.getByText('unknown field, ignored \u2014 did you mean "weeklyIncrease"?')).toBeVisible();

  // Dismissing moves focus to the main heading rather than dropping it.
  await banner.getByRole("button", { name: "Dismiss" }).click();
  await expect(page.getByRole("heading", { name: "Upper: pull" })).toBeFocused();
});

test("no warning banner when program.json has no unknown fields", async ({ page }) => {
  await seedSettings(page);
  await page.goto("/?date=2026-11-09");
  await expect(page.getByRole("heading", { name: "Upper: pull" })).toBeVisible();
  await expect(page.locator(".warning-banner")).toHaveCount(0);
});

test("week 8 retest day holds week 7's reps until a max is saved, with an Update max link", async ({ page }) => {
  await seedSettings(page);
  await page.goto("/?date=2026-12-21");

  await expect(page.getByText("Week 8 of 8 · Day 1")).toBeVisible();
  await expect(row(page, "Pull-ups").locator(".item-dose-main")).toHaveText("6 / min");
  await expect(row(page, "Pull-ups").locator(".item-dose-sub")).toHaveText("5 min");
  await expect(row(page, "Pull-ups").locator(".item-details")).toHaveText("40% of max 12 · +2 held until you save a retested max");

  await row(page, "Pull-ups").getByRole("link", { name: "Update max" }).click();
  await expect(page).toHaveURL(/#\/settings$/);
  await expect(page.getByLabel("Max reps: Pull-ups")).toBeVisible();
});

test("saving a retested max in week 8 switches the EMOM to it and removes the Update max link", async ({ page }) => {
  await seedSettings(page);
  // The real clock (not ?date=) decides the save date, so fix it to retest day.
  await page.clock.setFixedTime(new Date("2026-12-21T09:00:00"));
  await page.goto("/#/settings");

  await page.getByLabel("Max reps: Pull-ups").fill("15");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL(/#\/today$/);

  await expect(row(page, "Pull-ups").locator(".item-dose-main")).toHaveText("6 / min");
  await expect(row(page, "Pull-ups").locator(".item-details")).toHaveText("40% of your retested max 15");
  await expect(row(page, "Pull-ups").getByRole("link", { name: "Update max" })).toHaveCount(0);
});

test("week 8 mini-dose rows have no retest wording or Update max link", async ({ page }) => {
  await seedSettings(page);
  await page.goto("/?date=2026-12-21");

  await expect(row(page, "Dips").locator(".item-details")).not.toContainText("retest");
  await expect(row(page, "Dips").getByRole("link", { name: "Update max" })).toHaveCount(0);
});

test("Today left open past midnight offers a new-day banner instead of swapping the session", async ({ page }) => {
  await seedSettings(page);
  await page.clock.install({ time: new Date("2026-11-09T23:59:00") });
  await page.goto("/");
  await expect(page.getByText("9 Nov · Week 2 of 8 · Day 1")).toBeVisible();

  await page.clock.runFor(120_000);

  // The session is untouched; only the banner is added (and only once, even after more checks).
  await expect(page.getByText("It's a new day.")).toBeVisible();
  await expect(page.getByText("9 Nov · Week 2 of 8 · Day 1")).toBeVisible();
  await page.clock.runFor(120_000);
  await expect(page.getByText("It's a new day.")).toHaveCount(1);

  const showToday = page.getByRole("button", { name: "Show today's session" });
  const box = await showToday.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(48);
  await showToday.click();

  await expect(page.getByText("10 Nov · Week 2 of 8 · Day 2")).toBeVisible();
  await expect(page.getByText("It's a new day.")).toHaveCount(0);
});

test("navigating away and back after midnight keeps the shown day and the banner until it is tapped", async ({ page }) => {
  await seedSettings(page);
  await page.clock.install({ time: new Date("2026-11-09T23:59:00") });
  await page.goto("/");
  // Wait for the app to start before running the clock, or the interval it sets up would never fire.
  await expect(page.getByText("9 Nov · Week 2 of 8 · Day 1")).toBeVisible();
  await page.clock.runFor(120_000);
  await expect(page.getByText("It's a new day.")).toBeVisible();

  // Rule 8: leaving Today and coming back does not move the session on; the banner is still there.
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("link", { name: "Today" }).click();
  await expect(page.getByText("9 Nov · Week 2 of 8 · Day 1")).toBeVisible();
  await expect(page.getByText("It's a new day.")).toHaveCount(1);

  await page.getByRole("link", { name: "History" }).click();
  await page.getByRole("link", { name: "Today" }).click();
  await expect(page.getByText("9 Nov · Week 2 of 8 · Day 1")).toBeVisible();

  await page.getByRole("button", { name: "Show today's session" }).click();
  await expect(page.getByText("10 Nov · Week 2 of 8 · Day 2")).toBeVisible();
  await expect(page.getByText("It's a new day.")).toHaveCount(0);
});

test("the new-day banner can appear behind an open timer and works after it closes", async ({ page }) => {
  await seedSettings(page);
  await page.clock.install({ time: new Date("2026-11-09T23:59:00") });
  await page.goto("/");
  await expect(page.getByText("9 Nov · Week 2 of 8 · Day 1")).toBeVisible();
  await page.getByRole("button", { name: "Rest 30s, Med ball slams" }).click();
  const overlay = page.getByRole("dialog", { name: "Rest timer" });

  await page.clock.runFor(120_000);
  // Added into the inert <main>, so it is inert too: the timer stays modal.
  await expect(page.locator(".new-day-banner")).toHaveCount(1);
  expect(await page.locator(".new-day-banner").evaluate((banner) => banner.closest("[inert]") !== null)).toBe(true);
  await expect(overlay).toBeVisible();

  await overlay.getByRole("button", { name: "✕ Close" }).click();
  await expect(overlay).toBeHidden();
  await page.getByRole("button", { name: "Show today's session" }).click();
  await expect(page.getByText("10 Nov · Week 2 of 8 · Day 2")).toBeVisible();
});

test("a ?date= preview stays on its date past midnight", async ({ page }) => {
  await seedSettings(page);
  await page.clock.install({ time: new Date("2026-11-09T23:59:00") });
  await page.goto("/?date=2026-11-09");
  // Wait for the app to start before running the clock, or the interval it sets up would never fire.
  await expect(page.getByText("9 Nov · Week 2 of 8 · Day 1")).toBeVisible();

  await page.clock.runFor(120_000);
  await expect(page.getByText("9 Nov · Week 2 of 8 · Day 1")).toBeVisible();
  await expect(page.getByText("It's a new day.")).toHaveCount(0);
});
