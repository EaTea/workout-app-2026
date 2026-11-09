/**
 * Internal program model: what the rest of the app (schedule, UI) works with.
 *
 * `parseProgram` in `parse.ts` builds these from the wire types in `wire.ts`.
 * Everything optional in the JSON is normalised here so consumers don't have
 * to handle "number or tuple" or "number or array" unions themselves.
 */

/**
 * A program day number, 1 to 7. The app counts days from the start date
 * (start date = day 1 of week 1), so day numbers are the only way sessions
 * are named. Validity (a whole number 1-7) is checked by the parser; the type
 * is a plain number so it can key `Program.days`.
 */
export type DayNumber = number;

/** The number of days in one program week (days 1-6 train, the rest day is day 7 in the shipped file). */
export const DAYS_PER_WEEK = 7;

/** An inclusive numeric range. A single value `n` is represented as min === max === n. */
export interface Range {
  min: number;
  max: number;
}

/**
 * How many reps to do.
 *  - fixed: exactly `count` (e.g. 6)
 *  - range: `min` to `max` reps (e.g. "12-15")
 *  - percentOfMax: a fraction of the athlete's tested max (0.40 = 40%); the
 *    schedule step turns this into a rep count
 *  - text: free text shown as written ("easy, ~50% effort", "8 each direction")
 */
export type Reps =
  | { kind: "fixed"; count: number }
  | { kind: "range"; min: number; max: number }
  | { kind: "percentOfMax"; min: number; max: number }
  | { kind: "text"; text: string };

/**
 * One set. Sets are always stored as a list of these, one per set, rather than
 * a count plus a template: `sets: 3, reps: "10-12"` becomes three identical
 * entries and the calf raise maps one-to-one. That keeps deload
 * halving a single `slice(0, Math.ceil(n / 2))` with no special cases for
 * per-set prescriptions.
 */
export interface SetPrescription {
  reps?: Reps;
  load?: string;
}

/** How an item or block is performed. */
export type Format = "straight sets" | "emom" | "interval" | "superset";

/** Where the claim for an exercise comes from. */
export type Evidence = { kind: "url"; url: string } | { kind: "coachingPractice" };

/** Library entry for one exercise (the top-level `exercises` object). */
export interface Exercise {
  id: string;
  name: string;
  category: string;
  cues: string[];
  alternative?: string;
  evidence: Evidence;
  /** Ordered easier-to-harder variations, empty if none. */
  progression: string[];
  /** True if the athlete's max reps is tested (pull-ups, dips). */
  maxTested: boolean;
}

/** One exercise inside a block, with its exercise-library entry resolved. */
export interface BlockItem {
  exerciseId: string;
  exercise: Exercise;
  format: Format;
  /** Per-set prescriptions; empty for items driven by time (EMOM, interval) or by `reps` alone (warm-ups). */
  sets: SetPrescription[];
  /** Item-level reps, for items without `sets` (warm-ups, EMOM). */
  reps?: Reps;
  restSec?: Range;
  /** EMOM length in minutes. */
  minutes?: number;
  /** Interval rounds. */
  rounds?: Range;
  workSec?: Range;
  /** Timed holds, e.g. side plank. */
  durationSec?: number;
  perSide: boolean;
  optional: boolean;
  load?: string;
  note?: string;
  tempo?: string;
  /**
   * Descriptive progression rule as written in program.json ("+1 rep per
   * minute"). Free text: it is shown as the rule on the exercise sheet and
   * never parsed. The schedule treats its presence as "adds 1 rep per week
   * during a non-deload phase".
   */
  weeklyIncrease?: string;
}

/** One block of a session (warm-up, explosive, ...). */
export interface Block {
  type: string;
  format: Format;
  /** Superset rounds. */
  rounds?: Range;
  minutes?: number;
  restSecBetweenPairs?: Range;
  items: BlockItem[];
}

/** One training day. Blocks are in the order written in the file. */
export interface Day {
  /** This day's number within the program week (1-7). */
  day: DayNumber;
  focus: string;
  targetMinutes: number;
  blocks: Block[];
}

/**
 * Timer changes a phase makes to the program's seconds, in whole seconds
 * (negative shortens). A key left out of program.json is 0 here.
 */
export interface TimerAdjustments {
  /** Added to both ends of every interval item's work range. */
  intervalWorkSec: number;
  /** Added to both ends of every core block's rest-between-pairs range. */
  coreRestBetweenPairsSec: number;
}

/** One phase of the progression (Base, Deload, ...). */
export interface ProgressionPhase {
  weeks: number[];
  phase: string;
  changes: string[];
  /** True in a retest week (week 8): EMOM targets use the current saved max, no weekly increase and no hold. Defaults to false. */
  retest: boolean;
  /** Timer changes for this phase; absent when the phase doesn't adjust any. */
  timerAdjustments?: TimerAdjustments;
}

/** Warm-up rotation reminder data. */
export interface WarmupRotation {
  everyWeeks: number;
  swaps: { out: string; in: string }[];
  alsoAvailable: string[];
}

/** Weekly fatigue check data. */
export interface FatigueCheck {
  frequency: string;
  tests: string[];
  rule: string;
  lowerBackRule: string;
}

/** The whole program. */
export interface Program {
  name: string;
  goal: string;
  lengthWeeks: number;
  restDay: DayNumber;
  sessionOrder: string[];
  rules: string[];
  exercises: Record<string, Exercise>;
  /** Training days keyed by day number (1-7); the rest day has no entry. */
  days: Partial<Record<DayNumber, Day>>;
  progression: ProgressionPhase[];
  coreProgressions: Record<string, string>;
  warmupRotation: WarmupRotation;
  fatigueCheck: FatigueCheck;
}

/**
 * A non-fatal problem found while parsing program.json (currently: a field the
 * app doesn't recognise). `path` is the same style as parse errors, e.g.
 * `exercises.pull_up.notes`. Shown to Ed in the Today screen's warning banner.
 */
export interface ProgramWarning {
  path: string;
  message: string;
  /** The known field this one is probably a misspelling of, e.g. "weeklyIncrease" for "weeklyIncreese". */
  suggestion?: string;
}

// ---------------------------------------------------------------------------
// Timer bounds shared by the schedule and the timers
// ---------------------------------------------------------------------------

/** Shortest work or rest a timer segment can have; the schedule never adjusts below it and the timers refuse less. Dependency-free so program/ need not import timer/. */
export const MIN_TIMER_SECONDS = 5;

/** Largest work time the heavy bag stepper offers; adjusted work ranges are capped here so the timer can always start from them. */
export const MAX_INTERVAL_WORK_SECONDS = 180;

/** Largest interval rest the heavy bag stepper offers. */
export const MAX_INTERVAL_REST_SECONDS = 180;

/** Largest rest the rest-timer stepper offers; the cap for adjusted rest between pairs. */
export const MAX_REST_SECONDS = 300;
