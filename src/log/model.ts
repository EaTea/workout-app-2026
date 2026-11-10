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
 *                  └─ { exerciseId: "pull_up", blockPosition: 2, setNumber: 3,
 *                       reps?: 6, loadKg?: 6, note?: "...", loggedAt: Date }
 *
 * A set is identified by (exerciseId, blockPosition, setNumber) within a
 * session. blockPosition is 1-based, as Today numbers blocks, because the same
 * exercise can appear in more than one block of a day.
 */

import type { DayNumber } from "../program/model";

/** One logged set (or EMOM minute, or heavy-bag round, or timed hold). */
export interface LoggedSet {
  /** Exercise library id, e.g. `pull_up`. */
  exerciseId: string;

  /** 1-based position of the block within the day, as Today numbers blocks. */
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

/** Everything logged on one program date. Never empty: deleting the last set removes the session. */
export interface LoggedSession {
  /** Program date "YYYY-MM-DD" (local date, same format as `program/calendar.ts`). */
  date: string;

  /** Program week (1-based) the date fell in when first logged. Optional context for History. */
  programWeek?: number;

  /** Program day (1-7) the date fell on when first logged. Optional context for History. */
  day?: DayNumber;

  sets: LoggedSet[];
}

/** The whole log: sessions keyed by program date. */
export interface WorkoutLog {
  sessions: Record<string, LoggedSession>;
}
