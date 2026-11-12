import type { Program, Range } from "./model";
import { DAYS_PER_WEEK } from "./model";
import { addDaysToDate } from "./calendar";
import type { BlockView, ItemView, RepTarget, SessionView } from "./schedule";
import { buildSession } from "./schedule";
import { itemDisplayName } from "./rotation";
import type { TrainingSettings } from "../settings/model";

/**
 * View model for the read-only Day plan screen (`#/plan/<day>/<week>`):
 * "what would Day N look like in week W", plus what changed since the
 * previous week. Pure functions only: no UI, no storage.
 *
 *   Program + TrainingSettings + (week, day)
 *        │  planDateFor            -> the calendar date that week/day falls on
 *        │  buildSession           -> the same SessionView Today would show
 *        ▼
 *   buildDayPlan ──────────────┐
 *                              ├─ compareWithPreviousWeek -> DayPlanChanges
 *   buildDayPlan (week - 1) ───┘     (items matched by block position + exercise id)
 *
 * No rules are re-implemented here: every figure comes from `buildSession`.
 * The UI (src/ui/dayPlan.ts) formats the views and the previous-week
 * `ItemView`s it gets back, so this module never imports UI code.
 */

/** One item whose displayed figures differ from the previous week's. */
export interface ItemChange {
  /** Index of the block in the session (program order). */
  blockIndex: number;
  /** Index of the item inside that block. */
  itemIndex: number;
  /** This week's item, as in the plan. */
  current: ItemView;
  /** The previous week's version of the same item, for the UI to format. */
  previous: ItemView;
}

/** A block whose block-level figures (rounds, minutes, rest between pairs) differ. */
export interface BlockChange {
  blockIndex: number;
  current: BlockView;
  previous: BlockView;
}

/** All differences between a day's plan and the same day one week earlier. */
export interface DayPlanChanges {
  /** The week the changes are measured against (this week - 1). */
  previousWeek: number;
  blocks: BlockChange[];
  items: ItemChange[];
}

/**
 * The calendar date of program `week` (1-based) and `dayNumber` (1-7) for a
 * program that starts on `startDate`: start + (week-1)*7 + (day-1). Used by
 * `buildDayPlan` to ask the schedule what that day looks like.
 */
export function planDateFor(startDate: string, week: number, dayNumber: number): string {
  return addDaysToDate(startDate, (week - 1) * DAYS_PER_WEEK + (dayNumber - 1));
}

/**
 * The session Today would show for program `week` and `dayNumber`, for the
 * Day plan screen. Returns undefined when the week is not an integer in
 * 1..program.lengthWeeks or the day not an integer in 1..7 (the UI then
 * falls back to the Overview). A rest day gives a `rest` view.
 *
 * Uses the saved start date; without one it pretends the program starts on
 * `today` (the caller's local calendar date, "YYYY-MM-DD"; exactly what the
 * Overview's Start button would save), in a COPY of the settings, so the
 * caller's settings are never changed or saved. The stand-in matches what
 * Today would show had the program started on that day.
 * (Under a past `?date=` preview a later real max save can fall inside the
 * stand-in's week 8; that is accepted, as it is only a preview.)
 */
export function buildDayPlan(program: Program, settings: TrainingSettings, week: number, dayNumber: number, today: string): SessionView | undefined {
  const weekIsValid = Number.isInteger(week) && week >= 1 && week <= program.lengthWeeks;
  const dayIsValid = Number.isInteger(dayNumber) && dayNumber >= 1 && dayNumber <= DAYS_PER_WEEK;
  if (!weekIsValid || !dayIsValid) {
    return undefined;
  }

  // A copy, never the caller's object: the stand-in must not leak into saved settings.
  const effectiveSettings: TrainingSettings = settings.startDate === null ? { ...settings, startDate: today } : settings;

  return buildSession(program, effectiveSettings, planDateFor(effectiveSettings.startDate as string, week, dayNumber));
}

