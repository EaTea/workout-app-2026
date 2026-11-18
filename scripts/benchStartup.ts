/**
 * Startup-time benchmark: how long does the built app take to show Today as
 * the workout log grows? Run it with `npm run bench:startup` (which builds
 * first, then runs this file with plain `node`; types are stripped, so local
 * imports use `.ts` and app modules are imported as types only, apart from
 * the dependency-free helpers in src/bench).
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

/** localStorage contents the app expects; keys and shapes match src/storage and src/settings. */
const ACTIVE_PROGRAM_KEY = "workout-app.active-program";
const SETTINGS_KEY = "explosive-endurance.settings";
const LOG_KEY = "explosive-endurance.log";
const ACTIVE_PROGRAM_JSON = JSON.stringify({ version: 1, programId: "explosive-endurance" });
const SETTINGS_JSON = JSON.stringify({
  version: 1,
  startDate: "2026-11-02",
  maxReps: { pull_up: 12, dip: 15 },
});

/** The log sizes measured: a label for the output and how many days of daily sessions to generate. */
const SIZES = [
  { label: "empty", days: 0 },
  { label: "1 year", days: 365 },
  { label: "2 years", days: 730 },
];

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
    await page.locator(".item-row").first().waitFor();

    // performance.now() counts from this page's navigation start.
    return await page.evaluate(() => performance.now());
  } finally {
    await context.close();
  }
}

/** Runs the whole benchmark and prints the results. Assumes the preview server is already up. */
async function runBenchmark(): Promise<void> {
  const program = JSON.parse(readFileSync("public/program.json", "utf8")) as ProgramWire;
  const browser = await chromium.launch();

  try {
    console.log(
      `Startup benchmark: built app, Chromium, iPhone 13 viewport, CPU ${CPU_SLOWDOWN_RATE}x slower,\n` +
        `navigation start to first Today row, ${RUNS_PER_SIZE} runs per size.\n`,
    );

    for (const size of SIZES) {
      const log =
        size.days > 0
          ? buildLongLogWire(program, { days: size.days, lastDate: DAY_BEFORE_BENCHMARK_DATE })
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
