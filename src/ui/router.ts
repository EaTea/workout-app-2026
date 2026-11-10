import { toDayNumber } from "../program/calendar";

/**
 * Minimal hash router. Screens are addressed as `#/today`, `#/history`, `#/settings` and
 * `#/log/<date>/<blockPosition>/<exerciseId>` (the log screen for one item of
 * the session on `<date>`, `YYYY-MM-DD`); anything else (including an empty
 * or malformed hash, or an old-form `#/log/<block>/<exercise>` without a
 * date) falls back to Today. The date in the log address is what pins a log
 * screen to its session: logging goes to that date even if the clock has
 * passed midnight (PLAN.md rule 8). `app.ts` reads the current route on every
 * render and re-renders on `hashchange`. The `?date=` preview lives in the
 * query string, not the hash, so it survives navigation between screens.
 */

/** The screens the app can show. */
export type Route = "today" | "history" | "settings" | "log";

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

/** Maps a `location.hash` string such as "#/settings" to a route (default: today). */
export function routeFromHash(hash: string): Route {
  if (hash === "#/settings") return "settings";
  if (hash === "#/history") return "history";
  if (parseLogRoute(hash) !== undefined) return "log";
  return "today";
}

/** Changes the address bar to a top-level screen, which fires `hashchange` and so a re-render. */
export function navigateTo(route: "today" | "history" | "settings"): void {
  window.location.hash = `#/${route}`;
}
