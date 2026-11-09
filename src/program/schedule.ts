import type { Block, BlockItem, Exercise, Format, Program, ProgressionPhase, Range, Reps } from "./model";
import { DAYS_PER_WEEK } from "./model";
import { addDaysToDate, programStatus } from "./calendar";
import type { TrainingSettings } from "../settings/model";

/**
 * Turns the program plus the athlete's settings into the concrete session
 * for one calendar date. Pure functions only: no UI, no storage.
 *
 *   Program + TrainingSettings + "YYYY-MM-DD"
 *        │  calendar.programStatus  -> week / day number / not started / complete
 *        │  phase lookup            -> Base, Deload, ...
 *        ▼
 *   SessionView  (rest day, or blocks of items with final numbers)
 *
 * The UI renders a `SessionView` and never does arithmetic of its own.
 */

// ---------------------------------------------------------------------------
// View types (what the UI receives)
// ---------------------------------------------------------------------------

/**
 * A rep target ready to display.
 *  - fixed / range: final numbers (after max-percent and weekly increase)
 *  - text: free text from the program, shown as written
 *  - needsMax: the target depends on a tested max that Ed has not entered;
 *    the UI should ask for it (`percentMin`/`percentMax` are fractions, 0.4 = 40%)
 */
export type RepTarget =
  | { kind: "fixed"; count: number; basis?: MaxBasis }
  | { kind: "range"; min: number; max: number; basis?: MaxBasis }
  | { kind: "text"; text: string }
  | { kind: "needsMax"; exerciseId: string; percentMin: number; percentMax: number };

/**
 * Explains where a percent-of-max target came from, so the UI can show
 * "40% of max 12 · +1 this week" without doing any arithmetic itself.
 * Present only on targets derived from a tested max.
 *  - percentMin / percentMax: fractions (0.4 = 40%)
 *  - max: the athlete's tested max the percentage was applied to
 *  - weeklyIncrease: reps already added to the figure this week
 *    (0 in week 1 of a phase and for items that don't progress). In a deload
 *    it is the increase of the previous week, held rather than dropped.
 *  - heldForDeload: true when this is a deload week and `weeklyIncrease`
 *    is last week's figure carried over (the UI says so).
 *  - usesRetestedMax: true in a retest week (week 8) once the athlete has
 *    saved a max for this exercise during that week: the target is
 *    floor(max x pct) from the retested max, with no increase and no hold.
 *    Set only on EMOM items (those with a weeklyIncrease), not mini-doses.
 *  - awaitingRetest: true in a retest week while no max has been saved for
 *    this exercise during the week. The previous week's increase is held
 *    (`heldForDeload` is also true) and the UI asks the athlete to save a
 *    retested max.
 */
export interface MaxBasis {
  percentMin: number;
  percentMax: number;
  max: number;
  weeklyIncrease: number;
  heldForDeload: boolean;
  usesRetestedMax: boolean;
  awaitingRetest: boolean;
}

/**
 * What a week's items need to know to resolve their targets; computed once
 * per session in `buildSession`.
 *  - offset: weekly increases to add (see `weeklyIncreaseOffsetForWeek`)
 *  - retestHeldOffset: in a retest week, the previous week's offset, which
 *    EMOMs hold until a retested max is saved (0 outside retest weeks)
 *  - weekStartDate: first calendar day of the program week; a max saved on
 *    or after it counts as retested
 */
interface WeekContext {
  isDeload: boolean;
  isRetest: boolean;
  offset: number;
  retestHeldOffset: number;
  weekStartDate: string;
}

/** The increase handling chosen for one item; carried into `resolveReps`. */
interface IncreaseChoice {
  increase: number;
  heldForDeload: boolean;
  usesRetestedMax: boolean;
  awaitingRetest: boolean;
}

/** One set of an item, with its computed rep target. */
export interface SetView {
  target?: RepTarget;
  load?: string;
}

