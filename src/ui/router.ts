/**
 * Minimal hash router. Screens are addressed as `#/today` and `#/settings`;
 * anything else (including an empty hash) falls back to Today. `app.ts` reads
 * the current route on every render and re-renders on `hashchange`.
 */

/** The screens the app can show. */
export type Route = "today" | "settings";

/** Maps a `location.hash` string such as "#/settings" to a route (default: today). */
export function routeFromHash(hash: string): Route {
  return hash === "#/settings" ? "settings" : "today";
}

/** Changes the address bar to `route`, which fires `hashchange` and so a re-render. */
export function navigateTo(route: Route): void {
  window.location.hash = `#/${route}`;
}
