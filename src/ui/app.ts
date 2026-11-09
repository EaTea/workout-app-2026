import type { Program, ProgramWarning } from "../program/model";
import { toDayNumber, todayLocalDate } from "../program/calendar";
import type { TrainingSettings } from "../settings/model";
import { saveSettings } from "../settings/storage";
import { element } from "./dom";
import { navigateTo, parseLogRoute, routeFromHash, type Route } from "./router";
import { saveLog, type LoadLogResult } from "../log/storage";
import type { WorkoutLog } from "../log/model";
import { LOG_SAVE_FAILED_MESSAGE, renderLogScreen } from "./logScreen";
import { renderHistoryScreen } from "./history";
import { renderNewDayBanner } from "./newDayBanner";
import { renderSettingsScreen } from "./settings";
import { renderTodayScreen } from "./today";
import { focusMainHeading, renderWarningBanner } from "./warningBanner";

/**
 * App shell: owns the in-memory settings and workout log, picks the screen
 * for the current hash route, and draws the bottom navigation bar.
 *
 *   main.ts ──startApp──▶ render() ◀── hashchange
 *                           ├─ <main> Today | Log screen | History | Settings screen
 *                           └─ <nav>  Today | History | Settings
 *
 * Optional `?date=YYYY-MM-DD` in the page URL overrides "today" (used by E2E
 * tests, and by Ed to preview another day). The preview affects Today and
 * "Start today" only; max save dates always use the real local date.
 *
 * Midnight rollover: if Today stays open past local midnight it does NOT
 * swap the session by itself (that could replace the workout under someone
 * training at 23:30 and lose scroll/focus). Instead a "It's a new day"
 * banner is inserted at the top of the existing <main>; its button re-renders
 * Today for the new date, as does navigating away and back.
 *
 *   every 60s / page visible ─▶ shouldShowNewDayBanner? ─▶ main.prepend(banner)
 *   banner button ─▶ render()   (redraws for the new date; banner disappears)
 *
 * While a timer overlay or exercise sheet is open the banner may still be
 * added: both mark `#app > main` inert, and inert applies to the whole
 * subtree, so a child inserted later is inert too (no focus, no taps) until
 * the overlay closes and removes inert from <main>. Nothing is replaced.
 */

/** How often a left-open Today screen checks whether the local date has changed. */
const DATE_CHECK_INTERVAL_MS = 60_000;

/** How long the "Saved" confirmation stays on screen. */
const SAVED_TOAST_MILLISECONDS = 2500;

/**
 * Returns the calendar date the app treats as today: the valid `?date=` value
 * from `search` (a `location.search` string) if present, else the local date.
 */
export function resolveToday(search: string, now: Date = new Date()): string {
  const override = new URLSearchParams(search).get("date");
  if (override !== null) {
    try {
      toDayNumber(override);
      return override;
    } catch {
      // Invalid override: ignore it and use the real date.
    }
  }
  return todayLocalDate(now);
}

/**
 * True when the date the app would show now differs from `renderedDate`, the
 * date the screen was last drawn for. A valid `?date=` in `search` pins the
 * date, so a preview never counts as changed. Used by the midnight check in `startApp`.
 */
export function hasTodayChanged(renderedDate: string, search: string, now: Date = new Date()): boolean {
  return resolveToday(search, now) !== renderedDate;
}

/**
 * Pure decision for the midnight check: show the new-day banner only on the
 * Today route, when the date shown differs from the date now (see
 * `hasTodayChanged`; a `?date=` preview never differs), and not if the banner
 * is already on screen. Used by `refreshTodayAfterMidnight` in `startApp`.
 */
export function shouldShowNewDayBanner(
  route: Route,
  renderedDate: string,
  search: string,
  isBannerShown: boolean,
  now: Date = new Date(),
): boolean {
  return route === "today" && !isBannerShown && hasTodayChanged(renderedDate, search, now);
}

/** Inline message on the welcome card when "Start today" cannot be saved. */
export const START_TODAY_SAVE_FAILED_MESSAGE = "Couldn't save on this device, so the start date won't be remembered.";

/**
 * Writes the log to `storage`, returning null on success or a message for the
 * log screen to show inline (the change stays in memory either way). Used by
 * `handleLogChanged` in `startApp`.
 */
