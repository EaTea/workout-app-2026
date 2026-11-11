import type { Range } from "../program/model";
import { MAX_INTERVAL_REST_SECONDS, MAX_INTERVAL_WORK_SECONDS, MAX_REST_SECONDS, MIN_TIMER_SECONDS } from "../program/model";
import type { ItemView } from "../program/schedule";
import { itemDisplayName } from "../program/rotation";
import { formatRepTarget } from "../ui/format";
import { createTimerPlan, type TimerPlan, type TimerSegment } from "./engine";

/**
 * Builders that turn what the schedule computed for one exercise into a
 * `TimerPlan` the shared timer view (ui/timerView.ts) can run.
 *
 *   ItemView (from buildSession, deload already applied)
 *        │  buildEmomPlan                      │ defaultIntervalSettings
 *        ▼                                     ▼
 *   TimerPlan: N one-minute "minute"       IntervalSettings {rounds, workSec, restSec}
 *   segments, each labelled with its            │ (Ed may adjust before Start)
 *   target                                      │ buildIntervalPlan
 *                                               ▼
 *                                  TimerPlan: work, rest, work, ... work
 *
 * No arithmetic happens here: minutes and reps come straight from the view,
 * and rep text comes from the same formatter the Today screen uses, so the
 * timer can never disagree with the row it was started from.
 */

/** Seconds in one EMOM minute. */
const EMOM_MINUTE_SECONDS = 60;

/**
 * Builds the plan for an EMOM item: one 60-second segment per minute, titled
 * e.g. "Pull-ups EMOM · 5 min". Called by the Start EMOM button on Today.
 * Throws if the item is not an EMOM with a positive number of minutes (the
 * button is only drawn for such items, so this signals a programming error).
 */
export function buildEmomPlan(item: ItemView): TimerPlan {
  const minutes = item.minutes;
  if (item.format !== "emom" || minutes === undefined) {
    throw new Error(`${item.exercise.name} is not an EMOM item`);
  }

  const label = describeEmomTarget(item);
  const segments: TimerSegment[] = [];
  for (let round = 1; round <= minutes; round += 1) {
    segments.push({ phase: "minute", durationSec: EMOM_MINUTE_SECONDS, round, totalRounds: minutes, label });
  }

  return createTimerPlan(`${itemDisplayName(item)} EMOM · ${minutes} min`, segments);
}

/** The per-minute instruction: "Target 6–7 reps", or a prompt to set a max when the target needs one. */
function describeEmomTarget(item: ItemView): string {
  if (item.target === undefined) return "Go";
  if (item.target.kind === "needsMax") return "Set your max for a target";
  return `Target ${formatRepTarget(item.target)} reps`;
}

// ---------------------------------------------------------------------------
// Heavy bag intervals
// ---------------------------------------------------------------------------

/** The numbers an interval timer runs on; the setup row on the timer lets Ed change them before Start. */
export interface IntervalSettings {
  rounds: number;
  workSec: number;
  restSec: number;
}

/** Sensible limits for the setup steppers; `buildIntervalPlan` enforces the minimums. */
export const INTERVAL_LIMITS = {
  minRounds: 1,
  maxRounds: 12,
  minSeconds: MIN_TIMER_SECONDS,
  maxWorkSec: MAX_INTERVAL_WORK_SECONDS,
  maxRestSec: MAX_INTERVAL_REST_SECONDS,
  secondsStep: 5,
} as const;

/**
 * The starting numbers for an interval item (PLAN section 4, rule 4): the top
 * of the rounds range (a deload already collapsed it to one value), the top of
 * the work range and the bottom of the rest range. Called when Today opens the
 * heavy bag timer. Throws if the item lacks rounds, work or rest times.
 */
export function defaultIntervalSettings(item: ItemView): IntervalSettings {
  if (item.format !== "interval" || !item.rounds || !item.workSec || !item.restSec) {
    throw new Error(`${item.exercise.name} is not an interval item`);
  }
  return { rounds: item.rounds.max, workSec: item.workSec.max, restSec: item.restSec.min };
}

/**
 * Builds the plan for an interval item with the given (possibly adjusted)
 * settings: work, rest, work, ... ending on a work segment (no trailing rest).
 * Titled e.g. "Heavy bag · 5 rounds". Called first with the defaults and again
 * each time Ed changes a stepper on the timer's setup row. Throws on rounds
 * below 1 or work/rest below 5 seconds.
 */
export function buildIntervalPlan(item: ItemView, settings: IntervalSettings): TimerPlan {
  const { rounds, workSec, restSec } = settings;
  if (!Number.isInteger(rounds) || rounds < INTERVAL_LIMITS.minRounds) throw new Error("Rounds must be at least 1");
  if (workSec < INTERVAL_LIMITS.minSeconds || restSec < INTERVAL_LIMITS.minSeconds) {
    throw new Error(`Work and rest must be at least ${INTERVAL_LIMITS.minSeconds} seconds`);
  }

  const workLabel = item.note ?? "Go hard";
  const segments: TimerSegment[] = [];
  for (let round = 1; round <= rounds; round += 1) {
    segments.push({ phase: "work", durationSec: workSec, round, totalRounds: rounds, label: workLabel });
    if (round < rounds) {
      segments.push({ phase: "rest", durationSec: restSec, round, totalRounds: rounds, label: "Rest" });
    }
  }

  const roundsText = rounds === 1 ? "1 round" : `${rounds} rounds`;
  return createTimerPlan(`${shortExerciseName(itemDisplayName(item))} · ${roundsText}`, segments);
}

/** "Heavy bag finisher" -> "Heavy bag": the title (and Today's timer dialog name) drops the word "finisher". */
export function shortExerciseName(name: string): string {
  return name.replace(/ finisher$/i, "");
}

// ---------------------------------------------------------------------------
// Rest between sets
// ---------------------------------------------------------------------------

/** Sensible limits for the rest timer's seconds stepper; `buildRestPlan` enforces the minimum. */
export const REST_LIMITS = {
  minSeconds: MIN_TIMER_SECONDS,
  maxSeconds: MAX_REST_SECONDS,
  secondsStep: 5,
} as const;

/**
 * The starting rest for a prescribed range (PLAN section 4, rule 4): the low
 * end, so it can be lengthened if more is needed. A fixed rest (min equals max)
 * gives that number. Called when Today opens a rest timer.
 */
export function defaultRestSeconds(range: Range): number {
  return range.min;
}

/**
 * Builds the plan for a rest between sets: one "rest" segment, titled e.g.
 * "Rest · Med ball slams". Its finish cue (see timer/cues.ts) is the signal
 * to start the next set. `exerciseName` may also be a phrase such as
 * "Between pairs" for a superset block. Called first with the default and
 * again each time Ed changes the seconds stepper. Throws below 5 seconds.
 */
export function buildRestPlan(seconds: number, exerciseName: string): TimerPlan {
  if (!Number.isFinite(seconds) || seconds < REST_LIMITS.minSeconds) {
    throw new Error(`Rest must be at least ${REST_LIMITS.minSeconds} seconds`);
  }

  const segment: TimerSegment = {
    phase: "rest",
    durationSec: seconds,
    round: 1,
    totalRounds: 1,
    label: "Next set when it ends",
  };
  return createTimerPlan(`Rest · ${exerciseName}`, [segment]);
}
