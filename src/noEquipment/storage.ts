import { addDaysToDate } from "../program/calendar";
import type { NoEquipmentTicks } from "./model";
import { ticksFromWire, ticksToWire } from "./wire";

/**
 * Persistence for the "No equipment" ticks, modelled on `fatigue/storage.ts`
 * and `log/storage.ts` (a minimal injected Storage-like object, so tests need
 * no DOM). Today's screen (PR 19 step 3) calls `loadTicks` at startup and
 * `setTick` when a tick is toggled.
 *
 * The value lives under `keys.noEquipment` as JSON `NoEquipmentTicksWireV1`.
 * It is deliberately not part of export/import: an export already carries the
 * swapped sets themselves, and an import that replaces the log may leave stale
 * ticks behind, which is harmless because a logged set decides first.
 */

/** Ticks older than this many days before today are dropped on save; logged sets carry the lasting record. */
export const TICK_RETENTION_DAYS = 14;

/** The subset of the Web Storage API this module uses. */
export interface NoEquipmentStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Result of `setTick`; `error` is a readable reason the UI can show. */
export type SetTickResult = { ok: true; ticks: NoEquipmentTicks } | { ok: false; error: string };

/**
 * Reads all stored ticks. Never throws: missing, unreadable or malformed data
 * gives empty ticks (or whatever parts were valid). Called at startup and by
 * `setTick` to re-read before saving.
 */
export function loadTicks(storage: NoEquipmentStorage, key: string): NoEquipmentTicks {
  try {
    const storedText = storage.getItem(key);
    if (storedText === null) return new Map();
    return ticksFromWire(JSON.parse(storedText));
  } catch {
    // Unreadable storage or invalid JSON: ticks are throwaway, so start empty.
    return new Map();
  }
}

/** The item keys ticked for one date (empty when none), for Today to build its swapped session from. */
export function ticksForDate(ticks: NoEquipmentTicks, date: string): ReadonlySet<string> {
  return ticks.get(date) ?? new Set<string>();
}

/**
 * Ticks or unticks one item on one date and saves. Read-modify-write: it
 * re-reads the stored ticks first and applies only this change, so a second
 * open copy of the app cannot have its ticks overwritten (as for the log).
 * OTHER dates more than `TICK_RETENTION_DAYS` before `today` are pruned, and a
 * date left with no ticks is removed. The date being written is never pruned,
 * so backfilling an old past date (allowed in a `?date=` preview) is kept. `today` is passed in rather than read from
 * the clock so tests are deterministic; callers pass the real
 * `todayLocalDate()`. Never throws: a write failure returns `{ ok: false }`.
 */
export function setTick(storage: NoEquipmentStorage, key: string, date: string, itemKey: string, ticked: boolean, today: string): SetTickResult {
  const ticks = loadTicks(storage, key);

  const itemKeysForDate = new Set(ticksForDate(ticks, date));
  if (ticked) itemKeysForDate.add(itemKey);
  else itemKeysForDate.delete(itemKey);
  ticks.set(date, itemKeysForDate);

  const oldestKeptDate = addDaysToDate(today, -TICK_RETENTION_DAYS);
  for (const storedDate of [...ticks.keys()]) {
    const isTooOld = storedDate !== date && storedDate < oldestKeptDate; // YYYY-MM-DD strings sort chronologically
    const isEmpty = (ticks.get(storedDate)?.size ?? 0) === 0;
    if (isTooOld || isEmpty) ticks.delete(storedDate);
  }

  try {
    storage.setItem(key, JSON.stringify(ticksToWire(ticks)));
    return { ok: true, ticks };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
