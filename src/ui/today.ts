import type { Program, Range } from "../program/model";
import { buildSession, type BlockView, type ItemView, type SessionView } from "../program/schedule";
import type { TrainingSettings } from "../settings/model";
import { createCuePlayer } from "../timer/cues";
import { buildEmomPlan, buildIntervalPlan, defaultIntervalSettings, INTERVAL_LIMITS, shortExerciseName } from "../timer/plans";
import { element } from "./dom";
import { retestExercisesToSave, shouldOfferJumpOnly } from "./retest";
import "./rotation.css";
import { itemDisplayName, rotationBlockStartWeek } from "../program/rotation";
import { renderRotationCard } from "./rotationCard";
import { renderRetestCard, type RetestCardActions } from "./retestCard";
import { checkInWeekToAsk, trainingWeekOf, type CheckInDraft } from "./checkin";
import { weeklyChecksFor } from "../fatigue/operations";
import { renderCheckInCard } from "./checkinCard";
import type { FatigueHistory } from "../fatigue/model";
import { countSetsForItem, formatProgress } from "../log/itemSets";
import type { WorkoutLog } from "../log/model";
import { setsForItem } from "../log/operations";
import { lastTimeHint } from "./lastTimeHint";
import { logRouteHash } from "./router";
import { restMemoryKey } from "./restMemory";
import { currentRestSeconds, openRestTimer } from "./restTimer";
import { openTimer } from "./timerView";
import { formatBlockTitle, formatItemDetails, formatItemDose, formatSessionKicker, formatTimerAdjustment, formatShortDate, isAwaitingRetest } from "./format";

/**
 * The Today screen. Rendered by app.ts for `#/today`.
 *
 *   buildSession(...) ─▶ SessionView
 *        training  ─▶ header, phase strip, deload note, one card per block
 *                       └ item row (button) ─▶ log screen (#/log/<date>/..., pinned to the date shown), which has the details sheet
 *        rest / notStarted / complete / noStartDate ─▶ a single message card
 *
 * It renders exactly what `buildSession` returns; all numbers are final. On
 * a retest-week training day a "Retest week" card (retestCard.ts) goes above
 * the header while a max is still to be saved and it was not dismissed. On
 * any other training day, until that week's check is saved or snoozed for the
 * day, a "Weekly check-in" card (checkinCard.ts) sits in the same place
 * (below the retest card, though the two never show together).
 */

/** What Today needs to show the retest card; supplied by app.ts, which owns the saving and dismissal. */
export interface RetestOptions {
  /** The date "Not today" was tapped for, or undefined. */
  dismissedDate: string | undefined;
  actions: RetestCardActions;

  /** Saved fatigue checks: the retest card's broad jump field shows "Best recent" and what is already saved for the week. */
  history: FatigueHistory;

  /** First date of the retest week whose jump was skipped with "Skip jump", or undefined. */
  jumpSkippedWeekStart: string | undefined;
}

/** What Today needs to show the warm-up rotation card; supplied by app.ts, which owns the dismissal. */
export interface RotationOptions {
  /** First weeks of the rotation blocks whose card was dismissed. */
  dismissedBlockWeeks: number[];

  /** False in a `?date=` preview: "Got it" is disabled. */
  canDismiss: boolean;
  onDismiss: () => void;
}

/** What Today needs to show the weekly check-in card; supplied by app.ts, which owns the saving and snoozing. */
export interface CheckInOptions {
  /** Saved checks, for "due this week?" and the "Best recent" values. */
  history: FatigueHistory;

  /** The date "Remind me tomorrow" was tapped on, or undefined. */
  snoozedDate: string | undefined;

  /** False in a `?date=` preview (shown date is not the real today): the card cannot save. */
  canSave: boolean;

  /** The program's `fatigueCheck.rule` text, shown in the drop warning. */
  ruleText: string;

  /** Returns the unsaved values for a week, creating a blank draft the first time (app.ts keeps it across re-renders). */
  draftForWeek: (week: number) => CheckInDraft;

