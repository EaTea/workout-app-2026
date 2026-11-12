import type { Program, Range, WarmupRotation } from "../program/model";
import { type BlockView, type ItemView, type SessionView } from "../program/schedule";
import type { TrainingSettings } from "../settings/model";
import { createCuePlayer } from "../timer/cues";
import { buildEmomPlan, buildIntervalPlan, defaultIntervalSettings, INTERVAL_LIMITS, shortExerciseName } from "../timer/plans";
import { element } from "./dom";
import { retestExercisesToSave, shouldOfferJumpOnly } from "./retest";
import "./rotation.css";
import { renderProgramOverviewLink } from "./overview";
import { itemDisplayName, rotationBlockStartWeek } from "../program/rotation";
import { renderSafetyNotesLink } from "./safetyNotes";
import { renderRotationCard } from "./rotationCard";
import { renderRetestCard, type RetestCardActions } from "./retestCard";
import { checkInWeekToAsk, trainingWeekOf, type CheckInDraft } from "./checkin";
import { weeklyChecksFor } from "../fatigue/operations";
import { renderCheckInCard } from "./checkinCard";
import type { FatigueHistory } from "../fatigue/model";
import { countSetsForItem, formatProgress } from "../log/itemSets";
import type { WorkoutLog } from "../log/model";
import { setsForItem } from "../log/operations";
import { hasNoEquipmentSwap, noEquipmentItemKey, originalExerciseIdOf } from "../program/noEquipment";
import type { NoEquipmentTicks } from "../noEquipment/model";
import { buildSwappedSessionFor } from "../noEquipment/session";
import type { CombinesByDate } from "../combine/model";
import { type CombinedBlock, type CombinedSession, type TrainingSessionView } from "../program/combine";
import { activeDonorOn, combineOffersFor } from "../program/combineOffers";
import { programStatus, todayLocalDate } from "../program/calendar";
import { renderCombineOffers, renderDonorCard, renderUndoCombine, type CombineActions } from "./combineCards";
import { lastTimeHint } from "./lastTimeHint";
import { logRouteHash } from "./router";
import { restMemoryKey } from "./restMemory";
import { currentRestSeconds, openRestTimer } from "./restTimer";
import { openTimer } from "./timerView";
import { blockLabel, formatBlockTitle, formatCombinedSessionKicker, formatItemDetails, formatItemDose, formatSessionKicker, formatTimerAdjustment, formatShortDate, isAwaitingRetest } from "./format";

/**
 * The Today screen. Rendered by app.ts for `#/today`.
 *
 *   buildSession(...) ─▶ SessionView
 *        training  ─▶ header, phase strip, deload note, one card per block
 *                       └ item row (button) ─▶ log screen (#/log/<date>/..., pinned to the date shown), which has the details sheet
 *        rest / notStarted / complete ─▶ a single message card
 *        (noStartDate never reaches Today: app.ts shows the Overview instead)
 *        every screen carries a small "Program overview" link (#/overview)
 *
 * Two days can be merged into one session (PR 25): `buildSwappedSessionFor`
 * then returns a `CombinedSession`, whose rows each remember their own day and
 * block position (see `RowSlot`), and a donor date shows a "done with" card.
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

/** What Today needs to show the "No equipment" ticks; supplied by app.ts, which owns the stored ticks. */
export interface NoEquipmentOptions {
  /** All stored ticks (Today reads the shown date's). */
  ticks: NoEquipmentTicks;

  /** False on a future `?date=` preview, like logging: the tick is disabled. */
  canTick: boolean;

  /** Saves a tick for the shown date; returns null on success or a message to show on the row. */
  onToggle: (itemKey: string, ticked: boolean) => string | null;
}

/** What Today needs for combining two days; supplied by app.ts, which owns the stored combines. */
export interface CombineOptions {
  /** All stored combines (Today reads the shown date's, as host or donor). */
  combines: CombinesByDate;

  /** The device's real today (never a `?date=` preview): offers and Undo show only when the shown date is this date, and lapsed combines are found with it. */
  realToday: string;
  actions: CombineActions;
}

