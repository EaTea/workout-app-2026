import type { CallToAction, DayOverview, PhaseOverview, ProgramOverview } from "../program/overview";
import { element } from "./dom";
import { blockLabel, formatOverviewHeadline, formatShortDate, formatWeekRange } from "./format";
import "./overview.css";

/**
 * The Overview (welcome) screen, rendered by app.ts for `#/overview` and, on a
 * first visit with no start date, in place of Today.
 *
 *   buildProgramOverview(...) ─▶ ProgramOverview ─▶ renderOverviewScreen
 *      kicker (program name) · h1 · goal · headline numbers
 *      "The 8 weeks"      week strip + one line per phase
 *      "A typical week"   Day 1 to 7 rows
 *      "Every session"    block order as labels
 *      call to action     the ONE primary button or link (by `callToAction.kind`)
 *
 * It only draws the view model; every number and name comes from program.json
 * through `src/program/overview.ts`. No weekday names appear (PLAN.md rule 1).
 */

/** What the Overview needs from app.ts beyond the view model. */
export interface OverviewOptions {
  /** The page's `location.search`, so links to Today keep a `?date=` preview. */
  search: string;

  /** The first-run "Start Day 1" button was tapped; app.ts saves the start date and shows Today. */
  onStartToday: () => void;

  /** Set when saving the start date failed; shown inline as an alert under the button. */
  startTodayFailureMessage?: string;
}

/**
 * Link to Today that keeps the current query string (so a `?date=` preview
 * survives). Used by the "Go to today" call to action.
 */
export function todayHref(search: string): string {
  return `${search}#/today`;
}

/**
 * Link to Today previewing the program's first day: the query string with its
 * `date` replaced by (or set to) `startsOn`. Starts with "?" so the browser
 * keeps the current path. Used by the "Preview Day 1" call to action.
 */
export function previewFirstDayHref(search: string, startsOn: string): string {
  const params = new URLSearchParams(search);
  params.set("date", startsOn);

  return `?${params.toString()}#/today`;
}

/**
 * A small "Program overview" text link to `#/overview` (hash-only, so a
 * `?date=` preview in the query string survives). Shown on Today's header and
 * message cards and at the top of Settings, so the Overview stays one tap away
 * once the first-run redirect no longer shows it.
 */
export function renderProgramOverviewLink(): HTMLAnchorElement {
  const link = element("a", "overview-link", "Program overview");
  link.href = "#/overview";
  return link;
}

/**
 * Builds the Overview screen from its view model. See the file comment for the
 * layout. The h1 is the screen's main heading, so `focusMainHeading` (used by
 * app.ts after actions) lands on it just as it does on Today.
 */
export function renderOverviewScreen(overview: ProgramOverview, options: OverviewOptions): HTMLElement {
  const screen = element("section", "screen overview");

  const header = element("header", "overview-header");
  header.append(
    element("div", "kicker", overview.name),
    element("h1", "today-title", "Program overview"),
    element("p", "overview-goal", overview.goal),
    element("p", "overview-headline", formatOverviewHeadline(overview.lengthWeeks, overview.trainingDaysPerWeek, overview.weeklyMinutes)),
  );

  screen.append(
    header,
    renderPhasesSection(overview),
    renderTypicalWeekSection(overview.days),
    renderSessionOrderSection(overview.sessionOrder),
    renderCallToAction(overview.callToAction, options),
  );

  return screen;
}

/** A titled card; the title is an h2 so the screen has a clean heading outline under the h1. */
function renderSection(title: string): HTMLElement {
  const section = element("section", "card overview-section");
  section.append(element("h2", "overview-section-title", title));
  return section;
}

/**
 * "The 8 weeks": a strip with one cell per week (the current week highlighted
 * while the program is active), then one line per phase with its week range,
 * name and first change. The current phase is highlighted too.
 */
function renderPhasesSection(overview: ProgramOverview): HTMLElement {
  const section = renderSection(`The ${overview.lengthWeeks} weeks`);

  const strip = element("ol", "overview-weeks");
  for (let week = 1; week <= overview.lengthWeeks; week++) {
    const cell = element("li", week === overview.currentWeek ? "overview-week overview-week-current" : "overview-week", String(week));
    if (week === overview.currentWeek) cell.setAttribute("aria-current", "true");
    strip.append(cell);
  }

  const phaseList = element("ul", "overview-phases");
  for (const phase of overview.phases) {
    phaseList.append(renderPhaseRow(phase));
  }

  section.append(strip, phaseList);
  return section;
}

