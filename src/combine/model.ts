import type { DayNumber } from "../program/model";

/**
 * Internal (in-memory) form of the "combine two days" records (PR 23 design,
 * "Storage"). One record exists per HOST date: the date whose Today screen
 * got a second day added to it. Only `wire.ts` converts between this and the
 * stored JSON; `storage.ts`, the offers and merge logic in `program/combine.ts`
 * and the Today screen work with these types.
 *
 *   host date "2026-11-09" ──▶ { hostDay: 1, addedDay: 2, addedDate: "2026-11-10" }
 *
 * Reading it: on 9 Nov (Day 1) the session is Day 1 plus Day 2. Day 2's own
 * date, 10 Nov, is the DONOR date and shows "Day 2 done with Day 1 on 9 Nov".
 * `addedDate` may also be BEFORE the host date (a missed day caught up).
 */
export interface Combine {
  /** The program day the host date would normally train. */
  hostDay: DayNumber;

  /** The program day folded into the host date's session. */
  addedDay: DayNumber;

  /** The calendar date ("YYYY-MM-DD") `addedDay` would normally have been trained on. */
  addedDate: string;
}

/** All combines of one program, keyed by host date ("YYYY-MM-DD"). */
export type CombinesByDate = Map<string, Combine>;