export function persistLog(newLog: WorkoutLog, storage: Storage = localStorage): string | null {
  const result = saveLog(storage, newLog);
  return result.ok ? null : `${LOG_SAVE_FAILED_MESSAGE} (${result.error})`;
}

/** Inline message shown when settings cannot be written to this device. */
export const SAVE_FAILED_MESSAGE = "Couldn't save on this device";

/**
 * Writes settings to `storage`, returning null on success or
 * `SAVE_FAILED_MESSAGE` if the browser refuses (storage full or blocked).
 * Used by `handleSave` in `startApp`; split out so it can be unit tested.
 */
export function persistSettings(newSettings: TrainingSettings, storage: Storage = localStorage): string | null {
  try {
    saveSettings(newSettings, storage);
    return null;
  } catch {
    return SAVE_FAILED_MESSAGE;
  }
}

/**
 * Shows the app inside `root`. Re-renders on every hash change; settings
 * edits go through `saveSettings`, update the in-memory copy and return to Today.
 * `warnings` (unknown program.json fields) appear as a dismissible banner on
 * Today; dismissing hides it until the page is reloaded.
 */
export function startApp(
  root: HTMLElement,
  program: Program,
  initialSettings: TrainingSettings,
  warnings: ProgramWarning[] = [],
  loadedLog: LoadLogResult = { log: { sessions: {} } },
): void {
  let settings = initialSettings;
  let log = loadedLog.log;
  let warningsDismissed = false;
  let logWarningDismissed = false;
  /** Set when "Start today" could not be saved; shown on the welcome card. */
  let startTodayFailureMessage: string | undefined;
  /** The date Today was last drawn for; compared against the clock by `refreshTodayAfterMidnight`. */
  let renderedTodayDate = resolveToday(window.location.search);

  /** Dismiss handler for the warning banner: remembers it for this page load and re-renders. */
  function handleDismissWarnings(): void {
    warningsDismissed = true;
    render();
  }

  /** Dismiss handler for the "log could not be read" banner. */
  function handleDismissLogWarning(): void {
    logWarningDismissed = true;
    render();
  }

  /**
   * Called by the log screen and History after every change: keeps the new log as the
   * app's copy (Today reads it for "2/6") and saves it. Returns a message if
   * saving failed; the in-memory change is kept regardless.
   */
  function handleLogChanged(newLog: WorkoutLog): string | null {
    log = newLog;
    return persistLog(newLog);
  }

  /**
   * Save handler passed to the Settings screen. Persists the settings; on
   * success updates the in-memory copy, goes to Today and shows "Saved".
   * On failure returns a message for the screen to show inline and stays put.
   */
  function handleSave(newSettings: TrainingSettings): string | null {
    const failureMessage = persistSettings(newSettings);
    if (failureMessage !== null) {
      return failureMessage;
    }

    settings = newSettings;
    navigateTo("today");
    showSavedToast();
    return null;
  }

  /**
   * Handler for the first-run "Start today" button: saves `today` (which
   * honours the `?date=` override) as the start date, keeping any maxes, and
   * re-renders Today. A storage failure is shown inline on the welcome card
   * (the nav stays, and Ed can still pick a date in Settings).
   */
  function handleStartToday(): void {
    const today = resolveToday(window.location.search);
    const failureMessage = persistSettings({ ...settings, startDate: today });
    if (failureMessage !== null) {
      startTodayFailureMessage = START_TODAY_SAVE_FAILED_MESSAGE;
      render();
      return;
    }

    startTodayFailureMessage = undefined;
    settings = { ...settings, startDate: today };
    render();
  }

  /**
   * Adds the "It's a new day" banner to the top of Today's existing <main>
   * if the local date has moved on since Today was drawn. Runs on a timer and
   * when the page becomes visible (a sleeping phone's timers are paused).
   * Never re-renders, so the current session, scroll position, focus and any
   * open timer/sheet are untouched; the banner's button calls `render()`.
   */
  function refreshTodayAfterMidnight(): void {
    const main = root.querySelector("main");
    const isBannerShown = document.querySelector(".new-day-banner") !== null;
    const route = routeFromHash(window.location.hash);
    if (main === null || !shouldShowNewDayBanner(route, renderedTodayDate, window.location.search, isBannerShown)) return;

    main.prepend(renderNewDayBanner(render));
  }

  /**
   * Draws the screen for the current hash route plus the nav bar into `root`.
   * Runs once at start and again on every `hashchange` (see `startApp`).
   */
  function render(): void {
    try {
      const route = routeFromHash(window.location.hash);
      renderedTodayDate = resolveToday(window.location.search);
      const main = element("main", "app-main");
      if (route === "today" && warnings.length > 0 && !warningsDismissed) {
        main.append(renderWarningBanner(warnings, handleDismissWarnings));
      }
      if (route !== "settings" && loadedLog.warning !== undefined && !logWarningDismissed) {
        main.append(renderLogWarningBanner(loadedLog.warning, handleDismissLogWarning));
      }
      const date = resolveToday(window.location.search);
      const logTarget = parseLogRoute(window.location.hash);
      if (route === "settings") {
        main.append(renderSettingsScreen(program, settings, todayLocalDate(), handleSave));
      } else if (route === "log" && logTarget !== undefined) {
        main.append(renderLogScreen(program, settings, date, logTarget.blockPosition, logTarget.exerciseId, log, handleLogChanged));
      } else if (route === "history") {
        main.append(renderHistoryScreen(program, log, handleLogChanged));
      } else {
        main.append(renderTodayScreen(program, settings, date, handleStartToday, startTodayFailureMessage, log));
      }
      // The log screen belongs to Today, so Today stays highlighted in the nav.
      root.replaceChildren(main, renderNavigationBar(route === "log" ? "today" : route));
    } catch (error) {
      // A throwing render (e.g. a program gap hit on one date) must not leave
      // a blank screen: show the same readable card as a startup failure.
      showStartupError(root, error);
    }
  }

  window.addEventListener("hashchange", render);
  window.setInterval(refreshTodayAfterMidnight, DATE_CHECK_INTERVAL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshTodayAfterMidnight();
  });
  render();
}

