import { expect, test, type Page } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";

/** Seeds v2 settings, a max history and a two-session log plus one check-in, once per test, before the app loads. */
async function seedData(page: Page): Promise<void> {
  const set = (exerciseId: string, blockPosition: number, setNumber: number, reps: number) => ({
    exerciseId, blockPosition, setNumber, reps, loggedAt: "2026-11-02T18:00:00.000Z",
  });
  const seed = {
    settings: { version: 2, startDate: "2026-11-02", maxReps: { pull_up: 14 }, maxSavedOn: { pull_up: "2026-12-18" } },
    maxHistory: { version: 1, maxHistory: { pull_up: [{ savedOn: "2026-11-02", reps: 12 }, { savedOn: "2026-12-18", reps: 14 }] } },
    log: {
      version: 1,
      sessions: [
        { date: "2026-11-02", programWeek: 1, day: 1, sets: [set("med_ball_slam", 2, 1, 6), set("pull_up", 3, 1, 5)] },
        { date: "2026-11-04", programWeek: 1, day: 3, sets: [set("dip", 3, 1, 7)] },
      ],
    },
    fatigue: { version: 1, checks: [{ date: "2026-11-09", maxPullUps: 10, savedAt: "2026-11-09T07:30:00.000Z" }] },
  };
  await page.addInitScript((data) => {
    // Seed only once, so that clearing storage later in a test is not undone by a reload.
    if (window.sessionStorage.getItem("seeded") !== null) return;
    window.sessionStorage.setItem("seeded", "yes");
    window.localStorage.setItem("explosive-endurance.settings", JSON.stringify(data.settings));
    window.localStorage.setItem("explosive-endurance.max-history", JSON.stringify(data.maxHistory));
    window.localStorage.setItem("explosive-endurance.log", JSON.stringify(data.log));
    window.localStorage.setItem("explosive-endurance.fatigue", JSON.stringify(data.fatigue));
  }, seed);
}

/** Exports everything as JSON from Settings and saves it to `path`. */
async function exportTo(page: Page, path: string): Promise<void> {
  await page.goto("/#/settings");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export everything as JSON" }).click();
  await (await downloadPromise).saveAs(path);
}

