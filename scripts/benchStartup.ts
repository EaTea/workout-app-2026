/**
 * Startup-time benchmark: how long does the built app take to show Today as
 * the workout log grows? Run it with `npm run bench:startup` (which builds
 * first, then runs this file with plain `node`; types are stripped, so local
 * imports use `.ts` and app modules are imported as types only, apart from
 * the dependency-free helpers in src/bench). Needs Node 22.18 or later (type
 * stripping on by default) and must be run from the repo root.
 *
 *   node script --starts--> vite preview (port 4174)
 *        |
 *        +-- per size, 11 runs: fresh browser context
 *              1. open a static file, write localStorage   (full speed)
 *              2. turn on 4x CPU slowdown
 *              3. open Today, wait for first row, read performance.now()
 *        |
 *        +-- print one summary line per size, then kill the preview server
 */
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { chromium, devices } from "@playwright/test";
import type { ProgramWire } from "../src/program/wire.ts";
import { buildLongLogWire } from "../src/bench/longLog.ts";
import { formatTimingRow, summarizeTimings } from "../src/bench/timings.ts";

const PREVIEW_PORT = 4174;
const BASE_URL = `http://localhost:${PREVIEW_PORT}`;
const RUNS_PER_SIZE = 11;
const CPU_SLOWDOWN_RATE = 4;

/** The benchmark pretends today is this date, via the app's `?date=` preview parameter. */
const BENCHMARK_DATE = "2026-11-18";
const DAY_BEFORE_BENCHMARK_DATE = "2026-11-17";

/** The program start date: seeded into the app's settings AND used to anchor the generated log's day cycle. */
const PROGRAM_START_DATE = "2026-11-02";

/** localStorage contents the app expects; keys and shapes match src/storage and src/settings. */
const ACTIVE_PROGRAM_KEY = "workout-app.active-program";
const SETTINGS_KEY = "explosive-endurance.settings";
const LOG_KEY = "explosive-endurance.log";
const ACTIVE_PROGRAM_JSON = JSON.stringify({ version: 1, programId: "explosive-endurance" });
const SETTINGS_JSON = JSON.stringify({
  version: 1,
  startDate: PROGRAM_START_DATE,
  maxReps: { pull_up: 12, dip: 15 },
});

/** The log sizes measured: a label for the output and how many days of daily sessions to generate. */
const SIZES = [
  { label: "empty", days: 0 },
  { label: "1 year", days: 365 },
  { label: "2 years", days: 730 },
];

/**
 * A row on the Today screen. `.item-row` alone would also match the day plan
 * (src/ui/dayPlan.ts, whose section has the extra class `day-plan`), so the
 * selector is scoped to a Today-style screen.
 */
const TODAY_ROW_SELECTOR = ".app-main section.screen:not(.day-plan) .item-row";

/**
 * Throws unless the page we just timed really was Today with the seeded log
 * loaded: otherwise a fast "result" could be an error page, a set-aside
 * corrupt log, or a log the app silently ignored. Checks, in order: Today (not
 * the day plan) is showing; no warning banner (app.ts renderLogWarningBanner,
 * class `warning-banner`); no `.corrupt-` backup key in localStorage; and,
 * when a log was seeded, at least one "Last time" hint (`.item-last-time`).
 */
async function verifyMeasuredTodayWithLog(
  page: Awaited<ReturnType<Awaited<ReturnType<typeof chromium.launch>>["newPage"]>>,
  logWasSeeded: boolean,
): Promise<void> {
  const findings = await page.evaluate(
    (selectors) => ({
      isToday: document.querySelector(selectors.todayHeader) !== null,
      warningBannerCount: document.querySelectorAll(".warning-banner").length,
      corruptKeys: Object.keys(localStorage).filter((key) => key.includes(".corrupt-")),
      lastTimeHintCount: document.querySelectorAll(".item-last-time").length,
    }),
    { todayHeader: ".app-main section.screen:not(.day-plan) > .today-header" },
  );

  if (!findings.isToday) throw new Error("Benchmark invalid: the page is not the Today screen");
  if (findings.warningBannerCount > 0) {
    throw new Error("Benchmark invalid: a warning banner is shown (the log or program was not read cleanly)");
  }
  if (findings.corruptKeys.length > 0) {
    throw new Error(`Benchmark invalid: the app set the log aside (${findings.corruptKeys.join(", ")})`);
  }
  if (logWasSeeded && findings.lastTimeHintCount === 0) {
    throw new Error('Benchmark invalid: a log was seeded but no "Last time" hint is shown, so the log was not used');
  }
}

/**
 * Starts `vite preview` on the benchmark port as a child process.
 * Uses the project's local vite binary; `--strictPort` makes it fail loudly
 * instead of silently picking another port that we would not be talking to.
 */
function startPreviewServer(): ChildProcess {
  return spawn("node_modules/.bin/vite", ["preview", "--port", String(PREVIEW_PORT), "--strictPort"], {
    stdio: "ignore",
  });
}

/**
 * Waits until the preview server answers HTTP, or fails after 30 seconds
 * (or immediately if the server process exits, e.g. the port is taken).
 */
