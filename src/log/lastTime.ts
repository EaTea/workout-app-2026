import type { DayNumber, Program } from "../program/model";
import type { LoggedSession, LoggedSet, WorkoutLog } from "./model";
import { sessionDates } from "./operations";
import { setDay } from "./setDay";

/**
 * "Last time" lookup (rule 8): what the athlete did the previous time an
 * exercise was trained in the same slot. The log screen and Today rows show
 * it as a hint ("Last time (2 Nov): 6 × 6 at 6 kg", formatted in
 * `ui/format.ts`), and `itemSets.ts` uses its sets to pre-fill the steppers.
 *
 *   WorkoutLog + Program ──▶ findLastTime(query, beforeDate) ──▶ LastTime | undefined
 *
 * A "slot" is a day number plus a block type. The same exercise can be trained
 * as heavy main work on one day and as an easy mini-dose on another (the calf
 * raise, the pull-up), and those must never stand in for each other. The log
 * stores a block position, not a block type, so the type of an old set is
 * looked up in the program: `program.days[setDay(session, set)].blocks[position - 1]`,
 * where `setDay` is the set's own day or, for sets saved without one, the
 * session's day.
 *
 *   session 2026-11-09          set day   block type of (day, position)
 *     ├─ pull_up #1             1         program.days[1].blocks[1]
 *     └─ split_squat #1         2         program.days[2].blocks[1]   (a second day on the same date)
 */

/** The most recent earlier session's sets of one exercise. */
export interface LastTime {
  /** Program date "YYYY-MM-DD" of that session. */
  date: string;

  /** The sets of the exercise from that session (one block only), ordered by set number. Never empty. */
  sets: LoggedSet[];
}

/** What to look up: the item being shown and the slot it sits in today. */
export interface LastTimeQuery {
  exerciseId: string;

  /** Program day number (1-7) of the session being shown. */
  dayNumber: DayNumber;

  /** Type of the block the item is in today, e.g. "mainStrength" or "miniDose". */
  blockType: string;
}

/**
 * Finds last time for an item (rule 8). Candidates are sessions strictly
 * before `beforeDate` (so a `?date=` preview of an older day never sees "the
 * future") with at least one logged set of the exercise in a block of the
 * query's type. The choice is:
 *  1. the most recent candidate with at least one set whose effective day
 *     (`setDay`) equals the query's day number (last week's same slot); only
 *     those sets are considered, else
 *  2. the most recent candidate on any day, else
 *  3. undefined.
 *
 * A set whose block type cannot be resolved (it has no day of its own and the session has no stored day,
 * or the program no longer has that day, block or exercise) counts as "no
 * match", never as a guess.
 *
 * If a session has the exercise in more than one block of the type, the block
 * with the most logged sets is returned (a tie goes to the lower block
 * position). Sets of different blocks are never mixed, because "set 2" only
 * means something within one block.
 */
export function findLastTime(log: WorkoutLog, program: Program, query: LastTimeQuery, beforeDate: string): LastTime | undefined {
  // Program dates are "YYYY-MM-DD", so plain string comparison is chronological.
  const earlierDatesNewestFirst = sessionDates(log).filter((date) => date < beforeDate);

  return (
    firstLastTimeAmong(log, program, query, earlierDatesNewestFirst, query.dayNumber) ??
    firstLastTimeAmong(log, program, query, earlierDatesNewestFirst)
  );
}

/**
 * The first date (they are newest first) whose session has matching sets,
 * as a `LastTime`. Only used by `findLastTime`, once per preference tier.
 * With `onlyDay`, only sets whose effective day is that day are considered
 * (the "same slot" tier); without it, sets of any day count.
 */
function firstLastTimeAmong(log: WorkoutLog, program: Program, query: LastTimeQuery, datesNewestFirst: string[], onlyDay?: DayNumber): LastTime | undefined {
  for (const date of datesNewestFirst) {
    const session = log.sessions[date];
    if (session === undefined) continue;

    const matchingSets = session.sets.filter(
      (set) =>
        (onlyDay === undefined || setDay(session, set) === onlyDay) &&
        set.exerciseId === query.exerciseId &&
        blockTypeOfLoggedSet(program, session, set) === query.blockType,
    );
    if (matchingSets.length > 0) return { date, sets: setsOfLargestBlock(matchingSets) };
  }

  return undefined;
}

/**
 * The type of the block a logged set was done in, resolved from the program
 * for the set's effective day (`setDay`). Undefined when that cannot be done
 * (no day on the set or session, no such day or block in the program now, or the exercise is
 * not in that block any more), which callers treat as "no match".
 */
function blockTypeOfLoggedSet(program: Program, session: LoggedSession, set: LoggedSet): string | undefined {
  const day = setDay(session, set);
  if (day === undefined) return undefined;

  const block = program.days[day]?.blocks[set.blockPosition - 1];
  const isExerciseInBlock = block?.items.some((item) => item.exerciseId === set.exerciseId) ?? false;
  return isExerciseInBlock ? block?.type : undefined;
}

/**
 * From sets of one exercise spread over several blocks, keeps the block with
 * the most sets (ties: lowest block position) and orders it by set number.
 * Only used by `firstLastTimeAmong`; `sets` must not be empty.
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
