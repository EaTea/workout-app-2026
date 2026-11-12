import { toDayNumber } from "../program/calendar";
import type { NoEquipmentTicks } from "./model";

/**
 * Stored (JSON) shape of the "No equipment" ticks and its mapping to the
 * internal `NoEquipmentTicks` in `model.ts`. Only `ticksFromWire` /
 * `ticksToWire` convert between them; `storage.ts` calls them on load and save.
 *
 *   { "version": 1, "ticks": { "2026-11-05": ["3:single_leg_rdl"] } }
 *
 * Unlike the log and the fatigue check-ins, a damaged value is simply
 * dropped, with no `.corrupt-` backup copy: ticks are throwaway pre-session
 * state (the logged sets carry the lasting record of what was swapped), so
 * losing them costs the person at most a few re-ticks.
 */

/** Format v1 of the stored ticks: item keys per YYYY-MM-DD date. */
export interface NoEquipmentTicksWireV1 {
  version: 1;
  ticks: Record<string, string[]>;
}

/**
 * A tick key is "<blockPosition>:<exerciseId>", e.g. "3:single_leg_rdl", or,
 * for a row of a combined session, "<day>.<blockPosition>:<exerciseId>", e.g.
 * "2.3:single_leg_rdl" (see `noEquipmentItemKey`).
 */
const ITEM_KEY_PATTERN = /^(\d+\.)?\d+:[a-z0-9_]+$/;

/** Converts the internal ticks to the stored shape, with dates and keys sorted so the JSON is stable. Dates with no ticks are left out. */
export function ticksToWire(ticks: NoEquipmentTicks): NoEquipmentTicksWireV1 {
  const wireTicks: Record<string, string[]> = {};

  const sortedDates = [...ticks.keys()].sort();
  for (const date of sortedDates) {
    const itemKeys = ticks.get(date) ?? new Set<string>();
    if (itemKeys.size === 0) continue;
    wireTicks[date] = [...itemKeys].sort();
  }

  return { version: 1, ticks: wireTicks };
}

/**
 * Converts untrusted parsed JSON to internal ticks. Never throws: a wrong
 * version or shape gives empty ticks, and any date that is not a real
 * YYYY-MM-DD, any item key not matching "<number>:<id>" or "<day>.<number>:<id>", and any
 * non-string entry is dropped (a date left with no keys is dropped too).
 */
export function ticksFromWire(wire: unknown): NoEquipmentTicks {
  const ticks: NoEquipmentTicks = new Map();

  if (typeof wire !== "object" || wire === null || Array.isArray(wire)) return ticks;
  const root = wire as Record<string, unknown>;
  if (root.version !== 1) return ticks;

  const rawTicks = root.ticks;
  if (typeof rawTicks !== "object" || rawTicks === null || Array.isArray(rawTicks)) return ticks;

  for (const [date, rawKeys] of Object.entries(rawTicks as Record<string, unknown>)) {
    if (!isRealCalendarDate(date) || !Array.isArray(rawKeys)) continue;

    const validKeys = rawKeys.filter((rawKey): rawKey is string => typeof rawKey === "string" && ITEM_KEY_PATTERN.test(rawKey));
    if (validKeys.length > 0) ticks.set(date, new Set(validKeys));
  }

  return ticks;
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