/** One exercise in a session, with all numbers already computed for the date. */
export interface ItemView {
  exercise: Exercise;
  format: Format;
  /** Sets to perform (already halved in a deload); empty for time-driven items. */
  sets: SetView[];
  /** Item-level target for items without sets (warm-ups, EMOM). */
  target?: RepTarget;
  restSec?: Range;
  /** EMOM minutes (halved in a deload). */
  minutes?: number;
  /** Interval rounds; a ranged program value stays a range outside a deload. */
  rounds?: Range;
  workSec?: Range;
  durationSec?: number;
  perSide: boolean;
  optional: boolean;
  load?: string;
  note?: string;
  tempo?: string;
  /**
   * The program's descriptive progression rule (e.g. "+1 rep per minute"),
   * for display as a rule only (the exercise sheet). It is free text and is
   * never parsed: the schedule treats its mere presence as "this item adds 1
   * rep per week" (see `buildItem`). The amount actually added this week is
   * on the target's `basis.weeklyIncrease`.
   */
  weeklyIncrease?: string;
}

/** One block of the session, in program order. */
export interface BlockView {
  type: string;
  format: Format;
  /** Superset rounds (not halved for warm-ups). */
  rounds?: Range;
  minutes?: number;
  restSecBetweenPairs?: Range;
  items: ItemView[];
}

