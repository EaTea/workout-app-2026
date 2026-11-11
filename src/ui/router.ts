import { toDayNumber } from "../program/calendar";

/**
 * Minimal hash router. Screens are addressed as `#/today`, `#/overview`, `#/history`, `#/settings`, `#/programs` (the program picker) and
 * `#/plan/<day>/<week>` (the read-only Day plan, e.g. `#/plan/1/4`) and
 * `#/log/<date>/<blockPosition>/<exerciseId>` (the log screen for one item of
 * the session on `<date>`, `YYYY-MM-DD`); anything else (including an empty
 * or malformed hash, or an old-form `#/log/<block>/<exercise>` without a
 * date) falls back to Today (except a malformed `#/plan...` address, which shows the Overview). The date in the log address is what pins a log
 * screen to its session: logging goes to that date even if the clock has
 * passed midnight (PLAN.md rule 8). `app.ts` reads the current route on every
 * render and re-renders on `hashchange`. The `?date=` preview lives in the
 * query string, not the hash, so it survives navigation between screens.
 */

/** The screens the app can show. */
export type Route = "today" | "overview" | "history" | "settings" | "programs" | "log" | "plan";

/** Which item the log screen is for: its session date, the block's 1-based position on Today, and the exercise id. */
export interface LogRouteTarget {
  date: string;
  blockPosition: number;
  exerciseId: string;
}

/** Matches `#/log/<YYYY-MM-DD>/<positive integer>/<exercise id>`; ids are letters, digits, underscore and hyphen. */
const LOG_HASH_PATTERN = /^#\/log\/(\d{4}-\d{2}-\d{2})\/(\d+)\/([A-Za-z0-9_-]+)$/;

/**
 * Reads the item a `#/log/...` hash points at, or undefined if the hash is
 * not a well-formed log route (the date must be a real calendar date and the
 * block position 1 or more).
 */
export function parseLogRoute(hash: string): LogRouteTarget | undefined {
  const match = LOG_HASH_PATTERN.exec(hash);
  if (match === null) return undefined;

  const date = match[1];
  const blockPosition = Number(match[2]);
  const exerciseId = match[3];
  if (date === undefined || exerciseId === undefined || blockPosition < 1) return undefined;

  try {
    toDayNumber(date);
  } catch {
    return undefined;
  }

  return { date, blockPosition, exerciseId };
}

/** Builds the hash for an item's log screen; the inverse of `parseLogRoute`. Used for the Today row links. */
export function logRouteHash(date: string, blockPosition: number, exerciseId: string): string {
  return `#/log/${date}/${blockPosition}/${exerciseId}`;
}

/** Which Day plan a `#/plan/<day>/<week>` hash asks for: day number 1-7 is not checked here, only that both are positive integers. */
export interface PlanRouteTarget {
  dayNumber: number;
  week: number;
}

/** Matches `#/plan/<digits>/<digits>`. */
const PLAN_HASH_PATTERN = /^#\/plan\/(\d+)\/(\d+)$/;

/**
 * Reads the day and week a `#/plan/<day>/<week>` hash points at, or undefined
 * if the hash is not well-formed (both must be whole numbers of 1 or more).
 * Whether they fall inside the program is decided later by `buildDayPlan`.
 * Used by `routeFromHash` and by app.ts to render the Day plan screen.
 */
export function parsePlanRoute(hash: string): PlanRouteTarget | undefined {
  const match = PLAN_HASH_PATTERN.exec(hash);
  if (match === null) return undefined;

  const dayNumber = Number(match[1]);
  const week = Number(match[2]);
  if (dayNumber < 1 || week < 1) return undefined;

  return { dayNumber, week };
}

/** Builds the hash for a Day plan; the inverse of `parsePlanRoute`. Used by the Overview rows and the week picker. */
export function planRouteHash(dayNumber: number, week: number): string {
  return `#/plan/${dayNumber}/${week}`;
}

/**
 * Maps a `location.hash` string such as "#/settings" to a route (default:
 * today). A hash in the plan family (`#/plan` or `#/plan/...`) that is not a
 * well-formed `#/plan/<day>/<week>` maps to the Overview, not Today, since a
 * bad plan address means "no such plan" (PLAN.md); `parsePlanRoute` itself
 * stays strict. Called by app.ts on every render.
 */
export function routeFromHash(hash: string): Route {
  if (hash === "#/settings") return "settings";
  if (hash === "#/history") return "history";
  if (hash === "#/overview") return "overview";
  if (hash === "#/programs") return "programs";
  if (parseLogRoute(hash) !== undefined) return "log";
  if (parsePlanRoute(hash) !== undefined) return "plan";
  if (hash === "#/plan" || hash.startsWith("#/plan/")) return "overview";
  return "today";
}

/**
 * Changes the address bar to a top-level screen, which fires `hashchange` and
 * so a re-render. "overview" is the program overview (welcome) screen.
 */
export function navigateTo(route: "today" | "overview" | "history" | "settings"): void {
  window.location.hash = `#/${route}`;
}
