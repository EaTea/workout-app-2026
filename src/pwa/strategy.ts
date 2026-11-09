/**
 * How the service worker answers a request. Pure decision logic, kept apart
 * from the worker script so it can be unit tested without a browser.
 */

/** The ways the service worker can answer a request. */
export type CacheStrategy =
  /** Try the network first, update the cache, fall back to the cache offline. */
  | "network-first"
  /** Serve from the cache; only go to the network when it isn't cached. */
  | "cache-first"
  /** Not ours to handle: let the browser do its normal thing. */
  | "ignore";

/** The few facts about a request the decision needs (a subset of `Request`). */
export interface RequestFacts {
  method: string;
  /** "navigate" for page loads; see `Request.mode`. */
  mode: string;
  /** Absolute request URL. */
  url: string;
}

/**
 * Chooses the caching strategy for a request. Called by the fetch handler in
 * the generated sw.js (see serviceWorkerSource.ts). Page loads and
 * program.json go network-first so edits to the program and new deploys show
 * up as soon as Ed is online; everything else the app owns (hashed JS/CSS,
 * icons) is immutable per build, so the cache wins.
 *
 * @param request the request facts
 * @param scopeOrigin the service worker's own origin; other origins are ignored
 */
export function chooseStrategy(request: RequestFacts, scopeOrigin: string): CacheStrategy {
  if (request.method !== "GET") {
    return "ignore";
  }

  const url = new URL(request.url);
  if (url.origin !== scopeOrigin) {
    return "ignore";
  }

  if (request.mode === "navigate" || url.pathname.endsWith("/program.json")) {
    return "network-first";
  }

  return "cache-first";
}