async function waitForServer(server: ChildProcess): Promise<void> {
  let serverExited = false;
  server.once("exit", () => {
    serverExited = true;
  });

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (serverExited) throw new Error(`vite preview exited early (is port ${PREVIEW_PORT} in use?)`);
    try {
      const response = await fetch(`${BASE_URL}/`);
      if (response.ok) return;
    } catch {
      // Not listening yet; try again shortly.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("vite preview did not answer within 30 seconds");
}

/**
 * Measures one run: milliseconds from navigation start until the first Today
 * row is on screen, in a brand-new browser context so nothing is cached.
 */
async function measureOneRun(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  logJson: string | null,
): Promise<number> {
  const context = await browser.newContext({ ...devices["iPhone 13"], serviceWorkers: "block" });
  try {
    const page = await context.newPage();

    // Seed storage by visiting a static file and writing with page.evaluate,
    // BEFORE slowing the CPU. Never seed with addInitScript: that code runs at
    // the start of every page load, on the slowed CPU, and its cost (parsing
    // and writing a multi-megabyte log) would be timed as if it were the app.
    await page.goto(`${BASE_URL}/manifest.webmanifest`);
    await page.evaluate(
      (seed) => {
        localStorage.setItem(seed.activeProgramKey, seed.activeProgramJson);
        localStorage.setItem(seed.settingsKey, seed.settingsJson);
        if (seed.logJson !== null) localStorage.setItem(seed.logKey, seed.logJson);
      },
      {
        activeProgramKey: ACTIVE_PROGRAM_KEY,
        activeProgramJson: ACTIVE_PROGRAM_JSON,
        settingsKey: SETTINGS_KEY,
        settingsJson: SETTINGS_JSON,
        logKey: LOG_KEY,
        logJson,
      },
    );

    const cpuSession = await context.newCDPSession(page);
    await cpuSession.send("Emulation.setCPUThrottlingRate", { rate: CPU_SLOWDOWN_RATE });

    await page.goto(`${BASE_URL}/?date=${BENCHMARK_DATE}`);

    // The timestamp is taken inside the page, in the same frame that first
    // sees a Today row (performance.now() counts from navigation start).
    // Playwright's own polling plus a separate evaluate round trip, on the
    // slowed CPU, added about 75 to 95 ms of harness time to every figure.
    const timestampHandle = await page.waitForFunction(
      (rowSelector) => (document.querySelector(rowSelector) ? performance.now() : false),
      TODAY_ROW_SELECTOR,
      { polling: "raf" },
    );
    const elapsedMilliseconds = (await timestampHandle.jsonValue()) as number;

    await verifyMeasuredTodayWithLog(page, logJson !== null);
    return elapsedMilliseconds;
  } finally {
    await context.close();
  }
}

/**
 * Checks that parsed program.json has the wire shape the log generator needs
 * (an object with a `days` array) and returns it as `ProgramWire`. The
 * generator only reads the wire shape, so this is a minimal decode rather than
 * the app's full validation (CLAUDE.md section 6: wire types stay at the edge).
 */
function decodeProgramWire(parsed: unknown): ProgramWire {
  if (typeof parsed !== "object" || parsed === null || !Array.isArray((parsed as { days?: unknown }).days)) {
    throw new Error("public/program.json must be an object with a `days` array (run from the repo root)");
  }
  return parsed as ProgramWire;
}

/** Runs the whole benchmark and prints the results. Assumes the preview server is already up. */
async function runBenchmark(): Promise<void> {
  const program = decodeProgramWire(JSON.parse(readFileSync("public/program.json", "utf8")));
  const browser = await chromium.launch();

  try {
    console.log(
      `Startup benchmark: built app, Chromium, iPhone 13 viewport, CPU ${CPU_SLOWDOWN_RATE}x slower,\n` +
        `navigation start until the first Today row is in the page, timed inside the page, ${RUNS_PER_SIZE} runs per size.\n`,
    );

    for (const size of SIZES) {
      const log =
        size.days > 0
          ? buildLongLogWire(program, {
              days: size.days,
              lastDate: DAY_BEFORE_BENCHMARK_DATE,
              programStartDate: PROGRAM_START_DATE,
            })
          : null;
      const setCount = log === null ? 0 : log.sessions.reduce((total, session) => total + session.sets.length, 0);
      const logJson = log === null ? null : JSON.stringify(log);

      const timings: number[] = [];
      for (let run = 0; run < RUNS_PER_SIZE; run++) {
        timings.push(await measureOneRun(browser, logJson));
      }

      console.log(formatTimingRow(size.label, setCount, summarizeTimings(timings)));
    }
  } finally {
    await browser.close();
  }
}

/** Entry point: start the preview server, benchmark, and always stop the server again. */
async function main(): Promise<void> {
  const server = startPreviewServer();
  // Stops the preview server; safe to call more than once.
  const stopServer = (): void => {
    server.kill("SIGTERM");
  };

  // Ctrl+C / termination: stop the server, then leave with the conventional code.
  process.once("SIGINT", () => {
    stopServer();
    process.exit(130);
  });
  process.once("SIGTERM", () => {
    stopServer();
    process.exit(143);
  });

  try {
    await waitForServer(server);
    await runBenchmark();
  } finally {
    stopServer();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
