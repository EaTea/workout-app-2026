import type { BlockView, ItemView } from "../program/schedule";
import type { DayNumber, Program } from "../program/model";
import { countSetsForItem, itemTracksReps, prefillForSet, setNeedsMax } from "../log/itemSets";
import type { LoggedSet, WorkoutLog } from "../log/model";
import { logSet, setsForItem } from "../log/operations";
import { lastTimeForItem } from "./lastTimeHint";
import type { TimerRoundAction } from "./timerView";

/**
 * Logging a set from a timer (PR 33: the EMOM timer; the boxing timer comes
 * later). Today builds one of these per EMOM row and hands it to
 * `openTimer`, so that tapping "Log set N" on the timer saves the same set
 * the log screen would save for that minute.
 *
 *   EMOM timer "Log set 3" ──onTap(3)──▶ buildEmomRoundAction
 *        ├─ prefill (rule 8): earlier set this session, else plan, else last time
 *        ├─ LoggedSet { setNumber: 3, ... } (same shape as the log screen's)
 *        └─ source.changeLog(fresh => logSet(fresh, date, set, context))
 *              ↑ app.ts re-reads storage, saves, and keeps the new log
 *
 * The timer keeps running; `describe(3)` then reads "Logged set 3" from the
 * app's fresh log, so the button updates on the next timer render.
 */

/** What app.ts provides so a timer can read and save the log without a screen re-render. */
export interface TimerSetLoggingSource {
  /** The stored log as app.ts holds it now (fresh after every change). */
  currentLog(): WorkoutLog;

  /**
   * Applies one change through app.ts's save path. `error` is set when saving
   * failed; the change is then kept in memory only, as on the log screen.
   */
  changeLog(operation: (freshLog: WorkoutLog) => WorkoutLog): { log: WorkoutLog; error: string | null };

  /** False for a `?date=` preview of a future day: nothing can be logged there. */
  canLog: boolean;

  /**
   * Redraws Today so the row counts ("2/9") show the sets logged from the
   * timer. Called when the timer closes, not on each tap, so the timer's own
   * button and the open overlay are not redrawn underneath Ed.
   */
  refresh(): void;
}

/** The session facts a new set is saved with, as the log screen works them out for a row. */
export interface SetSessionContext {
  /** Program week the session belongs to. */
  programWeek: number;

  /** Program day the set is saved under: the combined host day, or the row's own day. */
  day: DayNumber;
}

/** Everything about one EMOM row that its timer's log button needs. */
export interface EmomRoundInput {
  program: Program;
  item: ItemView;
  block: BlockView;

  /** Date of the session (`YYYY-MM-DD`). */
  date: string;

  /** The block's position on its day, as Today numbers blocks. */
  blockPosition: number;

  /** The day this row belongs to (the row's own day, also on combined days). */
  dayNumber: DayNumber;

  /** True on a combined date: each set then names its day (`LoggedSet.day`). */
  isCombined: boolean;

  sessionContext: SetSessionContext;
  source: TimerSetLoggingSource;
}

/**
 * Builds the timer's round action for one EMOM row. Pure except for the
 * source calls, so the rules (which rounds can be logged, what the set holds)
 * are testable with a fake source.
 */
export function buildEmomRoundAction(input: EmomRoundInput): TimerRoundAction {
  const { program, item, block, date, blockPosition, dayNumber, isCombined, sessionContext, source } = input;
  const setTotal = countSetsForItem(item, block);
  const tracksReps = itemTracksReps(item);

  /** The sets of this exercise on this date, read from the app's current log. */
  function loggedSetsNow(): LoggedSet[] {
    return setsForItem(source.currentLog(), date, blockPosition, item.exercise.id, dayNumber);
  }

  /**
   * Why the round can't be logged, or undefined when it can. A round past the
   * item's sets (an EMOM with a set count other than its minutes), a future
   * preview, and a target that needs a max the app doesn't have all block it.
   */
  function blockedReason(round: number, prefillReps: number | undefined): string | undefined {
    if (!source.canLog) return "Can't log here";
    if (round > setTotal) return "No set for this minute";
    if (tracksReps && prefillReps === undefined && setNeedsMax(item, round)) return "Set your max to log";
    return undefined;
  }

  /** What the button shows for `round` right now, and whether tapping it can save anything. */
  function stateOf(round: number): { label: string; disabled: boolean } {
    // A logged round stays enabled (so focus stays on the button) but tapping it saves nothing.
    if (loggedSetsNow().some((set) => set.setNumber === round)) {
      return { label: `Logged set ${round}`, disabled: false };
    }
    const reason = blockedReason(round, prefillFor(round).reps);
    if (reason !== undefined) return { label: reason, disabled: true };
    return { label: `Log set ${round}`, disabled: false };
  }

  return {
    describe: stateOf,

    /**
     * Saves the round's set, pre-filled as the log screen would. A disabled or
     * already logged round is a no-op, so a double tap cannot save twice.
     * Returns the save error, if any, for the timer to show.
     */
    onTap(round: number): string | null {
      if (stateOf(round).disabled || loggedSetsNow().some((set) => set.setNumber === round)) return null;

      const prefill = prefillFor(round);
      const loggedSet: LoggedSet = { exerciseId: item.exercise.id, blockPosition, setNumber: round, loggedAt: new Date() };
      if (isCombined) loggedSet.day = dayNumber;
      if (tracksReps && prefill.reps !== undefined) loggedSet.reps = prefill.reps;
      if (tracksReps && prefill.loadKg > 0) loggedSet.loadKg = prefill.loadKg;

      return source.changeLog((freshLog) => logSet(freshLog, date, loggedSet, sessionContext)).error;
    },
  };

  /**
   * The values the button's set would start at (rule 8). Last time is read
   * each call, so it always matches the log the app holds.
   */
  function prefillFor(round: number): { reps?: number; loadKg: number } {
    const lastTime = lastTimeForItem(source.currentLog(), program, item, block, dayNumber, date);
    return prefillForSet(item, round, loggedSetsNow(), lastTime);
  }
}

/**
 * What Today passes down to each row so the row's timer can log a set: the
 * program, the app's log source, and the session facts a new set is saved
 * with (week, combined host day). Built once per Today render.
 */
export interface RowTimerLogging {
  program: Program;
  source: TimerSetLoggingSource;

  /** Program week of the shown session. */
  programWeek: number;

  /** The combined date's host day, or undefined on a normal date. Sets save under it when present. */
  hostDay: DayNumber | undefined;

  /** True on a combined date. */
  isCombined: boolean;
}
