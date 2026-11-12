import { toDayNumber } from "../program/calendar";
import { DAYS_PER_WEEK } from "../program/model";
import type { Combine, CombinesByDate } from "./model";

/**
 * Stored (JSON) shape of the combines and its mapping to the internal
 * `CombinesByDate` in `model.ts`. Only `combinesFromWire` / `combinesToWire`
 * convert between them; `storage.ts` calls them on load and save, and the
 * JSON export and import (`export/wire.ts`, `export/import.ts`) reuse them so
 * a file is judged by the same rules as stored data.
 *
 *   { "version": 1, "combines": { "2026-11-09": { "hostDay": 1, "addedDay": 2, "addedDate": "2026-11-10" } } }
 *
 * Like the "No equipment" ticks (and unlike the log), a damaged value is
 * simply dropped with no `.corrupt-` backup: a lost combine only means the
 * person adds the day again, and nothing logged depends on it (each logged
 * set carries its own day). Unlike the ticks it is exported and imported,
 * because it also says which date is a donor date.
 */

/** Format v1 of the stored combines, one record per host date. */
export interface CombineWireV1 {
  hostDay: number;
  addedDay: number;
  addedDate: string;
}

/** Format v1 of the whole stored value. */
export interface CombinesWireV1 {
  version: 1;
  combines: Record<string, CombineWireV1>;
}

/** Converts the internal combines to the stored shape, with host dates sorted so the JSON is stable. */
export function combinesToWire(combines: CombinesByDate): CombinesWireV1 {
  const wireCombines: Record<string, CombineWireV1> = {};

  for (const hostDate of [...combines.keys()].sort()) {
    const combine = combines.get(hostDate);
    if (combine === undefined) continue;
    wireCombines[hostDate] = { hostDay: combine.hostDay, addedDay: combine.addedDay, addedDate: combine.addedDate };
  }

  return { version: 1, combines: wireCombines };
}

/**
 * Converts untrusted parsed JSON to internal combines. Never throws: a wrong
 * version or shape gives no combines, and any single entry that is not usable
 * is dropped on its own (see `combineFromWire`).
 */
export function combinesFromWire(wire: unknown): CombinesByDate {
  const combines: CombinesByDate = new Map();

  if (!isRecord(wire) || wire.version !== 1 || !isRecord(wire.combines)) return combines;

  for (const [hostDate, rawCombine] of Object.entries(wire.combines)) {
    const combine = combineFromWire(hostDate, rawCombine);
    if (combine !== undefined) combines.set(hostDate, combine);
  }

  return combines;
}

/**
 * Converts one stored entry, or undefined when it is unusable: the host date
 * and `addedDate` must be real, different calendar dates, both days whole
 * numbers from 1 to 7 and different from each other. Extra fields are
 * ignored. Called by `combinesFromWire` for each entry.
 */
function combineFromWire(hostDate: string, raw: unknown): Combine | undefined {
  if (!isRecord(raw)) return undefined;

  const { hostDay, addedDay, addedDate } = raw;
  if (!isRealCalendarDate(hostDate) || typeof addedDate !== "string" || !isRealCalendarDate(addedDate)) return undefined;
  if (addedDate === hostDate) return undefined;
  if (!isDayNumber(hostDay) || !isDayNumber(addedDay) || hostDay === addedDay) return undefined;

  return { hostDay, addedDay, addedDate };
}

/** True for a whole number from 1 to `DAYS_PER_WEEK`. */
function isDayNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= DAYS_PER_WEEK;
}

/** True for a non-null, non-array object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True for a real "YYYY-MM-DD" date (so not "2026-02-30" or "tomorrow"). */
function isRealCalendarDate(text: string): boolean {
  try {
    toDayNumber(text);
    return true;
  } catch {
    return false;
  }
}