test("export, clear the browser data, import: the log, checks and settings come back", async ({ page }, testInfo) => {
  await seedData(page);
  const file = testInfo.outputPath("export.json");
  await exportTo(page, file);

  // Clearing the browser data also forgets which program was chosen, so choose Explosive Endurance again (as the picker would).
  await page.evaluate(() => {
    window.localStorage.clear();
    window.localStorage.setItem("workout-app.active-program", JSON.stringify({ version: 1, programId: "explosive-endurance" }));
  });
  await page.goto("/#/history");
  await page.reload();
  await expect(page.getByText("Nothing logged yet", { exact: false }).first()).toBeVisible();

  await page.goto("/#/settings");
  await page.getByLabel("Import from JSON").setInputFiles(file);
  await expect(page.getByText("2 sessions")).toBeVisible();
  await expect(page.getByText("3 sets")).toBeVisible();
  await expect(page.getByText("1 weekly check", { exact: true })).toBeVisible();
  await expect(page.getByText("Dates: 2026-11-02 to 2026-11-04")).toBeVisible();
  await expect(page.getByText("Start date: 2026-11-02")).toBeVisible();
  await expect(page.getByText(/^Exported 20\d\d-\d\d-\d\d$/)).toBeVisible();
  await expect(page.getByText("You have 0 sessions now.")).toBeVisible();

  await page.getByRole("button", { name: "Replace my data" }).click();
  await expect(page.getByText("This replaces the log")).toBeVisible();
  await page.getByRole("button", { name: "Yes, replace my data" }).click();

  await expect(page.locator(".toast")).toContainText("Imported. You can undo it in Settings.");
  await expect(page).toHaveURL(/#\/today$/);
  await expect(page.getByRole("heading", { name: "Program overview" })).toHaveCount(0);

  await page.goto("/#/history");
  await expect(page.getByText("2026-11-04").or(page.getByText("4 Nov")).first()).toBeVisible();

  await page.goto("/#/settings");
  await expect(page.getByLabel("Start date")).toHaveValue("2026-11-02");
  await expect(page.getByLabel("Max reps: Pull-ups")).toHaveValue("14");

  const stored = await page.evaluate(() => ({
    history: JSON.parse(window.localStorage.getItem("explosive-endurance.max-history") ?? "null"),
    fatigue: JSON.parse(window.localStorage.getItem("explosive-endurance.fatigue") ?? "null"),
    log: JSON.parse(window.localStorage.getItem("explosive-endurance.log") ?? "null"),
  }));
  expect(stored.history.maxHistory.pull_up).toEqual([{ savedOn: "2026-11-02", reps: 12 }, { savedOn: "2026-12-18", reps: 14 }]);
  expect(stored.fatigue.checks).toHaveLength(1);
  expect(stored.log.sessions).toHaveLength(2);
});

test("importing keeps the replaced data as a backup that the next export carries", async ({ page }, testInfo) => {
  await seedData(page);
  const file = testInfo.outputPath("export.json");
  await exportTo(page, file);
  // A different export to import over the seeded data: an empty log.
  const other = JSON.parse(readFileSync(file, "utf-8"));
  other.log.sessions = [];
  const otherFile = testInfo.outputPath("other.json");
  writeFileSync(otherFile, JSON.stringify(other));

  await page.getByLabel("Import from JSON").setInputFiles(otherFile);
  await page.getByRole("button", { name: "Replace my data" }).click();
  await page.getByRole("button", { name: "Yes, replace my data" }).click();
  await expect(page.locator(".toast")).toContainText("Imported");

  const secondFile = testInfo.outputPath("second.json");
  await exportTo(page, secondFile);
  const exported = JSON.parse(readFileSync(secondFile, "utf-8"));
  expect(exported.log.sessions).toEqual([]);
  expect(exported.importBackups).toHaveLength(1);
  expect(exported.importBackups[0].key).toMatch(/^explosive-endurance\.import-backup-/);
  expect(JSON.parse(exported.importBackups[0].text).log.sessions).toHaveLength(2);
});

test("a backup of another program is refused with a message naming it, and nothing changes", async ({ page }, testInfo) => {
  await seedData(page);
  const file = testInfo.outputPath("export.json");
  await exportTo(page, file);
  const exported = JSON.parse(readFileSync(file, "utf-8"));
  expect(exported.version).toBe(2);
  expect(exported.programId).toBe("explosive-endurance");

  const otherProgramFile = testInfo.outputPath("steady.json");
  writeFileSync(otherProgramFile, JSON.stringify({ ...exported, programId: "steady-strength" }));
  const before = await page.evaluate(() => JSON.stringify(window.localStorage));

  await page.getByLabel("Import from JSON").setInputFiles(otherProgramFile);

  await expect(page.locator(".import-error")).toContainText(
    'This backup is for "Steady Strength", but you\'re using "Explosive Endurance Program". Switch program first, then import it.',
  );
  await expect(page.getByRole("button", { name: "Replace my data" })).toHaveCount(0);
  expect(await page.evaluate(() => JSON.stringify(window.localStorage))).toBe(before);
});

test("a version 1 export file (from before programs had ids) imports into Explosive Endurance", async ({ page }, testInfo) => {
  // Hand-written in the shape the version 1 app exported: no programId, no maxHistory block.
  const version1File = testInfo.outputPath("version1.json");
  writeFileSync(
    version1File,
    JSON.stringify({
      format: "explosive-endurance-export",
      version: 1,
      exportedAt: "2026-11-05T08:00:00.000Z",
      settings: { version: 2, startDate: "2026-11-02", maxReps: { pull_up: 12 }, maxSavedOn: { pull_up: "2026-11-02" } },
      log: {
        version: 1,
        sessions: [
          {
            date: "2026-11-02", programWeek: 1, day: 1,
            sets: [{ exerciseId: "pull_up", blockPosition: 3, setNumber: 1, reps: 5, loggedAt: "2026-11-02T18:00:00.000Z" }],
          },
        ],
      },
      fatigueChecks: { version: 1, checks: [{ date: "2026-11-09", maxPullUps: 10, savedAt: "2026-11-09T07:30:00.000Z" }] },
    }),
  );

  await page.goto("/#/settings");
  await page.getByLabel("Import from JSON").setInputFiles(version1File);
  await expect(page.getByText("1 session", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Replace my data" }).click();
  await page.getByRole("button", { name: "Yes, replace my data" }).click();
  await expect(page.locator(".toast")).toContainText("Imported. You can undo it in Settings.");

  const stored = await page.evaluate(() => ({
    log: JSON.parse(window.localStorage.getItem("explosive-endurance.log") ?? "null"),
    fatigue: JSON.parse(window.localStorage.getItem("explosive-endurance.fatigue") ?? "null"),
    settings: JSON.parse(window.localStorage.getItem("explosive-endurance.settings") ?? "null"),
  }));
  expect(stored.log.sessions).toHaveLength(1);
  expect(stored.fatigue.checks).toHaveLength(1);
  expect(stored.settings.startDate).toBe("2026-11-02");
});

test("Cancel leaves everything as it was", async ({ page }, testInfo) => {
  await seedData(page);
  const file = testInfo.outputPath("export.json");
  await exportTo(page, file);

  await page.getByLabel("Import from JSON").setInputFiles(file);
  await page.getByRole("button", { name: "Replace my data" }).click();
  await page.getByRole("button", { name: "Cancel" }).click();

  await expect(page.getByRole("button", { name: "Yes, replace my data" })).toHaveCount(0);
  const keys = await page.evaluate(() => Object.keys(window.localStorage).filter((key) => key.includes("import-backup")));
  expect(keys).toEqual([]);
});

test("a file that is not an export is refused with a message and nothing changes", async ({ page }, testInfo) => {
  await seedData(page);
  await page.goto("/#/settings");
  const notJson = testInfo.outputPath("notes.json");
  writeFileSync(notJson, "{not json");
  const wrongFormat = testInfo.outputPath("other.json");
  writeFileSync(wrongFormat, JSON.stringify({ hello: "world" }));
  const futureVersion = testInfo.outputPath("future.json");
  writeFileSync(futureVersion, JSON.stringify({ format: "explosive-endurance-export", version: 3 }));

  await page.getByLabel("Import from JSON").setInputFiles(notJson);
  await expect(page.locator(".import-error")).toContainText("could not be read as JSON");

  await page.getByLabel("Import from JSON").setInputFiles(wrongFormat);
  await expect(page.locator(".import-error")).toContainText("not an export file from this app");

  await page.getByLabel("Import from JSON").setInputFiles(futureVersion);
  await expect(page.locator(".import-error")).toContainText("version 3");

  await expect(page.getByRole("button", { name: "Replace my data" })).toHaveCount(0);
  const logText = await page.evaluate(() => window.localStorage.getItem("explosive-endurance.log"));
  expect(JSON.parse(logText ?? "{}").sessions).toHaveLength(2);
});

test("a file with some unreadable sets lists the problem in the preview", async ({ page }, testInfo) => {
  await seedData(page);
  const file = testInfo.outputPath("export.json");
  await exportTo(page, file);
  const damaged = JSON.parse(readFileSync(file, "utf-8"));
  damaged.log.sessions[0].sets[1].reps = -1;
  const damagedFile = testInfo.outputPath("damaged.json");
  writeFileSync(damagedFile, JSON.stringify(damaged));

  await page.getByLabel("Import from JSON").setInputFiles(damagedFile);

  await expect(page.getByText("2 sets")).toBeVisible();
  await expect(page.getByText("could not be read and will be left out")).toBeVisible();
  await expect(page.getByRole("button", { name: "Replace my data" })).toBeVisible();
});

test("the import button is at least 48px tall and disabled while previewing another date", async ({ page }) => {
  await page.goto("/#/settings");
  const box = await page.locator(".import-file-button").boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(48);
  await expect(page.getByLabel("Import from JSON")).toBeEnabled();

  await page.goto("/?date=2026-11-09#/settings");
  await expect(page.getByLabel("Import from JSON")).toBeDisabled();
  await expect(page.getByText("Import is turned off while previewing")).toBeVisible();
});

test("Undo last import restores the previous data, and can be confirmed or cancelled", async ({ page }, testInfo) => {
  await seedData(page);
  const file = testInfo.outputPath("export.json");
  await exportTo(page, file);
  const other = JSON.parse(readFileSync(file, "utf-8"));
  other.log.sessions = [];
  const otherFile = testInfo.outputPath("other.json");
  writeFileSync(otherFile, JSON.stringify(other));

  await expect(page.getByRole("button", { name: "Undo last import" })).toHaveCount(0);

  await page.getByLabel("Import from JSON").setInputFiles(otherFile);
  await expect(page.getByText("You have 2 sessions now.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Replace my data" })).toBeFocused();
  await page.getByRole("button", { name: "Replace my data" }).click();
  await expect(page.getByRole("button", { name: "Yes, replace my data" })).toBeFocused();
  await page.getByRole("button", { name: "Yes, replace my data" }).click();
  await expect(page.locator(".toast")).toContainText("You can undo it in Settings");
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();

  await page.goto("/#/settings");
  await page.getByRole("button", { name: "Undo last import" }).click();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByLabel("Import from JSON")).toBeFocused();
  const sessionsAfterCancel = await page.evaluate(() => JSON.parse(window.localStorage.getItem("explosive-endurance.log") ?? "{}").sessions.length);
  expect(sessionsAfterCancel).toBe(0);

  await page.getByRole("button", { name: "Undo last import" }).click();
  await page.getByRole("button", { name: "Yes, undo the import" }).click();
  await expect(page.locator(".toast").last()).toContainText("Imported");
  await expect(page).toHaveURL(/#\/today$/);

  const restored = await page.evaluate(() => ({
    log: JSON.parse(window.localStorage.getItem("explosive-endurance.log") ?? "null"),
    history: JSON.parse(window.localStorage.getItem("explosive-endurance.max-history") ?? "null"),
  }));
  expect(restored.log.sessions).toHaveLength(2);
  expect(restored.history.maxHistory.pull_up).toHaveLength(2);
});

test("a file with an unknown settings version is refused and nothing changes", async ({ page }, testInfo) => {
  await seedData(page);
  const file = testInfo.outputPath("export.json");
  await exportTo(page, file);
  const future = JSON.parse(readFileSync(file, "utf-8"));
  future.settings = { version: 9 };
  const futureFile = testInfo.outputPath("future-settings.json");
  writeFileSync(futureFile, JSON.stringify(future));

  await page.getByLabel("Import from JSON").setInputFiles(futureFile);

  await expect(page.locator(".import-error")).toContainText("version 9");
  await expect(page.locator(".import-error")).toContainText("Nothing was changed");
  await expect(page.getByRole("button", { name: "Replace my data" })).toHaveCount(0);
  const keys = await page.evaluate(() => Object.keys(window.localStorage).filter((key) => key.includes("import-backup")));
  expect(keys).toEqual([]);
});
