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

/**
 * The body areas an injury can be flagged for. One list so a new area is a
 * one-line change here: the parser checks `loads`, `injury` and
 * `injurySessions` keys against it.
 */
export const INJURY_AREAS = ["shoulder"] as const;

/** One injured area, e.g. "shoulder". */
export type InjuryArea = (typeof INJURY_AREAS)[number];

/** The levels an exercise can load an area at; anything else means "not tagged". */
export const INJURY_LOAD_LEVELS = ["avoid", "caution"] as const;

/** How much an exercise loads an injured area: "avoid" leaves it out, "caution" keeps it as pain-free only. */
export type InjuryLoadLevel = (typeof INJURY_LOAD_LEVELS)[number];

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
  /** How much the exercise loads each injured area; undefined when the file tags none. Untagged areas are simply absent. */
  loads?: Partial<Record<InjuryArea, InjuryLoadLevel>>;
}

/**
 * An item's optional "no equipment" swap: a household-kit replacement the
 * person can choose per exercise before a session. It carries only what the
 * swap changes (its exercise and dose text). Sets, rest, format, minutes,
 * rounds, workSec, perSide, optional, weeklyIncrease and sameEveryWeek always
 * come from the original item, and the original's load, note and tempo never
 * carry over. The parser guarantees the swap is not max-tested, is not the
 * item's own exercise, and has its own `reps` when the original is max-based.
 * The schedule builds its view for the week (`applyNoEquipmentSwap`,
 * `ItemView.noEquipment`), which the exercise sheet shows; PR 19 adds the
 * tick on Today that switches a row over to it.
 */
export interface NoEquipmentSwap {
  /** The swap's library entry, resolved from its id. */
  exercise: Exercise;
  reps?: Reps;
  durationSec?: number;
  load?: string;
  note?: string;
  tempo?: string;
}

/**
 * An item's stand-in while one area is injured. Same shape and guarantees as
 * the no-equipment swap (own exercise and dose text; sets, rest and format
 * kept from the original item), because the parser validates both with one
 * function.
 */
export type InjuryStandIn = NoEquipmentSwap;

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
  /** Seconds of gear-up break before an interval timer's round 1; absent or 0 means none. A no-equipment swap never inherits it. */
  gearUpSec?: number;
  /** Timed holds, e.g. side plank. */
  durationSec?: number;
  perSide: boolean;
  optional: boolean;
  /**
   * True when the item is prescribed identically in every week: the schedule
   * skips the phase's timer adjustments (e.g. power endurance's +5s work) and
   * the deload halving of its sets, minutes and rounds. Absent in
   * program.json means false.
   */
  sameEveryWeek: boolean;
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
  /** The item's optional household-kit swap; undefined when the file has none. */
  noEquipment?: NoEquipmentSwap;
  /** Stand-ins keyed by injured area; undefined when the file has none. */
  injury?: Partial<Record<InjuryArea, InjuryStandIn>>;
  /**
   * The program weeks this item runs in ("everyWeek" when program.json has no
   * `weeks` on it, which is every item today). The schedule drops the item
   * from a session whose week is not in the set, before any deload halving.
   * Lookups of logged sets (Last time, Progress, History) deliberately use
   * the whole program and ignore this, so a set logged in week 2 still finds
   * its item in week 4.
   */
  runsInWeeks: ReadonlySet<number> | "everyWeek";
}

/** One block of a session (warm-up, explosive, ...). */
export interface Block {
  type: string;
  format: Format;
  /** Superset rounds. */
  rounds?: Range;
  minutes?: number;
  restSecBetweenPairs?: Range;
  /**
   * Present when the athlete may skip the whole block for a session (the heavy
   * bag finisher). `label` is the short name used in "<label> today?". Distinct
   * from `BlockItem.optional`, which only means "doesn't hold up completion".
   */
  optional?: OptionalBlock;
  items: BlockItem[];
}

/** The block-level optional marker in its internal form. */
export interface OptionalBlock {
  label: string;
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
 * The session Today shows for an injured area when the flag leaves a training
 * day with no main block. Its blocks are ordinary `Block`s, but their items
 * never carry `noEquipment` or `injury` (the parser refuses them).
 */
export interface InjurySession {
  name: string;
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
  /** Safety notes the program asks people to read before starting; empty when the file has none (Explosive Endurance). */
  safety: string[];
  exercises: Record<string, Exercise>;
  /** Training days keyed by day number (1-7); the rest day has no entry. */
  days: Partial<Record<DayNumber, Day>>;
  progression: ProgressionPhase[];
  /** Empty when the program file has no `coreProgressions` section. */
  coreProgressions: Record<string, string>;
  /** Undefined when the program has no warm-up rotation: warm-ups are never swapped and no rotation card shows. */
  warmupRotation?: WarmupRotation;
  /** Undefined when the program has no fatigue check: no weekly check-in card, no drop banner, no broad jump on the retest card. */
  fatigueCheck?: FatigueCheck;
  /**
   * The day pairs Today may combine into one session, each `[earlierDay,
   * laterDay]` with the later day exactly one after the earlier, both
   * training days. Empty when the file has no `combining` section (Steady
   * Strength), which means combining is never offered. Pairs the parser
   * rejected are not here (they are `ProgramWarning`s).
   */
  combinePairs: readonly (readonly [DayNumber, DayNumber])[];
  /** Area-free sessions keyed by injured area; undefined when the file has no `injurySessions` section. */
  injurySessions?: Partial<Record<InjuryArea, InjurySession>>;
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

/** Largest gear-up break (before round 1 of an interval timer) the stepper offers; the parser rejects a larger `gearUpSec`. */
export const MAX_GEAR_UP_SECONDS = 300;

/** Largest rest the rest-timer stepper offers; the cap for adjusted rest between pairs. */
export const MAX_REST_SECONDS = 300;
