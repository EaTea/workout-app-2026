import type { BlockView, ItemView, SessionView } from "../program/schedule";
import { countSetsForItem } from "./itemSets";
import type { WorkoutLog } from "./model";
import { setsForItem } from "./operations";

/** How long after the last logged set a session still counts as in progress (PLAN.md rule 8). */
export const SESSION_IDLE_TIMEOUT_MILLISECONDS = 45 * 60 * 1000;

/**
 * How many sets an item needs before it counts as complete. Normally every
 * set (`countSetsForItem`), but a heavy-bag item with a rounds range such as
 * 4-5 is complete at the low end: Ed stopping at 4 rounds has done the session.
 */
function setsNeededToComplete(item: ItemView, block: BlockView): number {
  if (item.format === "interval" && item.rounds) return item.rounds.min;
  return countSetsForItem(item, block);
}

/**
 * True while a workout is "in progress" (PLAN.md rule 8): the date's session
 * is a training day, at least one set has been logged on it, the most recent
 * logged set is less than 45 minutes old (`now`), and at least one item still
 * has sets left to log. Not counted as "sets left": warm-up blocks, an
 * optional item nothing was logged for (the side plank), and rounds of a
 * ranged interval item beyond its low end. Rest days, dates before the
 * program starts, a finished program and a fully logged session are never in
 * progress.
 *
 * Used by app.ts to decide whether the screen should be kept awake on Today
 * and the log screen. app.ts additionally requires `date` to be the real
 * current date (a session left open past midnight is over), and re-asks every
 * minute, because the idle timeout passes without any log change. Pure: reads
 * only its arguments.
 *
 *   session (SessionView for `date`) + log + now ──▶ isSessionInProgress ──▶ ScreenWakeLock.setWanted
 */
export function isSessionInProgress(session: SessionView, log: WorkoutLog, date: string, now: Date): boolean {
  if (session.kind !== "training") return false;

  let totalLoggedSets = 0;
  let hasItemWithSetsLeft = false;

  session.blocks.forEach((block, blockIndex) => {
    // Blocks are numbered from 1 in the log, as Today numbers them.
    const blockPosition = blockIndex + 1;

    for (const item of block.items) {
      const loggedCount = setsForItem(log, date, blockPosition, item.exercise.id).length;
      totalLoggedSets += loggedCount;

      // Warm-ups are never required to end the session.
      if (block.type === "warmup") continue;

      // An optional item nobody started (the side plank) doesn't hold the
      // session open: skipping it is normal, and it would otherwise keep the
      // screen awake until the idle timeout. Once started, it counts like any other.
      const isSkippedOptional = item.optional && loggedCount === 0;
      if (!isSkippedOptional && loggedCount < setsNeededToComplete(item, block)) hasItemWithSetsLeft = true;
    }
  });

  if (totalLoggedSets === 0 || !hasItemWithSetsLeft) return false;

  return now.getTime() - latestLoggedTime(log, date) < SESSION_IDLE_TIMEOUT_MILLISECONDS;
}

/** The most recent `loggedAt` (milliseconds) among all sets logged on `date`, warm-ups included; 0 when there are none. */
function latestLoggedTime(log: WorkoutLog, date: string): number {
  const session = Object.hasOwn(log.sessions, date) ? log.sessions[date] : undefined;
  if (session === undefined) return 0;

  return Math.max(0, ...session.sets.map((set) => set.loggedAt.getTime()));
}
