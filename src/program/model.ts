/**
 * Internal program model: what the rest of the app (schedule, UI) works with.
 *
 * `parseProgram` in `parse.ts` builds these from the wire types in `wire.ts`.
 * Everything optional in the JSON is normalised here so consumers don't have
 * to handle "number or tuple" or "number or array" unions themselves.
 */

/** Days of the week, as spelled in program.json. */
export type Weekday = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";

/** Every weekday, in calendar order starting on Monday. */
export const WEEKDAYS: readonly Weekday[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

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
 * entries and Saturday's calf raise maps one-to-one. That keeps deload
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
  day: Weekday;
  focus: string;
  targetMinutes: number;
  blocks: Block[];
}

/** One phase of the progression (Base, Deload, ...). */
export interface ProgressionPhase {
  weeks: number[];
  phase: string;
  changes: string[];
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
  restDay: Weekday;
  sessionOrder: string[];
  rules: string[];
  exercises: Record<string, Exercise>;
  /** Training days keyed by weekday; the rest day has no entry. */
  days: Partial<Record<Weekday, Day>>;
  progression: ProgressionPhase[];
  coreProgressions: Record<string, string>;
  warmupRotation: WarmupRotation;
  fatigueCheck: FatigueCheck;
}
