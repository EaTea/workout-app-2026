/**
 * Wire types: the exact JSON shape of `public/program.json`, unions and all.
 *
 * These types exist only so `parse.ts` can describe what it expects to read.
 * No other module may import them (CLAUDE.md section 6); the rest of the app
 * uses the normalised types in `model.ts`.
 *
 *   program.json --(fetch)--> ProgramWire --parseProgram()--> Program
 */

/** A single number, or a `[min, max]` tuple (e.g. `restSec: [30, 45]`). */
export type NumberOrRangeWire = number | [number, number];

/** Reps are a number (6), or free text ("12-15", "easy, ~50% effort", "8 each direction"). */
export type RepsWire = number | string;

/** One entry of a per-set `sets` array (the calf raise). */
export interface SetWire {
  reps: RepsWire;
  load?: string;
}

/** `sets` is either a count (3) or an explicit list of per-set prescriptions. */
export type SetsWire = number | SetWire[];

/** Either a URL to a study, or the literal text "coaching practice". */
export type EvidenceWire = string;

/** The block-level and item-level `format` values that appear in the file. */
export type FormatWire = "superset" | "emom" | "interval";

/** One entry of the top-level `exercises` object (keyed by exercise id). */
export interface ExerciseWire {
  name: string;
  category: string;
  cues?: string[];
  alternative?: string;
  evidence: EvidenceWire;
  progression?: string[];
  maxTested?: boolean;
}

/**
 * An item's optional household-kit swap (`noEquipment`). It holds only what
 * the swap changes: its own exercise and dose text. Everything structural
 * (sets, rest, format, minutes, rounds, workSec, perSide, optional,
 * weeklyIncrease, sameEveryWeek) is kept from the original item, so those
 * keys are parse errors here. `load`, `note` and `tempo` are the swap's own
 * and never carried over from the original.
 */
export interface NoEquipmentSwapWire {
  /** A key of `exercises`; must not be max-tested or the item's own exercise. */
  exercise: string;
  /** Required when the original item's reps are a percentage of a tested max. */
  reps?: RepsWire;
  durationSec?: number;
  load?: string;
  note?: string;
  tempo?: string;
}

/** One exercise inside a block. `exercise` is a key of `exercises`. */
export interface ItemWire {
  exercise: string;
  format?: FormatWire;
  sets?: SetsWire;
  reps?: RepsWire;
  /** Fraction of the athlete's tested max, e.g. 0.40 or [0.40, 0.50]. */
  repsPctOfMax?: NumberOrRangeWire;
  restSec?: NumberOrRangeWire;
  minutes?: number;
  rounds?: NumberOrRangeWire;
  workSec?: NumberOrRangeWire;
  durationSec?: number;
  perSide?: boolean;
  optional?: boolean;
  /** True opts the item out of the phase timer adjustments and the deload halving (see `BlockItem.sameEveryWeek`). */
  sameEveryWeek?: boolean;
  load?: string;
  note?: string;
  tempo?: string;
  weeklyIncrease?: string;
  /** Optional household-kit swap for this item; see `NoEquipmentSwapWire`. */
  noEquipment?: NoEquipmentSwapWire;
  /**
   * The program weeks the item runs in: a non-empty list of whole numbers
   * from 1 to `program.lengthWeeks`, no repeats. Absent means every week.
   * The model holds it as `BlockItem.runsInWeeks`.
   */
  weeks?: number[];
}

/** One block of a day (warmup, explosive, mainStrength, miniDose, core, finisher). */
export interface BlockWire {
  type: string;
  format?: FormatWire;
  rounds?: NumberOrRangeWire;
  minutes?: number;
  restSecBetweenPairs?: NumberOrRangeWire;
  items: ItemWire[];
}

/** One training day. */
export interface DayWire {
  /** Program day number, 1-6 in the shipped file (7 is the rest day). */
  day: number;
  focus: string;
  targetMinutes: number;
  blocks: BlockWire[];
}

/**
 * Optional per-phase timer changes, in whole seconds (negative allowed).
 * Either key may be left out, which means "no change".
 */
export interface TimerAdjustmentsWire {
  /** Added to every interval item's `workSec` range (heavy bag). */
  intervalWorkSec?: number;
  /** Added to every core block's `restSecBetweenPairs` range. */
  coreRestBetweenPairsSec?: number;
}

/** One phase of the 8-week progression. */
export interface ProgressionPhaseWire {
  weeks: number[];
  phase: string;
  changes: string[];
  /** True in a retest week: EMOM targets use the current max with no weekly increase or hold. */
  retest?: boolean;
  /** Optional timer defaults changes for this phase (power endurance). */
  timerAdjustments?: TimerAdjustmentsWire;
}

/** The `program` object: name, length and session-wide rules. */
export interface ProgramInfoWire {
  name: string;
  goal: string;
  lengthWeeks: number;
  restDay: number;
  sessionOrder: string[];
  rules: string[];
  /** Optional: short safety notes a program shows before anyone starts it (each non-empty). */
  safety?: string[];
}

/** One warm-up swap: replace exercise id `out` with free text `in`. */
export interface WarmupSwapWire {
  out: string;
  in: string;
}

/** Warm-up rotation reminder data. */
export interface WarmupRotationWire {
  everyWeeks: number;
  swaps: WarmupSwapWire[];
  alsoAvailable: string[];
}

/** Weekly fatigue check data. */
export interface FatigueCheckWire {
  frequency: string;
  tests: string[];
  rule: string;
  lowerBackRule: string;
}

/**
 * Optional `combining` section: which two days Today may offer to merge into
 * one session. Each pair is `[lowerDay, higherDay]`; `parseProgram` checks
 * every pair (unusable ones become warnings and are ignored), so entries are
 * `unknown` here.
 */
export interface CombiningWire {
  pairs: unknown[];
}

/** The whole `program.json` document. */
export interface ProgramWire {
  program: ProgramInfoWire;
  exercises: Record<string, ExerciseWire>;
  days: DayWire[];
  progression: ProgressionPhaseWire[];
  /** Optional: a program without core progressions simply omits the section. */
  coreProgressions?: Record<string, string>;
  /** Optional: omitted by programs that never swap warm-ups. */
  warmupRotation?: WarmupRotationWire;
  /** Optional: omitted by programs without a weekly fatigue check-in. */
  fatigueCheck?: FatigueCheckWire;
  /** Optional: omitted by programs that never offer combining two days (Steady Strength). */
  combining?: CombiningWire;
}
