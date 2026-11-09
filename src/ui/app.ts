import type { Program, ProgramWarning } from "../program/model";
import { toDayNumber, todayLocalDate } from "../program/calendar";
import type { TrainingSettings } from "../settings/model";
import { saveSettings } from "../settings/storage";
import { element } from "./dom";
import { navigateTo, routeFromHash, type Route } from "./router";
import { renderSettingsScreen } from "./settings";
import { renderTodayScreen } from "./today";
import { renderWarningBanner } from "./warningBanner";

/**
 * App shell: owns the in-memory settings, picks the screen for the current
 * hash route, and draws the bottom navigation bar.
 *
 *   main.ts ──startApp──▶ render() ◀── hashchange
 *                           ├─ <main> Today | Settings screen
 *                           └─ <nav>  Today | History (disabled) | Settings
 *
 * Optional `?date=YYYY-MM-DD` in the page URL overrides "today" (used by E2E
 * tests, and by Ed to preview another day).
 */

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
): void {
  let settings = initialSettings;
  let warningsDismissed = false;

  /** Dismiss handler for the warning banner: remembers it for this page load and re-renders. */
  function handleDismissWarnings(): void {
    warningsDismissed = true;
    render();
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
   * re-renders Today. A storage failure is shown as the usual error card.
   */
  function handleStartToday(): void {
    const today = resolveToday(window.location.search);
    const failureMessage = persistSettings({ ...settings, startDate: today });
    if (failureMessage !== null) {
      showStartupError(root, new Error(failureMessage));
      return;
    }

    settings = { ...settings, startDate: today };
    render();
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
      main.append(
        route === "settings"
          ? renderSettingsScreen(program, settings, handleSave)
          : renderTodayScreen(program, settings, resolveToday(window.location.search), handleStartToday),
      );
      root.replaceChildren(main, renderNavigationBar(route));
    } catch (error) {
      // A throwing render (e.g. a program gap hit on one date) must not leave
      // a blank screen: show the same readable card as a startup failure.
      showStartupError(root, error);
    }
  }

  window.addEventListener("hashchange", render);
  render();
}

/** Bottom nav: Today, History (disabled placeholder) and Settings. */
function renderNavigationBar(activeRoute: Route): HTMLElement {
  const nav = element("nav", "bottom-nav");
  nav.setAttribute("aria-label", "Main");

  const todayLink = navigationLink("◉", "Today", "#/today", activeRoute === "today");

  const history = element("span", "nav-item nav-item-disabled");
  history.setAttribute("aria-disabled", "true");
  history.append(element("i", undefined, "▤"), "History", element("small", undefined, "coming later"));

  const settingsLink = navigationLink("⚙", "Settings", "#/settings", activeRoute === "settings");

  nav.append(todayLink, history, settingsLink);
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
