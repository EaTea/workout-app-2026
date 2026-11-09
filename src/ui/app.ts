import type { Program } from "../program/model";
import { toDayNumber, todayLocalDate } from "../program/calendar";
import { buildSession, type SessionView } from "../program/schedule";
import type { TrainingSettings } from "../settings/model";
import { saveSettings } from "../settings/storage";
import { element } from "./dom";
import { navigateTo, routeFromHash, type Route } from "./router";
import { renderSettingsScreen } from "./settings";

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

/**
 * One-line description of a session for the interim Today card (step 5
 * replaces this with the real screen), e.g. "Week 2 · Mon · Base".
 */
export function describeSession(session: SessionView): string {
  switch (session.kind) {
    case "training":
      return `Week ${session.week} · ${session.weekday} · ${session.phase}`;
    case "rest":
      return `Week ${session.week} · Rest day · ${session.phase}`;
    case "notStarted":
      return `Program starts on ${session.startsOn}`;
    case "complete":
      return "Program complete";
    case "noStartDate":
      return "No start date set";
  }
}

/**
 * Shows the app inside `root`. Re-renders on every hash change; settings
 * edits go through `saveSettings`, update the in-memory copy and return to Today.
 */
export function startApp(root: HTMLElement, program: Program, initialSettings: TrainingSettings): void {
  let settings = initialSettings;

  function handleSave(newSettings: TrainingSettings): void {
    saveSettings(newSettings);
    settings = newSettings;
    navigateTo("today");
    showSavedToast();
  }

  function render(): void {
    const route = routeFromHash(window.location.hash);
    const main = element("main", "app-main");
    main.append(
      route === "settings"
        ? renderSettingsScreen(program, settings, handleSave)
        : renderTodayScreen(program, settings),
    );
    root.replaceChildren(main, renderNavigationBar(route));
  }

  window.addEventListener("hashchange", render);
  render();
}

/** Interim Today screen: a first-run prompt, or the session kind and week. */
function renderTodayScreen(program: Program, settings: TrainingSettings): HTMLElement {
  const screen = element("section", "screen");
  screen.append(element("h1", "screen-title", "Today"));

  const card = element("div", "card");
  if (settings.startDate === null) {
    card.append(
      element("h2", "card-title", "Welcome"),
      element("p", undefined, "Set your program start date to see today's session."),
    );
    const link = element("a", "primary-button", "Go to Settings");
    link.href = "#/settings";
    card.append(link);
  } else {
    const today = resolveToday(window.location.search);
    card.append(element("p", "session-summary", describeSession(buildSession(program, settings, today))));
  }

  screen.append(card);
  return screen;
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

/** Replaces the app with a readable error card (e.g. program.json failed to parse). */
export function showStartupError(root: HTMLElement, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const card = element("div", "card error-card");
  card.setAttribute("role", "alert");
  card.append(element("h2", "card-title", "Could not load the program"), element("pre", "error-message", message));

  const main = element("main", "app-main");
  main.append(card);
  root.replaceChildren(main);
}
