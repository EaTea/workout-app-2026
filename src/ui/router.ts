/**
 * Minimal hash router. Screens are addressed as `#/today`, `#/settings` and
 * `#/log/<blockPosition>/<exerciseId>` (the log screen for one item of
 * today's session); anything else (including an empty or malformed hash)
 * falls back to Today. `app.ts` reads the current route on every render and
 * re-renders on `hashchange`. The `?date=` preview lives in the query string,
 * not the hash, so it survives navigation between screens.
 */

/** The screens the app can show. */
export type Route = "today" | "settings" | "log";

/** Which item the log screen is for: the block's 1-based position on Today, and the exercise id. */
export interface LogRouteTarget {
  blockPosition: number;
  exerciseId: string;
}

/** Matches `#/log/<positive integer>/<exercise id>`; ids are letters, digits, underscore and hyphen. */
const LOG_HASH_PATTERN = /^#\/log\/(\d+)\/([A-Za-z0-9_-]+)$/;

/**
 * Reads the item a `#/log/...` hash points at, or undefined if the hash is
 * not a well-formed log route (block position must be 1 or more).
 */
export function parseLogRoute(hash: string): LogRouteTarget | undefined {
  const match = LOG_HASH_PATTERN.exec(hash);
  if (match === null) return undefined;

  const blockPosition = Number(match[1]);
  const exerciseId = match[2];
  if (blockPosition < 1 || exerciseId === undefined) return undefined;

  return { blockPosition, exerciseId };
}

/** Builds the hash for an item's log screen; the inverse of `parseLogRoute`. Used for the Today row links. */
export function logRouteHash(blockPosition: number, exerciseId: string): string {
  return `#/log/${blockPosition}/${exerciseId}`;
}

/** Maps a `location.hash` string such as "#/settings" to a route (default: today). */
export function routeFromHash(hash: string): Route {
  if (hash === "#/settings") return "settings";
  if (parseLogRoute(hash) !== undefined) return "log";
  return "today";
}

/** Changes the address bar to a top-level screen, which fires `hashchange` and so a re-render. */
export function navigateTo(route: "today" | "settings"): void {
  window.location.hash = `#/${route}`;
}
