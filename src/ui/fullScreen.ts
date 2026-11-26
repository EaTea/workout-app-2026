/**
 * The "Full screen" nav button (PR 36). Chooses what the button does from what
 * the browser allows, so the choice can be tested without a browser.
 *
 *   button tapped ──▶ readFullScreenEnvironment()   (what the browser is doing now)
 *                 ──▶ nextFullScreenStep(env)       (pure: which step to take)
 *                 ──▶ enter | exit | hint | (no button when already a home-screen app)
 *
 * iPhone Safari does not offer the Fullscreen API to web pages, so there the
 * button only shows a hint: add the app to the Home Screen, then open it from
 * there, which runs without browser bars.
 */

/** What the page can see about the browser's full-screen state. */
export interface FullScreenEnvironment {
  /** The Fullscreen API exists and is allowed here (`document.fullscreenEnabled`). */
  fullscreenEnabled: boolean;

  /** The page is full screen right now. */
  isFullScreen: boolean;

  /** The app was opened from the Home Screen, so it already has no browser bars. */
  isHomeScreenApp: boolean;
}

/** The single thing the button does when tapped. */
export type FullScreenStep = "enter" | "exit" | "showHomeScreenHint" | "hideButton";

/**
 * Picks the step for a tap. Order matters: a Home Screen app is already full
 * screen, so the button is hidden even though the API may say "enabled".
 * Used by the nav button in `app.ts`; see `readFullScreenEnvironment` for input.
 */
export function nextFullScreenStep(environment: FullScreenEnvironment): FullScreenStep {
  if (environment.isHomeScreenApp) return "hideButton";
  if (environment.isFullScreen) return "exit";
  if (environment.fullscreenEnabled) return "enter";
  return "showHomeScreenHint";
}

/** The minimal parts of `document` and `navigator` this module reads, so tests can pass fakes. */
export interface FullScreenBrowserLike {
  fullscreenEnabled: boolean;
  fullscreenElement: unknown;
  matchMedia(query: string): { matches: boolean };
  standaloneFlag: boolean | undefined;
}

/**
 * Reads the browser's current full-screen facts. Home Screen apps report
 * `display-mode: standalone`; iPhone Safari adds `navigator.standalone`, which
 * is why both are checked.
 */
export function readFullScreenEnvironment(browser: FullScreenBrowserLike): FullScreenEnvironment {
  return {
    fullscreenEnabled: browser.fullscreenEnabled,
    isFullScreen: browser.fullscreenElement !== null && browser.fullscreenElement !== undefined,
    isHomeScreenApp: browser.matchMedia("(display-mode: standalone)").matches || browser.standaloneFlag === true,
  };
}

/**
 * Text shown when the browser has no Fullscreen API (iPhone Safari). Says how
 * to get the same effect: the Home Screen app opens without browser bars.
 */
export const HOME_SCREEN_HINT =
  "This browser can't make the page full screen. On iPhone, tap Share (or ••• then Share), then Add to Home Screen, and open the app from there.";

/**
 * Text shown when the browser has the API but refuses the request (for
 * example, no recent tap). It must not give the iPhone advice, which is wrong
 * on Android and desktop.
 */
export const FULL_SCREEN_REFUSED_MESSAGE = "Couldn't go full screen. Try tapping the button again.";