  /** Saves the check-in (blank fields left out); returns null on success or a message to show inline. */
  onSave: (values: { broadJumpMetres?: number; maxPullUps?: number }) => string | null;

  /** "Remind me tomorrow" tapped; app.ts remembers the date and re-renders. */
  onSnooze: () => void;
}

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
  retest?: RetestOptions,
  checkIn?: CheckInOptions,
  rotation?: RotationOptions,
): HTMLElement {
  const screen = element("section", "screen");
  const session = buildSession(program, settings, date);

  switch (session.kind) {
    case "training":
      if (retest !== undefined) {
        const exercisesToRetest = retestExercisesToSave(program, settings, date, retest.dismissedDate);
        const jumpOnly = exercisesToRetest.length === 0
          && shouldOfferJumpOnly(program, settings, date, retest.dismissedDate, retest.history, retest.jumpSkippedWeekStart);
        if (exercisesToRetest.length > 0 || jumpOnly) {
          screen.append(renderRetestCard(exercisesToRetest, settings, retest.actions, {
            week: trainingWeekOf(program, settings, date) ?? 0,
            history: weeklyChecksFor(retest.history, settings.startDate, program.lengthWeeks),
          }));
        }
      }
      if (checkIn !== undefined) {
        const weekToAsk = checkInWeekToAsk(program, settings, date, checkIn.history, checkIn.snoozedDate);
        if (weekToAsk !== undefined) {
          screen.append(renderCheckInCard(weekToAsk, weeklyChecksFor(checkIn.history, settings.startDate, program.lengthWeeks), checkIn.ruleText, {
            draft: checkIn.draftForWeek(weekToAsk),
            canSave: checkIn.canSave,
            onSave: checkIn.onSave,
            onSnooze: checkIn.onSnooze,
          }));
        }
      }
      if (rotation !== undefined) {
        // Shown on every training day of a swapped block until that block is dismissed.
        const blockStartWeek = rotationBlockStartWeek(program, session);
        if (blockStartWeek !== undefined && !rotation.dismissedBlockWeeks.includes(blockStartWeek)) {
          screen.append(renderRotationCard(describeSwaps(program), program.warmupRotation, rotation.onDismiss, rotation.canDismiss));
        }
      }
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

  session.blocks.forEach((block, index) => parts.push(renderBlockCard(program, block, index + 1, session.dayNumber, session.phase, date, log)));
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

/** The row line for a `sameEveryWeek` item in a week where other items change (styled like the timer-adjustment lines). */
const SAME_EVERY_WEEK_TEXT = "Same every week";

/**
 * One card for a block: numbered title, then one row per item. `phase` names
 * the progression phase for the timer-adjustment lines.
 */
function renderBlockCard(program: Program, block: BlockView, position: number, dayNumber: number, phase: string, date: string, log: WorkoutLog): HTMLElement {
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

    // Say why the rest differs from the base program (power endurance weeks).
    if (block.restAdjustment !== undefined) {
      card.append(element("p", "timer-adjustment", formatTimerAdjustment(phase, block.restAdjustment, "rest")));
    }
  }

  for (const item of block.items) {
    card.append(renderItemRow(program, item, block, dayNumber, phase, date, position, log));
  }
  return card;
}

/**
 * "<original name> → <new name>" for each swap of the warm-up rotation, for
 * the rotation card; falls back to the exercise id if the library lacks it.
 */
function describeSwaps(program: Program): string[] {
  return program.warmupRotation.swaps.map((swap) => `${program.exercises[swap.out]?.name ?? swap.out} → ${swap.in}`);
}

/**
 * One exercise row. The name/details/dose are a single button that opens the
 * item's log screen (the details sheet is behind the ⓘ button there), with
 * logging progress ("2/6", "✓ 6/6") under the details once a set is logged, then the muted
 * "Last time (2 Nov): ..." line when the exercise has been logged before (not on warm-ups). When the dose needs a max, the dose is a separate link to
 * Settings instead (a link can't live inside a button).
 */
function renderItemRow(program: Program, item: ItemView, block: BlockView, dayNumber: number, phase: string, date: string, blockPosition: number, log: WorkoutLog): HTMLElement {
  const row = element("div", "item-row");
  const dose = formatItemDose(item);

  const openButton = element("button", "item-open");
  openButton.type = "button";

  const text = element("span", "item-text");
  text.append(element("span", "item-name", itemDisplayName(item)));
  if (item.rotatedIn !== undefined) {
    text.append(element("span", "item-rotated-in", `Rotated in for ${item.rotatedIn.originalName}`));
  }
  const details = formatItemDetails(item);
  if (details.length > 0) {
    text.append(element("span", "item-details", details.join(" · ")));
  }
  // The phase's work-time adjustment, so the row's seconds and the timer's defaults are explained.
  if (item.workSecAdjustment !== undefined) {
    text.append(element("span", "timer-adjustment", formatTimerAdjustment(phase, item.workSecAdjustment, "work")));
  }
  // A sameEveryWeek item (the wall sit) in a week where other things change: say so, so it isn't mistaken for a missed adjustment.
  if (item.showsSameEveryWeekNote) {
    text.append(element("span", "timer-adjustment", SAME_EVERY_WEEK_TEXT));
  }
  const progress = formatProgress(setsForItem(log, date, blockPosition, item.exercise.id).length, countSetsForItem(item, block));
  if (progress !== undefined) {
    text.append(element("span", "item-progress", progress));
  }
  const lastTimeText = lastTimeHint(log, program, item, block, dayNumber, date);
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
    row.append(renderStartRestButton(item.restSec, itemDisplayName(item), restMemoryKey(date, blockPosition, item.exercise.id), itemDisplayName(item)));
  }

  // Heavy bag intervals likewise.
  if (item.format === "interval" && item.rounds && item.workSec && item.restSec) {
    row.append(renderStartIntervalButton(item));
  }


  openButton.addEventListener("click", () => {
    window.location.hash = logRouteHash(date, blockPosition, item.exercise.id);
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
  button.setAttribute("aria-label", `Start EMOM, ${itemDisplayName(item)}`);

  button.addEventListener("click", () => {
    const cues = createCuePlayer();
    openTimer(buildEmomPlan(item), {
      dialogName: `${itemDisplayName(item)} EMOM timer`,
      onUserTap: () => cues.prime(),
      onEvents: (events) => cues.handleEvents(events),
      onSecondTick: (remainingSec) => cues.handleSecond(remainingSec),
      cues,
    });
  });
  return button;
}

/**
 * "Start timer" button for an interval row (heavy bag, wall sit). Opens the
 * timer with a setup row so Ed can change work, rest and rounds before
 * starting; every change rebuilds the plan through buildIntervalPlan.
 */
function renderStartIntervalButton(item: ItemView): HTMLButtonElement {
  const button = element("button", "item-start", "Start timer");
  button.type = "button";
  button.setAttribute("aria-label", `Start timer, ${itemDisplayName(item)}`);

  button.addEventListener("click", () => {
    const defaults = defaultIntervalSettings(item);
    const cues = createCuePlayer();
    const { minRounds, maxRounds, minSeconds, maxWorkSec, maxRestSec, secondsStep } = INTERVAL_LIMITS;

    openTimer(buildIntervalPlan(item, defaults), {
      dialogName: `${shortExerciseName(itemDisplayName(item))} timer`, // "Heavy bag timer", "Wall sit timer"
      onUserTap: () => cues.prime(),
      onEvents: (events) => cues.handleEvents(events),
      onSecondTick: (remainingSec) => cues.handleSecond(remainingSec),
      cues,
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
    openRestTimer(range, restName, memoryKey, { onClose: () => showSeconds(currentRestSeconds(range, memoryKey)) });
  });
  return button;
}
