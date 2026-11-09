import type { Program } from "../program/model";
import type { LoggedSession } from "../log/model";
import { setNounFor, setWord } from "../log/itemSets";
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
 * Looks up the item a logged exercise belonged to (the program's block at that
 * position, then the exercise in it). Undefined when the program no longer has
 * that day, block or exercise.
 */
function findProgramItem(program: Program, session: LoggedSession, blockPosition: number, exerciseId: string) {
  if (session.day === undefined) return undefined;

  return program.days[session.day]?.blocks[blockPosition - 1]?.items.find((item) => item.exerciseId === exerciseId);
}

/**
 * The singular noun for one tick of a logged exercise ("set", "round" or
 * "minute"), used when its sets have no reps ("5 rounds"). Falls back to "set"
 * when the program no longer describes the exercise.
 */
export function loggedSetNoun(program: Program, session: LoggedSession, blockPosition: number, exerciseId: string): string {
  const item = findProgramItem(program, session, blockPosition, exerciseId);
  return item === undefined ? "set" : setNounFor(item);
}

/**
 * The capitalised label for one set in the expanded list ("Set", "Min",
 * "Round"), matching the log screen's labels. Falls back to "Set".
 */
export function loggedSetLabel(program: Program, session: LoggedSession, blockPosition: number, exerciseId: string): string {
  const item = findProgramItem(program, session, blockPosition, exerciseId);
  return item === undefined ? "Set" : setWord(item);
}