/** One phase line: "Weeks 1–3 · Base" with its summary beneath; highlighted when it holds the current week. */
function renderPhaseRow(phase: PhaseOverview): HTMLElement {
  const row = element("li", phase.isCurrent ? "overview-phase overview-phase-current" : "overview-phase");
  row.append(element("div", "overview-phase-name", `${formatWeekRange(phase.firstWeek, phase.lastWeek)} · ${phase.name}`));
  if (phase.summary !== "") {
    row.append(element("div", "overview-phase-summary", phase.summary));
  }
  return row;
}

/** "A typical week": one row per day number, in order. */
function renderTypicalWeekSection(days: DayOverview[]): HTMLElement {
  const section = renderSection("A typical week");

  const list = element("ol", "overview-days");
  for (const day of days) {
    list.append(renderDayRow(day));
  }

  section.append(list);
  return section;
}

/**
 * One day row. Training days show the focus, "~50 min" and the key exercises
 * joined with " · "; a rest day shows "Rest" in muted text.
 */
function renderDayRow(day: DayOverview): HTMLElement {
  const row = element("li", day.kind === "rest" ? "overview-day overview-day-rest" : "overview-day");
  row.append(element("span", "overview-day-number", `Day ${day.dayNumber}`));

  if (day.kind === "rest") {
    row.append(element("span", "overview-day-focus", "Rest"));
    return row;
  }

  row.append(element("span", "overview-day-focus", day.focus), element("span", "overview-day-minutes", `~${day.targetMinutes} min`));
  if (day.keyExercises.length > 0) {
    row.append(element("span", "overview-day-exercises", day.keyExercises.join(" · ")));
  }
  return row;
}

/** "Every session": the block order as friendly labels, e.g. "Warm-up → Explosive → Main strength". */
function renderSessionOrderSection(sessionOrder: string[]): HTMLElement {
  const section = renderSection("Every session");
  section.append(element("p", "overview-session-order", sessionOrder.map(blockLabel).join(" → ")));
  return section;
}

/**
 * The single primary call to action, in a bar that stays pinned just above the
 * bottom nav (see `.overview-cta` in overview.css) so it is on the first screen
 * of a phone without scrolling. It changes with where the program stands (see
 * `CallToAction`):
 *   startToday       a button (saves the start date via app.ts) plus a Settings text link
 *   previewFirstDay  "Program starts 16 Nov" text plus a link previewing Day 1
 *   goToToday        a link to Today
 *   setNewStartDate  a link to Settings
 */
function renderCallToAction(callToAction: CallToAction, options: OverviewOptions): HTMLElement {
  const area = element("div", "overview-cta");

  switch (callToAction.kind) {
    case "startToday": {
      const button = element("button", "primary-button", callToAction.label);
      button.type = "button";
      button.addEventListener("click", options.onStartToday);
      area.append(button);

      // The failure alert lives in the pinned bar so it is seen next to the button.
      if (options.startTodayFailureMessage !== undefined) {
        const alert = element("p", "field-error", options.startTodayFailureMessage);
        alert.setAttribute("role", "alert");
        area.append(alert);
      }

      const settingsLink = element("a", "text-link", "Or pick another start date in Settings");
      settingsLink.href = "#/settings";
      area.append(settingsLink);
      break;
    }

    case "previewFirstDay": {
      area.append(element("p", "overview-starts-on", `Program starts ${formatShortDate(callToAction.startsOn)}`));
      area.append(primaryLink(callToAction.label, previewFirstDayHref(options.search, callToAction.startsOn)));
      break;
    }

    case "goToToday":
      area.append(primaryLink(callToAction.label, todayHref(options.search)));
      break;

    case "setNewStartDate":
      area.append(primaryLink(callToAction.label, "#/settings"));
      break;
  }

  return area;
}

/** A link styled as the big blue button. */
function primaryLink(label: string, href: string): HTMLAnchorElement {
  const link = element("a", "primary-button", label);
  link.href = href;
  return link;
}
