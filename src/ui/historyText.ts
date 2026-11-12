import type { DayNumber, Program } from "../program/model";
import { setDay } from "../log/setDay";
import type { LoggedSession, LoggedSet } from "../log/model";
import { itemTracksReps, setNounFor, setWord } from "../log/itemSets";
import { isExerciseLoggedForItem } from "../program/noEquipment";
import { performedAsName } from "../program/rotation";
import { formatShortDate } from "./format";

/**
 * Pure text helpers for the History screen (`ui/history.ts`): the session
 * card header and the names/nouns that depend on program.json. Kept free of
 * the DOM so they are unit tested directly.
 */

/** Separator between header parts, same as the Today kicker. */
const SEPARATOR = " · ";

/**
 * Header of a session card, e.g. "9 Nov · Week 2 · Day 1 · Upper: pull".
 * Week and day come from what was stored when the session was first logged and
 * are left out when absent. The day title is the program's focus for that day
 * number, left out when the program has no such day (it was edited since).
 */
export function formatSessionHeader(session: LoggedSession, program: Program): string {
  const parts = [formatShortDate(session.date)];

  if (session.programWeek !== undefined) parts.push(`Week ${session.programWeek}`);
  if (session.day !== undefined) {
    parts.push(`Day ${session.day}`);

    const dayTitle = program.days[session.day]?.focus;
    if (dayTitle !== undefined) parts.push(dayTitle);
  }

  return parts.join(SEPARATOR);
}

/** The exercise's display name from the program's library; an id no longer in program.json is shown as is. */
export function exerciseDisplayName(program: Program, exerciseId: string): string {
  return program.exercises[exerciseId]?.name ?? exerciseId;
}

/**
 * The name a logged exercise was performed as: the rotated-in name for a
 * warm-up logged in a swapped week (using the week stored on the session and
 * the program's block type at that position), else `exerciseDisplayName`.
 * Used for the History rows so they match what Today showed that day.
 * `day` is the set's own day (`ExerciseGroup.day`); when omitted the session's day is used.
 */
export function performedExerciseName(program: Program, session: LoggedSession, blockPosition: number, exerciseId: string, day: DayNumber | undefined = session.day): string {
  const blockType = day === undefined ? undefined : program.days[day]?.blocks[blockPosition - 1]?.type;
  return performedAsName(program, exerciseId, session.programWeek, blockType);
}

/**
 * Looks up the item a logged exercise belonged to (the program's block at that
 * position of the set's day, then the exercise in it). Undefined when the
 * program no longer has that day, block or exercise. `day` is the set's
 * effective day (`setDay`).
 */
function findProgramItem(program: Program, day: DayNumber | undefined, blockPosition: number, exerciseId: string) {
  if (day === undefined) return undefined;

  return program.days[day]?.blocks[blockPosition - 1]?.items.find((item) => isExerciseLoggedForItem(item, exerciseId));
}

/**
 * The singular noun for one tick of a logged exercise ("set", "round" or
 * "minute"), used when its sets have no reps ("5 rounds"). Falls back to "set"
 * when the program no longer describes the exercise. `day` is the set's own
 * day; when omitted the session's day is used.
 */
export function loggedSetNoun(program: Program, session: LoggedSession, blockPosition: number, exerciseId: string, day: DayNumber | undefined = session.day): string {
  const item = findProgramItem(program, day, blockPosition, exerciseId);
  return item === undefined ? "set" : setNounFor(item);
}

/**
 * The capitalised label for one set in the expanded list ("Set", "Min",
 * "Round"), matching the log screen's labels. Falls back to "Set". `day` is
 * the set's own day; when omitted the session's day is used.
 */
export function loggedSetLabel(program: Program, session: LoggedSession, blockPosition: number, exerciseId: string, day: DayNumber | undefined = session.day): string {
  const item = findProgramItem(program, day, blockPosition, exerciseId);
  return item === undefined ? "Set" : setWord(item);
}

/**
 * Whether History's edit panel should offer reps and kg steppers for a logged
 * set. When the program still describes the item (same day, block and
 * exercise), the item decides (`itemTracksReps`), so a set that was logged
 * without reps (the max was missing, or free text) can get them added later.
 * When it cannot be resolved, fall back to what was stored: steppers only if
 * the set has reps or a load.
 */
export function loggedSetShowsRepsAndLoad(program: Program, session: LoggedSession, set: LoggedSet): boolean {
  const item = findProgramItem(program, setDay(session, set), set.blockPosition, set.exerciseId);
  if (item !== undefined) return itemTracksReps(item);

  return set.reps !== undefined || set.loadKg !== undefined;
}
