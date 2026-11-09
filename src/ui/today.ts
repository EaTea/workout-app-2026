import type { Program, Range } from "../program/model";
import { buildSession, type BlockView, type ItemView, type SessionView } from "../program/schedule";
import type { TrainingSettings } from "../settings/model";
import { createCuePlayer } from "../timer/cues";
import { buildEmomPlan, buildIntervalPlan, defaultIntervalSettings, INTERVAL_LIMITS } from "../timer/plans";
import { element } from "./dom";
import { countSetsForItem, formatProgress } from "../log/itemSets";
import type { WorkoutLog } from "../log/model";
import { setsForItem } from "../log/operations";
import { lastTimeHint } from "./lastTimeHint";
import { logRouteHash } from "./router";
import { restMemoryKey } from "./restMemory";
import { currentRestSeconds, openRestTimer } from "./restTimer";
import { openTimer } from "./timerView";
import { formatBlockTitle, formatItemDetails, formatItemDose, formatSessionKicker, formatShortDate, isAwaitingRetest } from "./format";

/**
 * The Today screen. Rendered by app.ts for `#/today`.
 *
 *   buildSession(...) ─▶ SessionView
 *        training  ─▶ header, phase strip, deload note, one card per block
 *                       └ item row (button) ─▶ log screen (#/log/...), which has the details sheet
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
  log: WorkoutLog = { sessions: {} },
): HTMLElement {
  const screen = element("section", "screen");
  const session = buildSession(program, settings, date);

  switch (session.kind) {
    case "training":
      screen.append(...renderTrainingDay(program, session, date, log));
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
  log: WorkoutLog,
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

  session.blocks.forEach((block, index) => parts.push(renderBlockCard(block, index + 1, date, log)));
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
function renderBlockCard(block: BlockView, position: number, date: string, log: WorkoutLog): HTMLElement {
  const card = element("section", "card block-card");
  card.append(element("h2", "block-title", formatBlockTitle(position, block)));

  // Supersets rest between pairs, so the rest button belongs to the block rather than to one row.
  if (block.restSecBetweenPairs) {
    const restRow = element("div", "block-rest");
    restRow.append(renderStartRestButton(
      block.restSecBetweenPairs,
      "Between pairs",
      restMemoryKey(date, position, "between-pairs"),
      undefined,
      " between pairs",
    ));
    card.append(restRow);
  }

  for (const item of block.items) {
    card.append(renderItemRow(item, block, date, position, log));
  }
  return card;
}

/**
 * One exercise row. The name/details/dose are a single button that opens the
 * item's log screen (the details sheet is behind the ⓘ button there), with
 * logging progress ("2/6", "✓ 6/6") under the details once a set is logged, then the muted
 * "Last time (2 Nov): ..." line when the exercise has been logged before (not on warm-ups). When the dose needs a max, the dose is a separate link to
 * Settings instead (a link can't live inside a button).
 */
function renderItemRow(item: ItemView, block: BlockView, date: string, blockPosition: number, log: WorkoutLog): HTMLElement {
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
  const progress = formatProgress(setsForItem(log, date, blockPosition, item.exercise.id).length, countSetsForItem(item, block));
  if (progress !== undefined) {
    text.append(element("span", "item-progress", progress));
  }
  const lastTimeText = lastTimeHint(log, item, block, date);
  if (lastTimeText !== undefined) {
    text.append(element("span", "item-last-time", lastTimeText));
  }
  openButton.append(text);

  row.append(openButton);

  if (dose.needsMaxExerciseId !== undefined) {
    const link = element("a", "item-dose item-dose-link", dose.text);
    link.href = "#/settings";
    link.setAttribute("aria-label", `Set max for ${item.exercise.name}`);
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
    updateLink.setAttribute("aria-label", `Update max for ${item.exercise.name}`);
    row.append(updateLink);
  }

  // EMOM items get their own Start button, a sibling so the row button keeps opening the log screen.
  if (item.format === "emom" && item.minutes !== undefined) {
    row.append(renderStartEmomButton(item));
  }

  // Straight-set items with a prescribed rest get a rest button, tapped after each set.
  if (item.format !== "interval" && item.restSec) {
    row.append(renderStartRestButton(item.restSec, item.exercise.name, restMemoryKey(date, blockPosition, item.exercise.id), item.exercise.name));
  }

  // Heavy bag intervals likewise.
  if (item.format === "interval" && item.rounds && item.workSec && item.restSec) {
    row.append(renderStartIntervalButton(item));
  }

  openButton.addEventListener("click", () => {
    window.location.hash = logRouteHash(blockPosition, item.exercise.id);
  });
  return row;
}

