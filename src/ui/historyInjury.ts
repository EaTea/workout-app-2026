import type { Injury } from "../injury/model";
import { activeInjuriesOn } from "../injury/operations";
import type { WorkoutLog } from "../log/model";
import type { Program } from "../program/model";
import { itemDisplayName } from "../program/rotation";
import { buildSwappedSession } from "../noEquipment/session";
import type { TrainingSettings } from "../settings/model";
import { sideAreaLabel } from "./injuryFlagText";

/*
 * The "flagged day" note on a History day card: a small tag ("Right
 * shoulder") plus which exercises were left out and which were stood in. It
 * is derived, never stored: the injury dates say which areas were flagged on
 * the date, and the same session builder Today used rebuilds that day's
 * session from the program (PLAN.md, "The record").
 *
 *   injuries ─▶ activeInjuriesOn(date) ─▶ tag "Right shoulder"
 *   program + settings + log + injuries ─▶ buildSwappedSession(date)
 *        └─▶ items with leftOut / injuryStandInFor ─▶ names
 *
 * The log is passed in so logged sets lock rows the way they did on the day
 * (an exercise that was added back and logged is not listed as left out).
 * "Add it back" choices are throwaway (kept 14 days) and are not passed, so
 * the log is the only record of them. A combined day lists only the tag.
 */

/** What a flagged day's History card shows. */
export interface InjuryDayNote {
  /** "Right shoulder"; several flagged areas are joined with ", ". */
  tag: string;

  /** Names of the exercises left out that day, program order, each once. */
  leftOut: string[];

  /** One "Lying leg raise instead of Hanging leg raise" per stand-in, program order, each once. */
  standIns: string[];
}

/** "Left out: Pull-ups, Lateral raise": the line under the tag; undefined when nothing was left out. */
export function leftOutSummaryLine(note: InjuryDayNote): string | undefined {
  return note.leftOut.length === 0 ? undefined : `Left out: ${note.leftOut.join(", ")}`;
}

/**
 * The note for the History card of `date`, or undefined when no area was
 * flagged then. Never throws: a date the program cannot build a session for
 * (the start date moved) still gets its tag, with no lists. Called by the
 * session card in `history.ts`.
 */
export function injuryNoteForDate(
  program: Program,
  settings: TrainingSettings,
  log: WorkoutLog,
  injuries: readonly Injury[],
  date: string,
): InjuryDayNote | undefined {
  const flagged = activeInjuriesOn(injuries, date);
  if (flagged.length === 0) return undefined;

  const note: InjuryDayNote = {
    tag: flagged.map((injury) => sideAreaLabel(injury.side, injury.area)).join(", "),
    leftOut: [],
    standIns: [],
  };

  // A combined day (a set carries a day other than the session's) is rebuilt from two days; keep it to the tag.
  const loggedSession = log.sessions[date];
  const isCombined = (loggedSession?.sets ?? []).some((set) => set.day !== undefined && set.day !== loggedSession?.day);
  if (isCombined) return note;

  try {
    const { session } = buildSwappedSession(program, settings, log, new Map(), date, undefined, injuries);
    if (session.kind !== "training") return note;

    for (const block of session.blocks) {
      for (const item of block.items) {
        if (item.leftOut !== undefined) addOnce(note.leftOut, itemDisplayName(item));
        if (item.injuryStandInFor !== undefined) addOnce(note.standIns, `${itemDisplayName(item)} instead of ${item.injuryStandInFor.original.name}`);
      }
    }
  } catch {
    // No session for that date under the current start date: the tag alone still records the flag.
  }

  return note;
}

/** Appends `text` unless the list already has it (an exercise in two blocks reads once). */
function addOnce(list: string[], text: string): void {
  if (!list.includes(text)) list.push(text);
}
