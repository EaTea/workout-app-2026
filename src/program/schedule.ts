import type { Block, BlockItem, Exercise, Format, Program, ProgressionPhase, Range, Reps, Weekday } from "./model";
import { programStatus } from "./calendar";
import type { TrainingSettings } from "../settings/model";

/**
 * Turns the program plus the athlete's settings into the concrete session
 * for one calendar date. Pure functions only: no UI, no storage.
 *
 *   Program + TrainingSettings + "YYYY-MM-DD"
 *        │  calendar.programStatus  -> week / weekday / not started / complete
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
 *    (0 in week 1 of a phase, for items that don't progress, and in a deload)
 */
export interface MaxBasis {
  percentMin: number;
  percentMax: number;
  max: number;
  weeklyIncrease: number;
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
  | { kind: "rest"; week: number; phase: string }
  | {
      kind: "training";
      week: number;
      weekday: Weekday;
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

  const { week, weekday } = status;
  const phase = phaseForWeek(program, week);
  const isDeload = isDeloadPhase(phase);
  const day = program.days[weekday];

  if (!day) {
    return { kind: "rest", week, phase: phase.phase };
  }

  const weeklyIncreaseOffset = isDeload ? 0 : phase.weeks.indexOf(week);

  return {
    kind: "training",
    week,
    weekday,
    phase: phase.phase,
    isDeload,
    focus: day.focus,
    targetMinutes: day.targetMinutes,
    blocks: day.blocks.map((block) => buildBlock(block, settings, isDeload, weeklyIncreaseOffset)),
  };
}

/** Finds the progression entry containing `week`; throws if the program has a gap. */
function phaseForWeek(program: Program, week: number): ProgressionPhase {
  const phase = program.progression.find((entry) => entry.weeks.includes(week));
  if (!phase) {
    throw new Error(`program.json: no progression phase covers week ${week}`);
  }
  return phase;
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
function buildBlock(block: Block, settings: TrainingSettings, isDeload: boolean, offset: number): BlockView {
  const halve = isDeload && block.type !== "warmup";

  return {
    type: block.type,
    format: block.format,
    rounds: block.rounds && (halve ? halveRange(block.rounds) : block.rounds),
    minutes: block.minutes === undefined ? undefined : halve ? halveRoundingUp(block.minutes) : block.minutes,
    restSecBetweenPairs: block.restSecBetweenPairs,
    items: block.items.map((item) => buildItem(item, settings, halve, offset)),
  };
}

/**
 * Builds one item: halves volume when `halve` is set, resolves rep targets
 * against the athlete's maxes, and applies the weekly increase to items that
 * declare one.
 */
function buildItem(item: BlockItem, settings: TrainingSettings, halve: boolean, offset: number): ItemView {
  // Only items with a `weeklyIncrease` (the EMOMs) grow week to week. The
  // field is descriptive text and is not parsed: its presence means "+1 rep
  // per week", and `offset` is the number of weeks since the phase began.
  const increase = item.weeklyIncrease === undefined ? 0 : offset;

  const keptSets = halve ? item.sets.slice(0, Math.ceil(item.sets.length / 2)) : item.sets;

  return {
    exercise: item.exercise,
    format: item.format,
    sets: keptSets.map((set) => ({
      target: set.reps && resolveReps(set.reps, item.exerciseId, settings, increase),
      load: set.load,
    })),
    target: item.reps && resolveReps(item.reps, item.exerciseId, settings, increase),
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
 * Percent-of-max targets also carry a `basis` so the UI can explain them.
 */
function resolveReps(reps: Reps, exerciseId: string, settings: TrainingSettings, increase: number): RepTarget {
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
      const basis: MaxBasis = { percentMin: reps.min, percentMax: reps.max, max, weeklyIncrease: increase };
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
