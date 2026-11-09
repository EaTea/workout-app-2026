import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

/** Seeds settings and a two-session log (wire format), once per test, before the app loads. */
async function seedLog(page: Page): Promise<void> {
  const set = (exerciseId: string, blockPosition: number, setNumber: number, reps: number, extra: Record<string, unknown> = {}) => ({
    exerciseId, blockPosition, setNumber, reps, loggedAt: "2026-11-02T18:00:00.000Z", ...extra,
  });
  const log = {
    version: 1,
    sessions: [
      {
        date: "2026-11-02", programWeek: 1, day: 1,
        sets: [set("med_ball_slam", 2, 1, 6), set("med_ball_slam", 2, 2, 5, { note: 'slow, "heavy" day' }), set("pull_up", 3, 1, 5, { loadKg: 8 })],
      },
      { date: "2026-11-04", programWeek: 1, day: 3, sets: [set("dip", 3, 1, 7, { loadKg: 10 })] },
    ],
  };
  await page.addInitScript((seed) => {
    window.localStorage.setItem("explosive-endurance.settings", JSON.stringify({ version: 1, startDate: "2026-11-02", maxReps: { pull_up: 12, dip: 15 } }));
    window.localStorage.setItem("explosive-endurance.log", JSON.stringify(seed));
  }, log);
}

/** Clicks `buttonName` on Settings and returns the downloaded file's name and text. */
async function downloadFromSettings(page: Page, buttonName: string): Promise<{ name: string; text: string }> {
  await page.goto("/#/settings");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: buttonName }).click();
  const download = await downloadPromise;
  const path = await download.path();
  return { name: download.suggestedFilename(), text: readFileSync(path, "utf-8") };
}

test("Export log as CSV downloads one quoted row per set", async ({ page }) => {
  await seedLog(page);

  const { name, text } = await downloadFromSettings(page, "Export log as CSV");

  expect(name).toMatch(/^explosive-endurance-\d{4}-\d{2}-\d{2}\.csv$/);
  const lines = text.split("\r\n");
  expect(lines[0]).toBe("date,week,day,block,block_type,exercise_id,exercise_name,set,reps,kg,note");
  expect(lines).toHaveLength(1 + 4 + 1); // header, four sets, trailing line break
  expect(lines[2]).toMatch(/^2026-11-02,1,1,2,[^,]+,med_ball_slam,[^,]+,2,5,,"slow, ""heavy"" day"$/);
  expect(lines[3]).toMatch(/^2026-11-02,1,1,3,[^,]+,pull_up,Pull-ups,1,5,8,$/);
  expect(lines[4]).toMatch(/^2026-11-04,1,3,3,[^,]+,dip,Dips,1,7,10,$/);
});

test("Export everything as JSON downloads the versioned export with every set", async ({ page }) => {
  await seedLog(page);

  const { name, text } = await downloadFromSettings(page, "Export everything as JSON");

  expect(name).toMatch(/^explosive-endurance-\d{4}-\d{2}-\d{2}\.json$/);
  const exported = JSON.parse(text);
  expect(exported.format).toBe("explosive-endurance-export");
  expect(exported.version).toBe(1);
  expect(exported.settings.startDate).toBe("2026-11-02");
  const setCount = exported.log.sessions.reduce((total: number, session: { sets: unknown[] }) => total + session.sets.length, 0);
  expect(setCount).toBe(4);
  expect(exported.fatigueChecks.checks).toEqual([]);
});

test("with an empty log the CSV button is disabled and JSON still works", async ({ page }) => {
  await page.goto("/#/settings");

  await expect(page.getByRole("button", { name: "Export log as CSV" })).toBeDisabled();
  await expect(page.getByText("Nothing logged yet")).toBeVisible();
  await expect(page.getByRole("button", { name: "Export everything as JSON" })).toBeEnabled();
  await expect(page.getByText("Nothing leaves your phone except the file you choose to share.")).toBeVisible();
});
