/**
 * Internal workout-log model: what the log screen, Today rows ("2/6") and
 * History work with. Persistence uses a separate wire type (`wire.ts`) and
 * explicit mapping functions; nothing here is serialised directly.
 *
 * Shape of the data:
 *
 *   WorkoutLog
 *   └─ sessions: { "2026-11-02": LoggedSession, "2026-11-04": ... }
 *        └─ LoggedSession
 *             ├─ date          "2026-11-02"  (program date, same as Today uses)
 *             ├─ programWeek?  1             (for History headings)
 *             ├─ day?          1             (DayNumber, 1-7)
 *             └─ sets: LoggedSet[]
 *                  └─ { exerciseId: "pull_up", day?: 1, blockPosition: 2, setNumber: 3,
 *                       reps?: 6, loadKg?: 6, note?: "...", loggedAt: Date }
 *
 * A set is identified by (day, exerciseId, blockPosition, setNumber) within a
 * session, where day is the set's own `day` or else the session's (`setDay`
 * in `setDay.ts`). blockPosition is 1-based, as Today numbers blocks, because
 * the same exercise can appear in more than one block of a day, and counts
 * within that day's blocks, so two days on one date can both have a block 2.
 */

import type { DayNumber } from "../program/model";

/** One logged set (or EMOM minute, or heavy-bag round, or timed hold). */
export interface LoggedSet {
  /** Exercise library id, e.g. `pull_up`. */
  exerciseId: string;

  /**
   * Program day (1-7) the set's block belongs to. Absent on sets saved before
   * sets carried their own day; those belong to the session's `day` (use
   * `setDay` to resolve it, never read this field alone).
   */
  day?: DayNumber;

  /** 1-based position of the block within that day's blocks, as Today numbers blocks. */
  blockPosition: number;

  /** 1-based set number within the item. */
  setNumber: number;

  /** Reps done. Absent for heavy-bag rounds and timed holds, where the set is just ticked. */
  reps?: number;

  /** Load in kilograms. Absent for bodyweight work. */
  loadKg?: number;

  /** Free-text note. Absent when none was written. */
  note?: string;

  /** When the set was logged. Internal type is a Date; the wire form is an ISO 8601 string. */
  loggedAt: Date;
}

/**
 * A set the athlete skipped on purpose (Skip on the log screen). Nothing was
 * done, so it has no reps or load, but it counts as finished for the item, so
 * a whole exercise can be skipped. It is kept apart from `LoggedSet` so that
 * "Last time", progress and exports only ever see sets that were done.
 * Tapping a skipped set on the log screen and logging it replaces the skip.
 */
export interface SkippedSet {
  /** Exercise library id, as `LoggedSet.exerciseId`. */
  exerciseId: string;

  /** Program day of the set's block, as `LoggedSet.day`. Absent on a normal (single-day) session. */
  day?: DayNumber;

  /** 1-based position of the block within that day's blocks. */
  blockPosition: number;

  /** 1-based set number within the item. */
  setNumber: number;
}

/**
 * Everything logged on one program date. A session exists while it has at
 * least one logged or skipped set: deleting the last of both removes it.
 */
export interface LoggedSession {
  /** Program date "YYYY-MM-DD" (local date, same format as `program/calendar.ts`). */
  date: string;

  /** Program week (1-based) the date fell in when first logged. Optional context for History. */
  programWeek?: number;

  /** Program day (1-7) the date fell on when first logged. Optional context for History. */
  day?: DayNumber;

  sets: LoggedSet[];

  /** Sets skipped on purpose, not logged. Absent when none were skipped. */
  skippedSets?: SkippedSet[];
}

/** The whole log: sessions keyed by program date. */
export interface WorkoutLog {
  sessions: Record<string, LoggedSession>;
}