/**
 * "Start EMOM" button for an EMOM row. Opens the full-screen timer for the
 * item (timer/plans.ts) with beeps and vibration (timer/cues.ts) wired in;
 * the audio is unlocked/resumed on every tap inside the timer.
 */
function renderStartEmomButton(item: ItemView): HTMLButtonElement {
  const button = element("button", "item-start", "Start EMOM");
  button.type = "button";
  // The visible text comes first in the accessible name (WCAG 2.5.3 label in name).
  button.setAttribute("aria-label", `Start EMOM, ${item.exercise.name}`);

  button.addEventListener("click", () => {
    const cues = createCuePlayer();
    openTimer(buildEmomPlan(item), {
      dialogName: `${item.exercise.name} EMOM timer`,
      onUserTap: () => cues.prime(),
      onEvents: (events) => cues.handleEvents(events),
      onSecondTick: (remainingSec) => cues.handleSecond(remainingSec),
    });
  });
  return button;
}

/**
 * "Start timer" button for an interval row (the heavy bag finisher). Opens the
 * timer with a setup row so Ed can change work, rest and rounds before
 * starting; every change rebuilds the plan through buildIntervalPlan.
 */
function renderStartIntervalButton(item: ItemView): HTMLButtonElement {
  const button = element("button", "item-start", "Start timer");
  button.type = "button";
  button.setAttribute("aria-label", `Start timer, ${item.exercise.name}`);

  button.addEventListener("click", () => {
    const defaults = defaultIntervalSettings(item);
    const cues = createCuePlayer();
    const { minRounds, maxRounds, minSeconds, maxWorkSec, maxRestSec, secondsStep } = INTERVAL_LIMITS;

    openTimer(buildIntervalPlan(item, defaults), {
      dialogName: "Heavy bag timer",
      onUserTap: () => cues.prime(),
      onEvents: (events) => cues.handleEvents(events),
      onSecondTick: (remainingSec) => cues.handleSecond(remainingSec),
      setup: {
        fields: [
          {
            id: "workSec", label: "work", value: defaults.workSec,
            min: minSeconds, max: maxWorkSec, step: secondsStep,
            format: (value) => `Work ${value}s`,
          },
          {
            id: "restSec", label: "rest", value: defaults.restSec,
            min: minSeconds, max: maxRestSec, step: secondsStep,
            format: (value) => `Rest ${value}s`,
          },
          {
            id: "rounds", label: "rounds", value: defaults.rounds,
            min: minRounds, max: maxRounds, step: 1,
            format: (value) => (value === 1 ? "1 round" : `${value} rounds`),
          },
        ],
        rebuildPlan: (values) =>
          buildIntervalPlan(item, {
            rounds: values.rounds ?? defaults.rounds,
            workSec: values.workSec ?? defaults.workSec,
            restSec: values.restSec ?? defaults.restSec,
          }),
      },
    });
  });
  return button;
}

/**
 * "Rest 30s" button: opens a one-segment rest timer (timer/plans.ts) that
 * starts at the low end of `range` and can be raised before Start. Used by
 * item rows (`restSec`) and by superset blocks (`restSecBetweenPairs`). With
 * no set logging yet, this button is how a rest begins; it can be tapped
 * again after every set. The timer's finish cue tells Ed to begin the next set.
 *
 * A rest that Ed adjusted with the stepper and then started is remembered for
 * the rest of the page load (restMemory.ts, under `memoryKey`): the next open
 * defaults to it, and when the timer closes the button's own text and
 * accessible name are updated in place (no Today re-render, so scroll and
 * focus stay put). A fresh render reads the remembered value too.
 *
 * The visible text is "Rest 30s" plus an optional `visibleSuffix` (the
 * between-pairs button says "Rest 45s between pairs" since no exercise row
 * names it). `accessibleContext`, when given, is appended to the visible text
 * for the accessible name ("Rest 30s, Med ball slams"), so the visible label
 * stays at the start of the name (WCAG 2.5.3); without it the visible text is
 * the name.
 */
function renderStartRestButton(
  range: Range,
  restName: string,
  memoryKey: string,
  accessibleContext?: string,
  visibleSuffix = "",
): HTMLButtonElement {
  const button = element("button", "item-start");
  button.type = "button";

  /** Writes the label for `seconds` into the button's text and accessible name. */
  function showSeconds(seconds: number): void {
    const visibleText = `Rest ${seconds}s${visibleSuffix}`;
    button.textContent = visibleText;
    if (accessibleContext) button.setAttribute("aria-label", `${visibleText}, ${accessibleContext}`);
  }
  showSeconds(currentRestSeconds(range, memoryKey));

  button.addEventListener("click", () => {
    openRestTimer(range, restName, memoryKey, () => showSeconds(currentRestSeconds(range, memoryKey)));
  });
  return button;
}
