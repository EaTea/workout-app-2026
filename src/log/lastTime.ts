import type { LoggedSet, WorkoutLog } from "./model";
import { sessionDates } from "./operations";

/**
 * "Last time" lookup (rule 8): what the athlete did the previous time an
 * exercise was trained. The log screen and Today rows show it as a hint
 * ("Last time (2 Nov): 6 × 6 at 6 kg", formatted in `ui/format.ts`), and
 * `itemSets.ts` uses its sets to pre-fill the steppers.
 *
 *   WorkoutLog ──▶ findLastTime(exerciseId, beforeDate) ──▶ LastTime | undefined
 */

/** The most recent earlier session's sets of one exercise. */
export interface LastTime {
  /** Program date "YYYY-MM-DD" of that session. */
  date: string;

  /** The sets of the exercise from that session (one block only), ordered by set number. Never empty. */
  sets: LoggedSet[];
}

/**
 * Finds the most recent session strictly before `beforeDate` that has at least
 * one logged set of `exerciseId`, in any block. Same-day and later sessions are
 * ignored, so a `?date=` preview of an older day never sees "the future".
 *
 * An exercise can appear in more than one block of a day. Then the block with
 * the most logged sets is the one returned (it is the main work, not a
 * mini-dose); a tie goes to the lower block position (the one that comes
 * first in the session). Sets of different blocks are never mixed, because
 * "set 2" only means something within one block.
 *
 * Returns undefined when the exercise was never logged on an earlier date.
 */
export function findLastTime(log: WorkoutLog, exerciseId: string, beforeDate: string): LastTime | undefined {
  // Program dates are "YYYY-MM-DD", so plain string comparison is chronological.
  const earlierDatesNewestFirst = sessionDates(log).filter((date) => date < beforeDate);

  for (const date of earlierDatesNewestFirst) {
    const setsOfExercise = (log.sessions[date]?.sets ?? []).filter((set) => set.exerciseId === exerciseId);
    if (setsOfExercise.length === 0) continue;

    return { date, sets: setsOfLargestBlock(setsOfExercise) };
  }

  return undefined;
}

/**
 * From sets of one exercise spread over several blocks, keeps the block with
 * the most sets (ties: lowest block position) and orders it by set number.
 * Only used by `findLastTime`; `sets` must not be empty.
 */
function setsOfLargestBlock(sets: LoggedSet[]): LoggedSet[] {
  const setsByBlock = new Map<number, LoggedSet[]>();
  for (const set of sets) {
    setsByBlock.set(set.blockPosition, [...(setsByBlock.get(set.blockPosition) ?? []), set]);
  }

  // Walk the blocks first to last; a later block replaces the choice only if strictly larger.
  const blocksFirstToLast = [...setsByBlock.entries()].sort(([firstPosition], [secondPosition]) => firstPosition - secondPosition);

  let chosenSets: LoggedSet[] = [];
  for (const [, setsOfBlock] of blocksFirstToLast) {
    if (setsOfBlock.length > chosenSets.length) chosenSets = setsOfBlock;
  }

  return chosenSets.sort((first, second) => first.setNumber - second.setNumber);
}

/**
 * The last-time set to pre-fill set `setNumber` from: the same set number, or
 * (when last time had fewer sets) its last set. Undefined without a last time.
 * Used by `itemSets.prefillForSet`.
 */
export function lastTimeSetFor(lastTime: LastTime | undefined, setNumber: number): LoggedSet | undefined {
  if (lastTime === undefined) return undefined;

  return lastTime.sets.find((set) => set.setNumber === setNumber) ?? lastTime.sets[lastTime.sets.length - 1];
}
