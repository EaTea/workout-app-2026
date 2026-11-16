import { toDayNumber } from "../program/calendar";
import { DAYS_PER_WEEK } from "../program/model";
import type { OptionalBlockKey, SkippedBlocksByDate } from "./model";

/**
 * Stored (JSON) shape of the optional block choices and its mapping to the
 * internal `SkippedBlocksByDate` in `model.ts`. Only `optionalBlockChoicesFromWire` /
 * `optionalBlockChoicesToWire` convert between them; `storage.ts` calls them
 * on load and save, and the JSON export and import (`export/wire.ts`,
 * `export/import.ts`) reuse them so a file is judged by the same rules as
 * stored data.
 *
 *   { "version": 1, "choices": { "2026-11-16": { "skipped": ["1:6"] } } }
 *
 * Like the combines, a damaged value is simply dropped with no `.corrupt-`
 * backup: a lost skip only means the person taps "Skip boxing" again.
 */

/** Format v1 of one date's stored choices. */
export interface DateChoicesWireV1 {
  skipped: string[];
}

/** Format v1 of the whole stored value. */
export interface OptionalBlockChoicesWireV1 {
  version: 1;
  choices: Record<string, DateChoicesWireV1>;
}

/** Converts the internal skips to the stored shape: dates and keys sorted so the JSON is stable, dates with no skips left out. */
export function optionalBlockChoicesToWire(skipsByDate: SkippedBlocksByDate): OptionalBlockChoicesWireV1 {
  const choices: Record<string, DateChoicesWireV1> = {};

  for (const date of [...skipsByDate.keys()].sort()) {
    const skippedKeys = skipsByDate.get(date);
    if (skippedKeys === undefined || skippedKeys.size === 0) continue;
    choices[date] = { skipped: [...skippedKeys].sort() };
  }

  return { version: 1, choices };
}

/**
 * Converts untrusted parsed JSON to internal skips. Never throws: a wrong
 * version or shape gives no skips, and any single date or key that is not
 * usable is dropped on its own (a date left with no keys is dropped too).
 */
export function optionalBlockChoicesFromWire(wire: unknown): SkippedBlocksByDate {
  const skipsByDate: SkippedBlocksByDate = new Map();

  if (!isRecord(wire) || wire.version !== 1 || !isRecord(wire.choices)) return skipsByDate;

  for (const [date, rawDateChoices] of Object.entries(wire.choices)) {
    if (!isRealCalendarDate(date) || !isRecord(rawDateChoices) || !Array.isArray(rawDateChoices.skipped)) continue;

    const skippedKeys = new Set<OptionalBlockKey>();
    for (const rawKey of rawDateChoices.skipped) {
      if (isOptionalBlockKey(rawKey)) skippedKeys.add(rawKey);
    }

    if (skippedKeys.size > 0) skipsByDate.set(date, skippedKeys);
  }

  return skipsByDate;
}

/** True for a text like "1:6": a day 1 to 7, a colon and a whole-number block position of 1 or more. */
function isOptionalBlockKey(value: unknown): value is OptionalBlockKey {
  if (typeof value !== "string") return false;

  const match = /^([1-9]\d*):([1-9]\d*)$/.exec(value);
  if (match === null) return false;

  return Number(match[1]) <= DAYS_PER_WEEK;
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
