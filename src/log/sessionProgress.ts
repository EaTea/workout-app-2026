import type { SessionView } from "../program/schedule";
import { countSetsForItem } from "./itemSets";
import type { WorkoutLog } from "./model";
import { setsForItem } from "./operations";

/**
 * True while a workout is "in progress" (PLAN.md rule 8): the date's session
 * is a training day, at least one set has been logged, and at least one item
 * still has sets left to log (an optional item with nothing logged doesn't
 * count). Rest days, dates before the program starts, a
 * finished program and a fully logged session are never in progress.
 *
 * Used by app.ts after every render and every log change to decide whether the
 * screen should be kept awake on Today and the log screen. "Until midnight"
 * needs no code here: the shown date only changes when app.ts re-renders for a
 * new date, which calls this again with the new session. Pure: reads only its
 * arguments.
 *
 *   session (SessionView for `date`) + log ──▶ isSessionInProgress ──▶ ScreenWakeLock.setWanted
 */
export function isSessionInProgress(session: SessionView, log: WorkoutLog, date: string): boolean {
  if (session.kind !== "training") return false;

  let totalLoggedSets = 0;
  let hasItemWithSetsLeft = false;

  session.blocks.forEach((block, blockIndex) => {
    // Blocks are numbered from 1 in the log, as Today numbers them.
    const blockPosition = blockIndex + 1;

    for (const item of block.items) {
      const loggedCount = setsForItem(log, date, blockPosition, item.exercise.id).length;
      totalLoggedSets += loggedCount;

      // An optional item nobody started (the side plank) doesn't hold the
      // session open: skipping it is normal, and it would otherwise keep the
      // screen awake until midnight. Once started, it counts like any other.
      const isSkippedOptional = item.optional && loggedCount === 0;
      if (!isSkippedOptional && loggedCount < countSetsForItem(item, block)) hasItemWithSetsLeft = true;
    }
  });

  return totalLoggedSets > 0 && hasItemWithSetsLeft;
}
