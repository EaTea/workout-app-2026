import type { Program, ProgramWarning } from "../program/model";
import { toDayNumber, todayLocalDate } from "../program/calendar";
import type { TrainingSettings } from "../settings/model";
import { saveSettings } from "../settings/storage";
import { element } from "./dom";
import { navigateTo, parseLogRoute, routeFromHash, type Route } from "./router";
import { applyLogChange, type LoadLogResult } from "../log/storage";
import type { WorkoutLog } from "../log/model";
import type { LogChangeOutcome } from "./logChange";
import { renderLogScreen } from "./logScreen";
import { renderHistoryScreen } from "./history";
import { isSessionInProgress } from "../log/sessionProgress";
import { buildSession } from "../program/schedule";
import { createScreenWakeLock } from "../timer/wakeLock";
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
 * The shown date (pinned session): `startApp` keeps ONE "shown date", set from
 * `resolveToday` at startup. Today renders for it, and every log screen
 * address carries its own date (`#/log/<date>/<block>/<exercise>`), so what is
 * logged always goes to the session Ed is looking at. The shown date only
 * moves forward when the new-day banner's button is tapped (or the page is
 * reloaded); navigating Today -> History -> Today keeps it.
 *
 * Midnight rollover: if the app stays open past local midnight it does NOT
 * swap the session by itself (that could replace the workout under someone
 * training at 23:30 and lose scroll/focus, or send sets to the wrong day).
 * Instead a "It's a new day" banner is inserted at the top of Today's <main>,
 * and it stays (also after leaving and coming back to Today) until its
 * button is tapped, which moves the shown date to the real date.
 *
 *   every 60s / page visible ─▶ handleClockCheck ─┬─▶ updateSessionWakeLock  (idle timeout, midnight)
 *                                                 └─▶ shouldShowNewDayBanner? ─▶ main.prepend(banner)
 *   every render of Today ────▶ same banner check (a re-render must not lose the banner)
 *   banner button ─▶ shownDate = resolveToday ─▶ render()  (banner disappears)
 *
 * While a timer overlay or exercise sheet is open the banner may still be
 * added: both mark `#app > main` inert, and inert applies to the whole
 * subtree, so a child inserted later is inert too (no focus, no taps) until
 * the overlay closes and removes inert from <main>. Nothing is replaced.
 *
 * Log changes: screens never save a log they built themselves. They call
 * `changeLog(operation)`, which re-reads storage, applies the one operation to
 * that fresh log, saves, and keeps the result as the app's copy (log/storage.ts
 * `applyLogChange`). If the stored log cannot be read safely, nothing is saved
 * and the screen shows why.
 *
 * Screen stays awake while a session is in progress (PLAN.md rule 8): one
 * app-level ScreenWakeLock is wanted when the route is Today or the log
 * screen AND the session of the date on screen is in progress AND that date is
 * still the real current date (`resolveToday`). "In progress" (see
 * `isSessionInProgress`) ends when every set is logged or 45 minutes pass with
 * nothing logged, so the lock is re-evaluated after every render, every log
 * change and on the minute check; a session left open past midnight loses the
 * lock at the next check, because its date is no longer today's.
 * The timer overlay keeps its own lock (timerView.ts) while open; the two
 * coexist as separate sentinels, so closing the overlay never drops the
 * session lock and vice versa.
 */

/** How often a left-open app re-checks the local date and the session idle timeout. */
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
 * True when the date the app would show now differs from `shownDate`, the
 * date Today is showing. A valid `?date=` in `search` pins the
 * date, so a preview never counts as changed. Used by the midnight check in `startApp`.
 */
export function hasTodayChanged(shownDate: string, search: string, now: Date = new Date()): boolean {
  return resolveToday(search, now) !== shownDate;
}

/**
 * Pure decision for the midnight check: show the new-day banner only on the
 * Today route, when the date shown differs from the date now (see
 * `hasTodayChanged`; a `?date=` preview never differs), and not if the banner
 * is already on screen. Used by `showNewDayBannerIfNeeded` in `startApp`.
 */
export function shouldShowNewDayBanner(
  route: Route,
  shownDate: string,
  search: string,
  isBannerShown: boolean,
  now: Date = new Date(),
): boolean {
  return route === "today" && !isBannerShown && hasTodayChanged(shownDate, search, now);
}