/** Placeholder ticks for callers (tests) that pass none. */
const NO_TICKS: NoEquipmentTicks = new Map();

/** Placeholder combines for callers (tests) that pass none. */
const NO_COMBINES: CombinesByDate = new Map();

/**
 * Builds the Today screen for `date` ("YYYY-MM-DD"). Starting the program is
 * no longer done here: with no start date app.ts shows the Overview instead
 * (see overview.ts), so Today never has a first-run card.
 */
export function renderTodayScreen(
  program: Program,
  settings: TrainingSettings,
  date: string,
  log: WorkoutLog = { sessions: {} },
  retest?: RetestOptions,
  checkIn?: CheckInOptions,
  rotation?: RotationOptions,
  noEquipment?: NoEquipmentOptions,
  combine?: CombineOptions,
): HTMLElement {
  const screen = element("section", "screen");

  // A date whose day was folded into another date's session shows a card and no session.
  const donor = activeDonorOn(program, settings.startDate, date, combine?.combines ?? NO_COMBINES, log, combine?.realToday ?? todayLocalDate());
  const donorStatus = programStatus(settings.startDate, program.lengthWeeks, date);
  if (donor !== undefined && donorStatus.kind === "active") {
    screen.append(renderDonorCard(donor, date, donorStatus.week, program.lengthWeeks, program.safety));
    return screen;
  }

  // The swapped session: ticked (or already logged) swaps show as their own exercise.
  // A combined date gives the merged session of both days.
  const { session, locked } = buildSwappedSessionFor(program, settings, log, noEquipment?.ticks ?? NO_TICKS, combine?.combines ?? NO_COMBINES, date, combine?.realToday ?? todayLocalDate());

  switch (session.kind) {
    case "training":
    case "combined":
      if (retest !== undefined) {
        const exercisesToRetest = retestExercisesToSave(program, settings, date, retest.dismissedDate);
        // The broad jump is part of the fatigue check; a program without one has no jump to ask for.
        const hasJump = program.fatigueCheck !== undefined;
        const jumpOnly = hasJump && exercisesToRetest.length === 0
          && shouldOfferJumpOnly(program, settings, date, retest.dismissedDate, retest.history, retest.jumpSkippedWeekStart);
        if (exercisesToRetest.length > 0 || jumpOnly) {
          screen.append(renderRetestCard(exercisesToRetest, settings, retest.actions, hasJump ? {
            week: trainingWeekOf(program, settings, date) ?? 0,
            history: weeklyChecksFor(retest.history, settings.startDate, program.lengthWeeks),
          } : undefined));
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
        if (program.warmupRotation !== undefined && blockStartWeek !== undefined && !rotation.dismissedBlockWeeks.includes(blockStartWeek)) {
          screen.append(renderRotationCard(describeSwaps(program, program.warmupRotation), program.warmupRotation, rotation.onDismiss, rotation.canDismiss));
        }
      }
      if (session.kind === "combined") {
        screen.append(...renderCombinedDay(program, session, date, log, locked, noEquipment, combine));
      } else {
        screen.append(...renderTrainingDay(program, session, date, log, locked, noEquipment, combine, settings.startDate));
      }
      break;
    default:
      screen.append(renderMessageCard(session, program.lengthWeeks, date, program.safety));
  }

  return screen;
}

/**
 * A single card for sessions with nothing to train: not started, rest day,
 * finished. Each ends with the small "Program overview" link. The
 * `noStartDate` case is only here to keep the switch exhaustive: app.ts never
 * renders Today without a start date (it shows the Overview), so the card just
 * points there. A program with safety notes keeps the "Safety notes" link on
 * these cards too (as on a training day), so the notes are one tap away on
 * rest days as well.
 */
function renderMessageCard(
  session: Exclude<SessionView, { kind: "training" }>,
  lengthWeeks: number,
  date: string,
  safetyNotes: string[],
): HTMLElement {
  const card = element("div", "card message-card");

  switch (session.kind) {
    case "noStartDate":
      card.append(element("h2", "card-title", "Program not started"));
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

  card.append(renderProgramOverviewLink());
  if (safetyNotes.length > 0) {
    card.append(renderSafetyNotesLink(safetyNotes));
  }
  return card;
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
  session: TrainingSessionView,
  date: string,
  log: WorkoutLog,
  locked: ReadonlySet<string>,
  noEquipment: NoEquipmentOptions | undefined,
  combine: CombineOptions | undefined,
  startDate: string | null,
): HTMLElement[] {
  const header = element("header", "today-header");
  header.append(
    element("div", "kicker", formatSessionKicker(date, session.week, program.lengthWeeks, session.dayNumber)),
    element("h1", "today-title", session.focus),
    element("div", "today-subtitle", `~${session.targetMinutes} min · ${session.blocks.length} blocks`),
    renderProgramOverviewLink(),
  );
  // A program with safety notes keeps them one tap away; the sheet is shared with the exercise details.
  if (program.safety.length > 0) {
    header.append(renderSafetyNotesLink(program.safety));
  }

  const parts: HTMLElement[] = [header];

  // "Short on time? Add Day N to today" and "Add missed Day N to today", right under the header so they are
  // seen without scrolling. Only on the real today, while nothing is logged and the pair is allowed.
  if (combine !== undefined) {
    const offers = combineOffersFor(program, startDate, date, log, combine.combines, combine.realToday);
    if (offers.length > 0) parts.push(renderCombineOffers(offers, combine.actions));
  }

  parts.push(renderPhaseStrip(program, session.phase, session.isDeload));

  if (session.isDeload) {
    const note = element("div", "deload-note", "Deload week: sets halved");
    note.setAttribute("role", "note");
    parts.push(note);
  }

  session.blocks.forEach((block, index) => {
    const slot: RowSlot = { day: session.dayNumber, blockPosition: index + 1, isCombined: false };
    parts.push(renderBlockCard(program, block, index + 1, slot, session.phase, date, log, locked, noEquipment));
  });

  return parts;
}

/**
 * Everything for a combined day (two days merged, PR 25), in display order:
 * the header naming both days, the "Undo combine" button (right under the
 * header, only on the real today while nothing is logged on the date), the
 * phase strip, the deload note and one card per merged block. The blocks are
 * numbered 1..n in the merged order; each ROW still
 * logs under its own day and block position (`RowSlot`).
 *
 *   CombinedSession.blocks ─▶ "single" block   ─▶ one card, its rows labelled D1 / D2
 *                          └▶ "alternate" block ─▶ one card for both days' explosive rows + how to alternate
 */
function renderCombinedDay(
  program: Program,
  session: CombinedSession,
  date: string,
  log: WorkoutLog,
  locked: ReadonlySet<string>,
  noEquipment: NoEquipmentOptions | undefined,
  combine: CombineOptions | undefined,
): HTMLElement[] {
  const header = element("header", "today-header");
  header.append(
    element("div", "kicker", formatCombinedSessionKicker(date, session.week, program.lengthWeeks, session.days)),
    element("h1", "today-title", session.focus),
    element("div", "today-subtitle", `~${session.targetMinutes} min · ${session.blocks.length} blocks`),
    renderProgramOverviewLink(),
  );
  if (program.safety.length > 0) {
    header.append(renderSafetyNotesLink(program.safety));
  }

  const parts: HTMLElement[] = [header];

  // Undo sits under the header like the offers do, so it is not buried under a long session. Only on the
  // real today, and only while nothing is logged: afterwards the logged sets belong to the combined session.
  const nothingLogged = (log.sessions[date]?.sets.length ?? 0) === 0;
  if (combine !== undefined && nothingLogged && date === combine.realToday) parts.push(renderUndoCombine(combine.actions));

  parts.push(renderPhaseStrip(program, session.phase, session.isDeload));

  if (session.isDeload) {
    const note = element("div", "deload-note", "Deload week: sets halved");
    note.setAttribute("role", "note");
    parts.push(note);
  }

  session.blocks.forEach((combinedBlock, index) => {
    parts.push(renderCombinedBlockCard(program, combinedBlock, index + 1, session.phase, date, log, locked, noEquipment));
  });

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
 * Where a row's block lives in the log: the program day it belongs to and its
 * 1-based position within THAT day's blocks (not its number on the screen,
 * which differs in a combined session). Logging, "last time", progress, rest
 * memory and the No equipment tick all key by this. `isCombined` marks rows of
 * a combined session: they get a "D1"/"D2" label and day-qualified keys and
 * links (two days share one date, and both have a block 2).
 */
interface RowSlot {
  day: number;
  blockPosition: number;
  isCombined: boolean;
}

/** The day to put in keys and links for `slot`: its day when combined, else undefined so a normal session's keys stay as they were. */
function keyDayOf(slot: RowSlot): number | undefined {
  return slot.isCombined ? slot.day : undefined;
}

/**
 * One card for a block: numbered title (`displayNumber`, the number on the
 * screen), then one row per item. `phase` names the progression phase for the
 * timer-adjustment lines.
 */
function renderBlockCard(
  program: Program,
  block: BlockView,
  displayNumber: number,
  slot: RowSlot,
  phase: string,
  date: string,
  log: WorkoutLog,
  locked: ReadonlySet<string>,
  noEquipment: NoEquipmentOptions | undefined,
): HTMLElement {
  const card = element("section", "card block-card");
  card.append(element("h2", "block-title", formatBlockTitle(displayNumber, block)));
  appendBlockBody(card, program, block, slot, phase, date, log, locked, noEquipment);
  return card;
}

/**
 * One merged block of a combined session as a card. A "single" block is the
 * ordinary card for its one part (rows labelled with their day). An
 * "alternate" block is one card holding both days' explosive rows under a
 * line saying to alternate them set by set.
 */
function renderCombinedBlockCard(
  program: Program,
  combinedBlock: CombinedBlock,
  displayNumber: number,
  phase: string,
  date: string,
  log: WorkoutLog,
  locked: ReadonlySet<string>,
  noEquipment: NoEquipmentOptions | undefined,
): HTMLElement {
  const slotOf = (part: CombinedBlock["parts"][number]): RowSlot => ({ day: part.source.day, blockPosition: part.source.blockPosition, isCombined: true });

  if (combinedBlock.arrangement === "single") {
    const [part] = combinedBlock.parts;
    return renderBlockCard(program, part!.block, displayNumber, slotOf(part!), phase, date, log, locked, noEquipment);
  }

  const card = element("section", "card block-card");
  card.append(
    element("h2", "block-title", `${displayNumber}${DISPLAY_SEPARATOR}${blockLabel(combinedBlock.type)}${DISPLAY_SEPARATOR}alternate`),
    element("p", "combine-alternate-note", alternateNote(combinedBlock)),
  );
  for (const part of combinedBlock.parts) {
    appendBlockBody(card, program, part.block, slotOf(part), phase, date, log, locked, noEquipment);
  }
  return card;
}

/** Separator in block titles, as in `formatBlockTitle`. */
const DISPLAY_SEPARATOR = " · ";

/** "Alternate set by set: one set of A, then one set of B, and repeat. Each rest is spent on the other exercise." */
function alternateNote(combinedBlock: CombinedBlock): string {
  const names = combinedBlock.parts.map((part) => part.block.items.map(itemDisplayName).join(" + "));
  return `Alternate set by set: one set of ${names.join(", then one set of ")}, and repeat. Each rest is spent on the other exercise.`;
}

/** The between-pairs rest (supersets) and one row per item of `block`, appended to `card`. Shared by the normal and the alternate card. */
function appendBlockBody(
  card: HTMLElement,
  program: Program,
  block: BlockView,
  slot: RowSlot,
  phase: string,
  date: string,
  log: WorkoutLog,
  locked: ReadonlySet<string>,
  noEquipment: NoEquipmentOptions | undefined,
): void {
  // Supersets rest between pairs, so the rest button belongs to the block rather than to one row.
  if (block.restSecBetweenPairs) {
    const restRow = element("div", "block-rest");
    restRow.append(renderStartRestButton(
      block.restSecBetweenPairs,
      "Between pairs",
      restMemoryKey(date, slot.blockPosition, "between-pairs", keyDayOf(slot)),
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
    card.append(renderItemRow(program, item, block, slot, phase, date, log, locked, noEquipment));
  }
}

/**
 * "<original name> → <new name>" for each swap of the warm-up rotation, for
 * the rotation card; falls back to the exercise id if the library lacks it.
 */
function describeSwaps(program: Program, rotation: WarmupRotation): string[] {
  return rotation.swaps.map((swap) => `${program.exercises[swap.out]?.name ?? swap.out} → ${swap.in}`);
}

/**
 * One exercise row. The name/details/dose are a single button that opens the
 * item's log screen (the details sheet is behind the ⓘ button there), with
 * logging progress ("2/6", "✓ 6/6") under the details once a set is logged, then the muted
 * "Last time (2 Nov): ..." line when the exercise has been logged before (not on warm-ups). When the dose needs a max, the dose is a separate link to
 * Settings instead (a link can't live inside a button).
 */
function renderItemRow(
  program: Program,
  item: ItemView,
  block: BlockView,
  slot: RowSlot,
  phase: string,
  date: string,
  log: WorkoutLog,
  locked: ReadonlySet<string>,
  noEquipment: NoEquipmentOptions | undefined,
): HTMLElement {
  const { day: dayNumber, blockPosition } = slot;
  const keyDay = keyDayOf(slot);
  const row = element("div", "item-row");
  const dose = formatItemDose(item);

  const openButton = element("button", "item-open");
  openButton.type = "button";

  const text = element("span", "item-text");
  if (slot.isCombined) {
    // "D2  Split squat": which of the two days this row comes from.
    const nameLine = element("span", "item-name-line");
    const dayLabel = element("span", "item-day-label", `D${dayNumber}`);
    dayLabel.title = `Day ${dayNumber}`;
    nameLine.append(dayLabel, element("span", "item-name", itemDisplayName(item)));
    text.append(nameLine);
  } else {
    text.append(element("span", "item-name", itemDisplayName(item)));
  }
  if (item.rotatedIn !== undefined) {
    text.append(element("span", "item-rotated-in", `Rotated in for ${item.rotatedIn.originalName}`));
  }
  const details = formatItemDetails(item);
  if (details.length > 0) {
    text.append(element("span", "item-details", details.join(" · ")));
  }
  const itemKey = noEquipmentItemKey(blockPosition, originalExerciseIdOf(item), keyDay);
  const isLocked = locked.has(itemKey);
  const noEquipmentLine = noEquipmentLineFor(item, isLocked);
  // When sets are logged on a swapped row, this visible line also explains the disabled box (aria-describedby).
  const noEquipmentNoteId = `no-equipment-note-${itemKey.replace(/[^A-Za-z0-9_-]/g, "-")}`;
  if (noEquipmentLine !== undefined) {
    const note = element("span", "item-no-equipment-note", noEquipmentLine);
    note.id = noEquipmentNoteId;
    text.append(note);
  }
  // The phase's work-time adjustment, so the row's seconds and the timer's defaults are explained.
  if (item.workSecAdjustment !== undefined) {
    text.append(element("span", "timer-adjustment", formatTimerAdjustment(phase, item.workSecAdjustment, "work")));
  }
  // A sameEveryWeek item (the wall sit) in a week where other things change: say so, so it isn't mistaken for a missed adjustment.
  if (item.showsSameEveryWeekNote) {
    text.append(element("span", "timer-adjustment", SAME_EVERY_WEEK_TEXT));
  }
  const progress = formatProgress(setsForItem(log, date, blockPosition, item.exercise.id, dayNumber).length, countSetsForItem(item, block));
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
    row.append(renderStartRestButton(item.restSec, itemDisplayName(item), restMemoryKey(date, blockPosition, item.exercise.id, keyDay), itemDisplayName(item)));
  }

  // Heavy bag intervals likewise.
  if (item.format === "interval" && item.rounds && item.workSec && item.restSec) {
    row.append(renderStartIntervalButton(item));
  }


  // Items with a swap get the "No equipment" tick on its own line at the bottom of the row.
  if (hasNoEquipmentSwap(item) && noEquipment !== undefined) {
    row.append(renderNoEquipmentTick(item, itemKey, isLocked, noEquipment, noEquipmentLine !== undefined ? noEquipmentNoteId : undefined));
  }

  openButton.addEventListener("click", () => {
    window.location.hash = logRouteHash(date, blockPosition, item.exercise.id, keyDay);
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

/**
 * The line under a swappable item's details: "Instead of <original>" while
 * swapped, with " · sets logged" appended once sets are logged (the tick is
 * locked, which also explains the disabled box to screen readers). Nothing
 * for an item that is not swapped, locked or not: the title already says
 * what it is.
 */
function noEquipmentLineFor(item: ItemView, isLocked: boolean): string | undefined {
  if (!hasNoEquipmentSwap(item)) return undefined;
  if (item.swappedFrom === undefined) return undefined;

  const insteadOf = `Instead of ${item.swappedFrom.name}`;
  return isLocked ? `${insteadOf} · sets logged` : insteadOf;
}

/**
 * The "No equipment" checkbox for one swappable row. Checked means swapped.
 * It is disabled once a set is logged (the lock) and on a future preview date
 * (where nothing can be logged either). Toggling asks app.ts to save the tick
 * through `onToggle` (which re-renders Today on success); on failure the box
 * goes back and the message appears under it, like other save failures. The
 * label wraps the input so the whole 48px line is the tap target.
 *
 * A disabled box says why to screen readers through `aria-describedby`: the
 * row's visible "Instead of ... · sets logged" line (`swapNoteId`) when sets
 * are logged on a swapped row, else a visually hidden note in this group
 * ("Locked: sets are logged" or "Can't tick a future date").
 */
function renderNoEquipmentTick(item: ItemView, itemKey: string, isLocked: boolean, options: NoEquipmentOptions, swapNoteId: string | undefined): HTMLElement {
  const label = element("label", "item-no-equipment");
  const checkbox = element("input");
  checkbox.type = "checkbox";
  checkbox.checked = item.swappedFrom !== undefined;
  checkbox.disabled = isLocked || !options.canTick;
  checkbox.dataset.noEquipmentKey = itemKey;
  // The accessible name says which exercise it belongs to; the visible text starts the name (WCAG 2.5.3).
  label.append(checkbox, element("span", undefined, "No equipment"));
  checkbox.setAttribute("aria-label", `No equipment, ${item.swappedFrom?.name ?? item.exercise.name}`);

  const errorLine = element("p", "field-error item-no-equipment-error");
  errorLine.setAttribute("role", "alert");

  checkbox.addEventListener("change", () => {
    const wanted = checkbox.checked;
    const failure = options.onToggle(itemKey, wanted);
    if (failure !== null) {
      checkbox.checked = !wanted;
      errorLine.textContent = failure;
    }
  });

  const group = element("div", "item-no-equipment-group");
  group.append(label, errorLine);

  if (isLocked && swapNoteId !== undefined) {
    checkbox.setAttribute("aria-describedby", swapNoteId);
  } else if (checkbox.disabled) {
    const reasonNote = element("span", "visually-hidden", isLocked ? "Locked: sets are logged" : "Can't tick a future date");
    reasonNote.id = `no-equipment-reason-${itemKey.replace(/[^A-Za-z0-9_-]/g, "-")}`;
    checkbox.setAttribute("aria-describedby", reasonNote.id);
    group.append(reasonNote);
  }
  return group;
}
