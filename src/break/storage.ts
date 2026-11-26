import type { TrainingBreak } from "./model";
import { cancelBreak, endBreak, startBreak, type StartBreakRequest } from "./operations";
import { breaksFromWire, breaksToWire } from "./wire";

/**
 * Persistence for the breaks, modelled on `injury/storage.ts` (a minimal
 * injected Storage-like object, so tests need no DOM). Settings and Today
 * (Break 1 step 3) call these when the person acts.
 *
 *   keys.breaks   BreaksWireV1 <-> TrainingBreak[]   (kept; carried by the JSON export and import)
 *
 * Every change re-reads the stored value first, so a second open copy of the
 * app cannot have its changes overwritten.
 */

/** The subset of the Web Storage API this module uses. */
export interface BreakStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Result of a save; `error` is a readable reason the UI can show. */
export type SaveBreaksResult = { ok: true; breaks: TrainingBreak[] } | { ok: false; error: string };

/** Reads the stored breaks. Never throws: missing, unreadable or malformed data gives an empty list (or whatever entries were valid). */
export function loadBreaks(storage: BreakStorage, key: string): TrainingBreak[] {
  try {
    const storedText = storage.getItem(key);
    if (storedText === null) return [];
    return breaksFromWire(JSON.parse(storedText));
  } catch {
    return [];
  }
}

/** Writes `breaks`, or returns the write failure. Never throws. `applyImport` uses it to put an export file's breaks in place. */
export function saveBreaks(storage: BreakStorage, key: string, breaks: TrainingBreak[]): SaveBreaksResult {
  try {
    storage.setItem(key, JSON.stringify(breaksToWire(breaks)));
    return { ok: true, breaks };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Starts a break and saves: re-reads the stored list, adds the break and writes. Fails (nothing written) on invalid days or an overlap. */
export function startBreakAndSave(storage: BreakStorage, key: string, request: StartBreakRequest): SaveBreaksResult {
  const started = startBreak(loadBreaks(storage, key), request);
  if (!started.ok) return started;

  return saveBreaks(storage, key, started.breaks);
}

/** Ends the break covering `date` and saves, re-reading first. Called by "End the break today". */
export function endBreakAndSave(storage: BreakStorage, key: string, date: string): SaveBreaksResult {
  return saveBreaks(storage, key, endBreak(loadBreaks(storage, key), date));
}

/** Cancels the break starting on `from` and saves, re-reading first. Called by "Cancel" on a coming break in Settings. */
export function cancelBreakAndSave(storage: BreakStorage, key: string, from: string): SaveBreaksResult {
  return saveBreaks(storage, key, cancelBreak(loadBreaks(storage, key), from));
}