/** What the Today screen should show for a date. */
export type SessionView =
  | { kind: "noStartDate" }
  | { kind: "notStarted"; startsOn: string }
  | { kind: "complete" }
  | { kind: "rest"; week: number; dayNumber: number; phase: string }
  | {
      kind: "training";
      week: number;
      /** Day of the program week, 1-7, counted from the start date. */
      dayNumber: number;
      phase: string;
      isDeload: boolean;
      focus: string;
      targetMinutes: number;
      blocks: BlockView[];
    };

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Builds the session for `date` ("YYYY-MM-DD", the caller's local today).
 * Called by the Today screen on every render; has no side effects.
 */
export function buildSession(program: Program, settings: TrainingSettings, date: string): SessionView {
  const status = programStatus(settings.startDate, program.lengthWeeks, date);

  if (status.kind !== "active") {
    return status;
  }

  const { week, dayNumber } = status;
  const phase = phaseForWeek(program, week);
  const isDeload = isDeloadPhase(phase);
  const isRetest = phase.retest;
  const day = program.days[dayNumber];

  if (!day) {
    return { kind: "rest", week, dayNumber, phase: phase.phase };
  }

  const weekContext: WeekContext = {
    isDeload,
    isRetest,
    offset: weeklyIncreaseOffsetForWeek(program, week),
    retestHeldOffset: isRetest && week > 1 ? weeklyIncreaseOffsetForWeek(program, week - 1) : 0,
    // settings.startDate is non-null here: programStatus was "active".
    weekStartDate: addDaysToDate(settings.startDate as string, (week - 1) * DAYS_PER_WEEK),
  };

  return {
    kind: "training",
    week,
    dayNumber,
    phase: phase.phase,
    isDeload,
    focus: day.focus,
    targetMinutes: day.targetMinutes,
    blocks: day.blocks.map((block) => buildBlock(block, settings, weekContext)),
  };
}

/** Finds the progression entry containing `week`; throws if the program has a gap. */
export function phaseForWeek(program: Program, week: number): ProgressionPhase {
  const phase = program.progression.find((entry) => entry.weeks.includes(week));
  if (!phase) {
    throw new Error(`program.json: no progression phase covers week ${week}`);
  }
  return phase;
}

/**
 * How many weekly increases have accumulated by `week`.
 *  - normal week: the week's 0-based position within its phase
 *  - retest week: 0. This is the offset for a retested max: floor(max x pct)
 *    with no increase and no hold (W8). Until a max is saved in the week,
 *    EMOMs instead hold the previous week's offset (see `chooseIncrease`).
 *  - plain deload week: the previous week's EFFECTIVE offset, so the EMOM
 *    reps are held rather than dropped (W4 holds W3's). If the previous
 *    week is itself a plain deload, its held offset is used in turn, so
 *    consecutive deload weeks all hold the last normal week's figure. A
 *    deload right after a retest week therefore holds 0 (the retest week's
 *    effective offset).
 *  - a plain deload with no previous week (week 1): 0
 */
function weeklyIncreaseOffsetForWeek(program: Program, week: number): number {
  const phase = phaseForWeek(program, week);
  if (phase.retest) {
    return 0;
  }
  if (!isDeloadPhase(phase)) {
    return phase.weeks.indexOf(week);
  }

  if (week <= 1) {
    return 0;
  }
  return weeklyIncreaseOffsetForWeek(program, week - 1);
}

/**
 * Deload is detected from the phase name ("Deload", "Deload + retest") so
 * that the schedule follows the data rather than hard-coding weeks 4 and 8.
 */
function isDeloadPhase(phase: ProgressionPhase): boolean {
  return phase.phase.toLowerCase().startsWith("deload");
}

// ---------------------------------------------------------------------------
// Blocks and items
// ---------------------------------------------------------------------------

/** Builds one block; warm-ups are never halved in a deload. */
function buildBlock(block: Block, settings: TrainingSettings, week: WeekContext): BlockView {
  const halve = week.isDeload && block.type !== "warmup";

  return {
    type: block.type,
    format: block.format,
    rounds: block.rounds && (halve ? halveRange(block.rounds) : block.rounds),
    minutes: block.minutes === undefined ? undefined : halve ? halveRoundingUp(block.minutes) : block.minutes,
    restSecBetweenPairs: block.restSecBetweenPairs,
    items: block.items.map((item) => buildItem(item, settings, halve, week)),
  };
}

/**
 * Builds one item: halves volume when `halve` is set, resolves rep targets
 * against the athlete's maxes, and applies the weekly increase to items that
 * declare one.
 */
function buildItem(item: BlockItem, settings: TrainingSettings, halve: boolean, week: WeekContext): ItemView {
  const choice = chooseIncrease(item, settings, week);

  const keptSets = halve ? item.sets.slice(0, Math.ceil(item.sets.length / 2)) : item.sets;

  return {
    exercise: item.exercise,
    format: item.format,
    sets: keptSets.map((set) => ({
      target: set.reps && resolveReps(set.reps, item.exerciseId, settings, choice),
      load: set.load,
    })),
    target: item.reps && resolveReps(item.reps, item.exerciseId, settings, choice),
    restSec: item.restSec,
    minutes: item.minutes === undefined ? undefined : halve ? halveRoundingUp(item.minutes) : item.minutes,
    // Deload intervals use the low end of the range, halved (4-5 -> 2).
    rounds: item.rounds && (halve ? { min: halveRoundingUp(item.rounds.min), max: halveRoundingUp(item.rounds.min) } : item.rounds),
    workSec: item.workSec,
    durationSec: item.durationSec,
    perSide: item.perSide,
    optional: item.optional,
    load: item.load,
    note: item.note,
    tempo: item.tempo,
    weeklyIncrease: item.weeklyIncrease,
  };
}

/**
 * Decides how an item's weekly increase is applied this week.
 *
 * Only items with a `weeklyIncrease` (the EMOMs) grow week to week. The field
 * is descriptive text and is not parsed: its presence means "+1 rep per
 * week", and `week.offset` is the number of weekly increases accumulated (in
 * a plain deload, last week's: held, not reset).
 *
 *   not an EMOM            -> no increase (mini-doses just use the saved max)
 *   retest week, EMOM:
 *     max saved this week  -> offset 0, from the retested max
 *     no max saved yet     -> hold last week's offset, awaiting a retest
 *   other weeks            -> week.offset (held in a plain deload)
 */
function chooseIncrease(item: BlockItem, settings: TrainingSettings, week: WeekContext): IncreaseChoice {
  if (item.weeklyIncrease === undefined) {
    return { increase: 0, heldForDeload: false, usesRetestedMax: false, awaitingRetest: false };
  }

  if (week.isRetest) {
    const retested = wasMaxSavedSince(settings, item.exerciseId, week.weekStartDate);

    return retested
      ? { increase: week.offset, heldForDeload: false, usesRetestedMax: true, awaitingRetest: false }
      : { increase: week.retestHeldOffset, heldForDeload: true, usesRetestedMax: false, awaitingRetest: true };
  }

  return { increase: week.offset, heldForDeload: week.isDeload && week.offset > 0, usesRetestedMax: false, awaitingRetest: false };
}

/**
 * True when the exercise's max was saved on or after `weekStartDate` (Day 1 of
 * the week in question). This is THE "retested during the retest week" check:
 * `chooseIncrease` uses it to switch EMOMs to the new max, and the Today
 * retest card (ui/retest.ts) uses it to know which maxes are still to save.
 * ISO dates compare correctly as strings; a max with no known save date counts
 * as not saved.
 */
export function wasMaxSavedSince(settings: TrainingSettings, exerciseId: string, weekStartDate: string): boolean {
  const savedOn = settings.maxSavedOn[exerciseId];
  return savedOn !== undefined && savedOn >= weekStartDate;
}

/**
 * For a retest-week TRAINING day, returns the date of that week's Day 1;
 * for any other date (no start date, not started, complete, a non-retest
 * week, or a rest day) returns undefined. Used by the Today retest card to
 * decide whether to appear and which saved dates count as "retested".
 */
export function retestWeekStartDate(program: Program, settings: TrainingSettings, date: string): string | undefined {
  const status = programStatus(settings.startDate, program.lengthWeeks, date);
  if (status.kind !== "active") {
    return undefined;
  }

  const isRetestWeek = phaseForWeek(program, status.week).retest;
  const isTrainingDay = program.days[status.dayNumber] !== undefined;
  if (!isRetestWeek || !isTrainingDay) {
    return undefined;
  }

  // settings.startDate is non-null here: programStatus was "active".
  return addDaysToDate(settings.startDate as string, (status.week - 1) * DAYS_PER_WEEK);
}

/** Halves a count, rounding up (5 -> 3, 2 -> 1). */
function halveRoundingUp(count: number): number {
  return Math.ceil(count / 2);
}

/** Halves both ends of a range, rounding up. */
function halveRange(range: Range): Range {
  return { min: halveRoundingUp(range.min), max: halveRoundingUp(range.max) };
}

/**
 * Converts program reps into a displayable target. Percent-of-max becomes
 * floor(max x pct), at least 1; the weekly `increase` is added after that.
 * Percent-of-max targets also carry a `basis` so the UI can explain them;
 * `choice` says how the weekly increase applies (see `chooseIncrease`).
 */
function resolveReps(reps: Reps, exerciseId: string, settings: TrainingSettings, choice: IncreaseChoice): RepTarget {
  const { increase } = choice;

  switch (reps.kind) {
    case "text":
      return { kind: "text", text: reps.text };

    case "fixed":
      return { kind: "fixed", count: reps.count + increase };

    case "range":
      return rangeTarget(reps.min + increase, reps.max + increase);

    case "percentOfMax": {
      const max = settings.maxReps[exerciseId];
      if (max === undefined) {
        return { kind: "needsMax", exerciseId, percentMin: reps.min, percentMax: reps.max };
      }
      const low = Math.max(1, floorPercentOfMax(max, reps.min));
      const high = Math.max(1, floorPercentOfMax(max, reps.max));
      const basis: MaxBasis = { percentMin: reps.min, percentMax: reps.max, max, weeklyIncrease: increase, heldForDeload: choice.heldForDeload, usesRetestedMax: choice.usesRetestedMax, awaitingRetest: choice.awaitingRetest };
      return rangeTarget(low + increase, high + increase, basis);
    }
  }
}

/**
 * floor(max x fraction), nudged by 1e-9 first. Fractions like 0.57 aren't
 * exact in binary floating point (100 x 0.57 = 56.99999999999999), so a bare
 * floor would drop a whole rep. The nudge is far smaller than any real
 * difference between rep counts, so it only repairs those artefacts.
 */
function floorPercentOfMax(max: number, fraction: number): number {
  return Math.floor(max * fraction + 1e-9);
}

/** A range whose ends match is shown as a single fixed number. */
function rangeTarget(min: number, max: number, basis?: MaxBasis): RepTarget {
  return min === max ? { kind: "fixed", count: min, basis } : { kind: "range", min, max, basis };
}
