import type { Program } from "../program/model";
import { buildSession, type BlockView, type ItemView, type SessionView } from "../program/schedule";
import type { TrainingSettings } from "../settings/model";
import { element } from "./dom";
import { openExerciseSheet } from "./exerciseSheet";
import { formatBlockTitle, formatItemDetails, formatItemDose, formatSessionKicker, formatShortDate, isAwaitingRetest } from "./format";

/**
 * The Today screen. Rendered by app.ts for `#/today`.
 *
 *   buildSession(...) ─▶ SessionView
 *        training  ─▶ header, phase strip, deload note, one card per block
 *                       └ item row (button) ─▶ exerciseSheet
 *        rest / notStarted / complete / noStartDate ─▶ a single message card
 *
 * It renders exactly what `buildSession` returns; all numbers are final.
 */

/**
 * Builds the Today screen for `date` ("YYYY-MM-DD"). `onStartToday` is called
 * when Ed taps "Start today" on the first-run card; app.ts saves `date` as the
 * start date and re-renders. `startTodayFailureMessage`, if given, is shown
 * as an inline alert on that card (the save failed).
 */
export function renderTodayScreen(
  program: Program,
  settings: TrainingSettings,
  date: string,
  onStartToday: () => void = () => undefined,
  startTodayFailureMessage?: string,
): HTMLElement {
  const screen = element("section", "screen");
  const session = buildSession(program, settings, date);

  switch (session.kind) {
    case "training":
      screen.append(...renderTrainingDay(program, session, date));
      break;
    default:
      screen.append(renderMessageCard(session, program.lengthWeeks, date, onStartToday, startTodayFailureMessage));
  }

  return screen;
}

/** A single card for sessions with nothing to train: first run, not started, rest day, finished. */
function renderMessageCard(
  session: Exclude<SessionView, { kind: "training" }>,
  lengthWeeks: number,
  date: string,
  onStartToday: () => void,
  startTodayFailureMessage?: string,
): HTMLElement {
  const card = element("div", "card message-card");

  switch (session.kind) {
    case "noStartDate":
      card.append(
        element("h2", "card-title", "Welcome"),
        element("p", undefined, "Set your program start date to see today's session."),
        startTodayButton(onStartToday),
      );
      if (startTodayFailureMessage !== undefined) {
        const alert = element("p", "field-error", startTodayFailureMessage);
        alert.setAttribute("role", "alert");
        card.append(alert);
      }
      card.append(settingsLink("Or set a different date in Settings"));
      break;

    case "notStarted":
      card.append(
        element("h2", "card-title", `Program starts ${formatShortDate(session.startsOn)}`),
        element("p", undefined, "Nothing to do yet. Rest up, the first session is coming."),
      );
      break;

    case "rest":
      card.append(
        element("div", "kicker", formatSessionKicker(date, session.week, lengthWeeks, session.dayNumber)),
        element("h2", "card-title", "Rest day"),
        element("p", undefined, `Week ${session.week} · ${session.phase}. Recover today; no training is planned.`),
      );
      break;

    case "complete":
      card.append(
        element("h2", "card-title", "Program complete"),
        element("p", undefined, "You finished all the weeks. To start another round, set a new start date."),
        settingsButton("Set a new start date"),
      );
      break;
  }

  return card;
}

/** Big primary button on the first-run card: begin the program with today as day 1. */
function startTodayButton(onStartToday: () => void): HTMLButtonElement {
  const button = element("button", "primary-button", "Start today");
  button.type = "button";
  button.addEventListener("click", onStartToday);
  return button;
}

/** Plain text link to Settings, used beside "Start today" for picking another date. */
function settingsLink(label: string): HTMLAnchorElement {
  const link = element("a", "text-link", label);
  link.href = "#/settings";
  return link;
}

/** Link styled as the big blue button, pointing at Settings. */
function settingsButton(label: string): HTMLAnchorElement {
  const link = element("a", "primary-button", label);
  link.href = "#/settings";
  return link;
}

/** Everything for a training day, in display order. */
function renderTrainingDay(
  program: Program,
  session: Extract<SessionView, { kind: "training" }>,
  date: string,
): HTMLElement[] {
  const header = element("header", "today-header");
  header.append(
    element("div", "kicker", formatSessionKicker(date, session.week, program.lengthWeeks, session.dayNumber)),
    element("h1", "today-title", session.focus),
    element("div", "today-subtitle", `~${session.targetMinutes} min · ${session.blocks.length} blocks`),
  );

  const parts: HTMLElement[] = [header, renderPhaseStrip(program, session.phase, session.isDeload)];

  if (session.isDeload) {
    const note = element("div", "deload-note", "Deload week: sets halved");
    note.setAttribute("role", "note");
    parts.push(note);
  }

  session.blocks.forEach((block, index) => parts.push(renderBlockCard(block, index + 1)));
  return parts;
}

/**
 * Phase pill plus its first change; tapping expands every change listed for
 * the phase in program.progression. Uses <details> so it is keyboard and
 * screen-reader friendly without extra script.
 */
function renderPhaseStrip(program: Program, phaseName: string, isDeload: boolean): HTMLElement {
  const changes = program.progression.find((entry) => entry.phase === phaseName)?.changes ?? [];

  const details = element("details", "phase-strip");
  const summary = element("summary", "phase-summary");
  summary.append(
    element("span", isDeload ? "pill pill-warn" : "pill", phaseName.toUpperCase()),
    element("span", "phase-first-change", changes[0] ?? ""),
    element("span", "phase-chevron", "›"),
  );
  details.append(summary);

  if (changes.length > 0) {
    const list = element("ul", "phase-changes");
    for (const change of changes) {
      list.append(element("li", undefined, change));
    }
    details.append(list);
  }

  return details;
}

/** One card for a block: numbered title, then one row per item. */
function renderBlockCard(block: BlockView, position: number): HTMLElement {
  const card = element("section", "card block-card");
  card.append(element("h2", "block-title", formatBlockTitle(position, block)));

  for (const item of block.items) {
    card.append(renderItemRow(item));
  }
  return card;
}

/**
 * One exercise row. The name/details/dose are a single button that opens the
 * details sheet. When the dose needs a max, the dose is a separate link to
 * Settings instead (a link can't live inside a button).
 */
function renderItemRow(item: ItemView): HTMLElement {
  const row = element("div", "item-row");
  const dose = formatItemDose(item);

  const openButton = element("button", "item-open");
  openButton.type = "button";

  const text = element("span", "item-text");
  text.append(element("span", "item-name", item.exercise.name));
  const details = formatItemDetails(item);
  if (details.length > 0) {
    text.append(element("span", "item-details", details.join(" · ")));
  }
  openButton.append(text);

  row.append(openButton);

  if (dose.needsMaxExerciseId !== undefined) {
    const link = element("a", "item-dose item-dose-link", dose.text);
    link.href = "#/settings";
    row.append(link);
  } else {
    const doseBox = element("span", "item-dose");
    doseBox.append(element("span", "item-dose-main", dose.text));
    if (dose.subtext) {
      doseBox.append(element("span", "item-dose-sub", dose.subtext));
    }
    openButton.append(doseBox);
  }

  // Retest week, no max saved yet: offer a direct route to the max setting.
  // A sibling link (not inside the button), like "Set max" above.
  if (isAwaitingRetest(item)) {
    const updateLink = element("a", "item-dose item-dose-link", "Update max");
    updateLink.href = "#/settings";
    row.append(updateLink);
  }

  openButton.addEventListener("click", () => openExerciseSheet(item, openButton));
  return row;
}
