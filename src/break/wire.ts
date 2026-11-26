import { toDayNumber } from "../program/calendar";
import type { TrainingBreak } from "./model";

/**
 * Stored (JSON) shape of the breaks and its mappings to the internal
 * `TrainingBreak` in `model.ts`. Only these two functions convert;
 * `storage.ts` calls them on load and save.
 *
 *   { "version": 1, "breaks": [ { "from": "2026-11-26", "to": "2026-12-03", "note": "Physio" } ] }
 *
 * Loading is tolerant, like the injuries: a wrong version or shape gives
 * nothing, and a bad entry is skipped without a crash.
 */

/** One stored break. `note` is left out when absent. */
export interface BreakWire {
  from: string;
  to: string;
  note?: string;
}

/** Format v1 of the stored breaks. */
export interface BreaksWireV1 {
  version: 1;
  breaks: BreakWire[];
}

/** Converts internal breaks to the stored shape, in the order given. An absent note is left out of the JSON. */
export function breaksToWire(breaks: readonly TrainingBreak[]): BreaksWireV1 {
  return {
    version: 1,
    breaks: breaks.map((trainingBreak) => {
      const wire: BreakWire = { from: trainingBreak.from, to: trainingBreak.to };
      if (trainingBreak.note !== undefined) wire.note = trainingBreak.note;
      return wire;
    }),
  };
}

/**
 * Converts untrusted parsed JSON to internal breaks, sorted by `from`. Never
 * throws. An entry is skipped when a date is not real, `to` is not after
 * `from`, or `note` is present but not text. A note is trimmed and dropped
 * when empty.
 */
export function breaksFromWire(wire: unknown): TrainingBreak[] {
  if (!isRecord(wire) || wire.version !== 1 || !Array.isArray(wire.breaks)) return [];

  const breaks: TrainingBreak[] = [];
  for (const rawBreak of wire.breaks) {
    if (!isRecord(rawBreak)) continue;

    const { from, to, note } = rawBreak;
    if (typeof from !== "string" || typeof to !== "string") continue;
    if (!isRealCalendarDate(from) || !isRealCalendarDate(to)) continue;
    if (to <= from) continue; // YYYY-MM-DD strings sort chronologically

    if (note !== undefined && typeof note !== "string") continue;

    const trainingBreak: TrainingBreak = { from, to };
    const trimmedNote = typeof note === "string" ? note.trim() : "";
    if (trimmedNote !== "") trainingBreak.note = trimmedNote;
    breaks.push(trainingBreak);
  }

  return breaks.sort((first, second) => (first.from < second.from ? -1 : first.from > second.from ? 1 : 0));
}

/** True for a plain JSON object (not null, not an array). */
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