/** Dismissible amber banner shown when the saved workout log could not be read (it was set aside, see log/storage.ts). */
function renderLogWarningBanner(warningText: string, onDismiss: () => void): HTMLElement {
  const banner = element("div", "card warning-banner");
  banner.setAttribute("role", "status");

  const dismissButton = element("button", "warning-dismiss", "Dismiss");
  dismissButton.type = "button";
  dismissButton.addEventListener("click", () => {
    onDismiss();
    focusMainHeading();
  });

  const header = element("div", "warning-banner-header");
  header.append(element("p", "warning-banner-text", warningText), dismissButton);
  banner.append(header);
  return banner;
}

/** Bottom nav: Today, History and Settings. */
function renderNavigationBar(activeRoute: Route): HTMLElement {
  const nav = element("nav", "bottom-nav");
  nav.setAttribute("aria-label", "Main");

  const todayLink = navigationLink("◉", "Today", "#/today", activeRoute === "today");

  const historyLink = navigationLink("▤", "History", "#/history", activeRoute === "history");

  const settingsLink = navigationLink("⚙", "Settings", "#/settings", activeRoute === "settings");

  nav.append(todayLink, historyLink, settingsLink);
  return nav;
}

/** One tappable nav entry with an icon above its label. */
function navigationLink(icon: string, label: string, href: string, isActive: boolean): HTMLAnchorElement {
  const link = element("a", isActive ? "nav-item nav-item-active" : "nav-item");
  link.href = href;
  if (isActive) {
    link.setAttribute("aria-current", "page");
  }
  link.append(element("i", undefined, icon), label);
  return link;
}

/** Briefly shows "Saved" above the nav bar. Lives outside #app so re-renders don't remove it. */
function showSavedToast(): void {
  const toast = element("div", "toast", "Saved");
  toast.setAttribute("role", "status");
  document.body.append(toast);
  window.setTimeout(() => toast.remove(), SAVED_TOAST_MILLISECONDS);
}

/** Replaces the app with a readable error card (program.json failed to parse, or a render threw). */
export function showStartupError(root: HTMLElement, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const card = element("div", "card error-card");
  card.setAttribute("role", "alert");
  card.append(element("h2", "card-title", "Could not load the program"), element("pre", "error-message", message));

  const main = element("main", "app-main");
  main.append(card);
  root.replaceChildren(main);
}