/** Inline message on the welcome card when "Start today" cannot be saved. */
export const START_TODAY_SAVE_FAILED_MESSAGE = "Couldn't save on this device, so the start date won't be remembered.";

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
  /**
   * The pinned session date: what Today shows. Set once here and moved only by
   * `handleShowNewDay` (the banner button), so a session left open past
   * midnight is not swapped under Ed. Compared against the clock by
   * `showNewDayBannerIfNeeded`.
   */
  let shownDate = resolveToday(window.location.search);
  /** The app-level lock for "session in progress"; separate from each timer overlay's own lock. Lives as long as the page. */
  const sessionWakeLock = createScreenWakeLock();

  /**
   * Decides whether the screen should be kept awake right now and tells the
   * session lock. Wanted on Today (for the shown date) and on the log screen
   * (for the date in its address) when that date is the real current date and
   * its session is in progress (`isSessionInProgress`, which also applies the
   * 45-minute idle timeout using the current time). Called at the end of
   * `render()`, from `changeLog` (the log screen redraws itself without a full
   * render) and from `handleClockCheck` (so midnight and the idle timeout take
   * effect without any tap). Never throws: a program gap on the date just
   * means "not wanted".
   */
  function updateSessionWakeLock(): void {
    const route = routeFromHash(window.location.hash);
    let sessionDate: string | undefined;
    if (route === "today") sessionDate = shownDate;
    if (route === "log") sessionDate = parseLogRoute(window.location.hash)?.date;

    let isWanted = false;
    if (sessionDate !== undefined && sessionDate === resolveToday(window.location.search)) {
      try {
        isWanted = isSessionInProgress(buildSession(program, settings, sessionDate), log, sessionDate, new Date());
      } catch {
        isWanted = false;
      }
    }

    sessionWakeLock.setWanted(isWanted);
  }

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
   * Passed to the log screen and History for every change: re-reads the stored
   * log, applies the one `operation` to it, saves (`applyLogChange`), keeps the
   * resulting log as the app's copy (Today reads it for "2/6") and re-checks
   * the wake lock. Returns the log for the screen to show and an inline
   * message if saving failed (the change is kept in memory) or was refused
   * (the stored log could not be read safely; nothing changes).
   */
  function changeLog(operation: (freshLog: WorkoutLog) => WorkoutLog): LogChangeOutcome {
    const result = applyLogChange(localStorage, operation);
    if (result.log !== undefined) {
      log = result.log;
    }

    updateSessionWakeLock();
    return { log, error: result.saved ? null : result.error };
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
   * Moves the shown date forward to the real current date and redraws. Only
   * the new-day banner's button calls this, so the session on screen never
   * changes by itself.
   */
  function handleShowNewDay(): void {
    shownDate = resolveToday(window.location.search);
    render();
  }

  /**
   * Adds the "It's a new day" banner to the top of Today's existing <main>
   * if the real date has moved on from the shown date. Called after every
   * render (so leaving Today and coming back keeps the banner until it is
   * tapped) and from `handleClockCheck`. Never re-renders, so the current
   * session, scroll position, focus and any open timer/sheet are untouched.
   */
  function showNewDayBannerIfNeeded(): void {
    const main = root.querySelector("main");
    const isBannerShown = document.querySelector(".new-day-banner") !== null;
    const route = routeFromHash(window.location.hash);
    if (main === null || !shouldShowNewDayBanner(route, shownDate, window.location.search, isBannerShown)) return;

    main.prepend(renderNewDayBanner(handleShowNewDay));
  }

  /**
   * The periodic check, run every minute and when the page becomes visible (a
   * sleeping phone's timers are paused): re-evaluates the wake lock (idle
   * timeout, a session left open past midnight) and offers the new-day banner.
   */
  function handleClockCheck(): void {
    updateSessionWakeLock();
    showNewDayBannerIfNeeded();
  }

  /**
   * Draws the screen for the current hash route plus the nav bar into `root`.
   * Runs once at start and again on every `hashchange` (see `startApp`).
   */
  function render(): void {
    try {
      const route = routeFromHash(window.location.hash);
      const main = element("main", "app-main");
      if (route === "today" && warnings.length > 0 && !warningsDismissed) {
        main.append(renderWarningBanner(warnings, handleDismissWarnings));
      }
      if (route !== "settings" && loadedLog.warning !== undefined && !logWarningDismissed) {
        main.append(renderLogWarningBanner(loadedLog.warning, handleDismissLogWarning));
      }
      const logTarget = parseLogRoute(window.location.hash);
      if (route === "settings") {
        main.append(renderSettingsScreen(program, settings, todayLocalDate(), handleSave));
      } else if (route === "log" && logTarget !== undefined) {
        main.append(renderLogScreen(program, settings, logTarget.date, logTarget.blockPosition, logTarget.exerciseId, log, changeLog));
      } else if (route === "history") {
        main.append(renderHistoryScreen(program, log, changeLog));
      } else {
        main.append(renderTodayScreen(program, settings, shownDate, handleStartToday, startTodayFailureMessage, log));
      }
      // The log screen belongs to Today, so Today stays highlighted in the nav.
      root.replaceChildren(main, renderNavigationBar(route === "log" ? "today" : route));
      updateSessionWakeLock();
      showNewDayBannerIfNeeded();
    } catch (error) {
      // A throwing render (e.g. a program gap hit on one date) must not leave
      // a blank screen: show the same readable card as a startup failure.
      showStartupError(root, error);
    }
  }

  window.addEventListener("hashchange", render);
  window.setInterval(handleClockCheck, DATE_CHECK_INTERVAL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") handleClockCheck();
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
