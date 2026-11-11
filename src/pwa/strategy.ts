/**
 * How the service worker answers a request. Pure decision logic, kept apart
 * from the worker script so it can be unit tested without a browser.
 */

/** The ways the service worker can answer a request. */
export type CacheStrategy =
  /**
   * A page load: answer with the precached app shell ("./") from this worker
   * version's cache, never writing the response of a page load into the cache.
   */
  | "shell"
  /** program.json: try the network (past the HTTP cache), fall back to the cache offline. */
  | "network-first"
  /** Any other same-origin file: the precached copy wins; the cache is never written. */
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
 * the generated sw.js (see serviceWorkerSource.ts). Page loads always get the
 * shell that was precached with this worker version, so a half-arrived deploy
 * or a stray URL can never replace it; program.json goes network-first so
 * edits show up as soon as Ed is online; everything else the app owns
 * (hashed JS/CSS, icons) is immutable per build, so the precache wins.
 *
 * programs.json (the catalogue) is deliberately NOT network-first: it falls
 * under "everything else", cache-first, so it stays in step with the precached
 * JS that reads it (a catalogue newer than the app's code could name program
 * files or ids that code does not expect). A new catalogue arrives with a new
 * deploy, while program.json is network-first as above.
 *
 * This function is inlined into sw.js via `toString()`, so it must stay
 * self-contained (no imports or helpers from outside its own body).
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

  if (request.mode === "navigate") {
    return "shell";
  }

  if (url.pathname.endsWith("/program.json")) {
    return "network-first";
  }

  return "cache-first";
}