/**
 * Reports which items (and blocks) of the plan for `week`/`dayNumber` differ
 * from the same day in the previous week, matching by block position and
 * exercise id. `today` is passed to `buildDayPlan` (stand-in start date when
 * none is saved). Returns undefined when there is nothing to compare: week 1,
 * invalid input, or either week's day is not a training day (rest day).
 *
 * An item only in one of the two weeks is skipped. A rotated warm-up has the
 * same exercise id, so it matches and its display-name change is reported. Compared figures are those Today
 * shows (see `itemSignature`), so a change here is always visible on screen.
 */
export function compareWithPreviousWeek(program: Program, settings: TrainingSettings, week: number, dayNumber: number, today: string): DayPlanChanges | undefined {
  if (week <= 1) {
    return undefined;
  }

  const current = buildDayPlan(program, settings, week, dayNumber, today);
  const previous = buildDayPlan(program, settings, week - 1, dayNumber, today);
  if (current?.kind !== "training" || previous?.kind !== "training") {
    return undefined;
  }

  const changes: DayPlanChanges = { previousWeek: week - 1, blocks: [], items: [] };

  current.blocks.forEach((currentBlock, blockIndex) => {
    // Matched by position in the day, not index: a block can be left out of one week.
    const previousBlock = previous.blocks.find((candidate) => candidate.position === currentBlock.position);
    if (previousBlock === undefined) {
      return;
    }

    if (blockSignature(currentBlock) !== blockSignature(previousBlock)) {
      changes.blocks.push({ blockIndex, current: currentBlock, previous: previousBlock });
    }

    currentBlock.items.forEach((currentItem, itemIndex) => {
      const previousItem = previousBlock.items.find((candidate) => candidate.exercise.id === currentItem.exercise.id);
      if (previousItem !== undefined && itemSignature(currentItem) !== itemSignature(previousItem)) {
        changes.items.push({ blockIndex, itemIndex, current: currentItem, previous: previousItem });
      }
    });
  });

  return changes;
}

/**
 * A string of the block-level figures Today shows (rounds, minutes, rest
 * between pairs and its adjustment). Equal signatures = nothing to report.
 */
function blockSignature(block: BlockView): string {
  return JSON.stringify([rangeSignature(block.rounds), block.minutes, rangeSignature(block.restSecBetweenPairs), block.restAdjustment]);
}

/**
 * A string of every item figure Today displays: set targets, item target,
 * rest, EMOM minutes, rounds, work time (and its phase adjustment), hold
 * time, per-side and load, plus the display name (a rotated-in warm-up
 * exercise changes the name Today shows). Deliberately leaves out text that
 * doesn't change by week (note, tempo) and the same-every-week note.
 */
function itemSignature(item: ItemView): string {
  return JSON.stringify([
    item.sets.map((set) => [targetSignature(set.target), set.load]),
    targetSignature(item.target),
    rangeSignature(item.restSec),
    item.minutes,
    rangeSignature(item.rounds),
    rangeSignature(item.workSec),
    item.workSecAdjustment,
    item.durationSec,
    item.load,
    itemDisplayName(item),
  ]);
}

/**
 * Reduces a rep target to the numbers shown. The max-percent `basis` is left
 * out except for the weekly increase and hold flags, which Today displays
 * ("+1 this week", "held"); the percent and max themselves do not vary by week.
 */
function targetSignature(target: RepTarget | undefined): unknown {
  if (target === undefined) {
    return null;
  }
  switch (target.kind) {
    case "fixed":
      return ["fixed", target.count, basisSignature(target)];
    case "range":
      return ["range", target.min, target.max, basisSignature(target)];
    case "text":
      return ["text", target.text];
    case "needsMax":
      return ["needsMax", target.exerciseId];
  }
}

/** The week-varying part of a target's max basis (see `targetSignature`). */
function basisSignature(target: { basis?: { weeklyIncrease: number; heldForDeload: boolean; awaitingRetest: boolean; usesRetestedMax: boolean } }): unknown {
  const basis = target.basis;
  return basis === undefined ? null : [basis.weeklyIncrease, basis.heldForDeload, basis.awaitingRetest, basis.usesRetestedMax];
}

/** A range as a comparable pair, or null when absent. */
function rangeSignature(range: Range | undefined): unknown {
  return range === undefined ? null : [range.min, range.max];
}
