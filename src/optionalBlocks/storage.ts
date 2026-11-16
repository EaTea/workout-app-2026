import type { OptionalBlockKey, SkippedBlocksByDate } from "./model";
import { optionalBlockChoicesFromWire, optionalBlockChoicesToWire } from "./wire";

/**
 * Persistence for the optional block choices, modelled on `combine/storage.ts`
 * (a minimal injected Storage-like object, so tests need no DOM). Today's
 * screen (a later PR 29 step) calls `loadOptionalBlockChoices` at startup and
 * `setBlockSkipped` when "Skip boxing" / "Box" is tapped; the JSON export
 * reads it with `loadOptionalBlockChoices` and the import writes it with
 * `saveOptionalBlockChoices`.
 *
 * The value lives under `keys.optionalBlockChoices` as JSON
 * `OptionalBlockChoicesWireV1`. Choices are not pruned: History keeps saying
 * "Boxing skipped" for past dates.
 */

/** The subset of the Web Storage API this module uses. */
export interface OptionalBlockChoicesStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Result of the saving functions; `error` is a readable reason the UI can show. */
export type SaveOptionalBlockChoicesResult = { ok: true; skipsByDate: SkippedBlocksByDate } | { ok: false; error: string };

/**
 * Reads all stored skips. Never throws: missing, unreadable or malformed data
 * gives no skips (or whichever entries were valid). Called at startup and by
 * `setBlockSkipped` to re-read before changing anything.
 */
export function loadOptionalBlockChoices(storage: OptionalBlockChoicesStorage, key: string): SkippedBlocksByDate {
  try {
    const storedText = storage.getItem(key);
    if (storedText === null) return new Map();
    return optionalBlockChoicesFromWire(JSON.parse(storedText));
  } catch {
    // Unreadable storage or invalid JSON: start with none.
    return new Map();
  }
}

/**
 * Replaces the stored skips with `skipsByDate` (used by the import, which
 * replaces everything). Never throws: a write failure returns `{ ok: false }`.
 */
export function saveOptionalBlockChoices(storage: OptionalBlockChoicesStorage, key: string, skipsByDate: SkippedBlocksByDate): SaveOptionalBlockChoicesResult {
  try {
    storage.setItem(key, JSON.stringify(optionalBlockChoicesToWire(skipsByDate)));
    return { ok: true, skipsByDate };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Records that the block `blockKey` is skipped (`skipped` true) or boxed as
 * written (false) on `date`. Read-modify-write: it re-reads the stored skips
 * first and changes only this block, so a second open copy of the app cannot
 * have its choices overwritten. Un-skipping the last block of a date removes
 * the date. Never throws.
 */
export function setBlockSkipped(storage: OptionalBlockChoicesStorage, key: string, date: string, blockKey: OptionalBlockKey, skipped: boolean): SaveOptionalBlockChoicesResult {
  const skipsByDate = loadOptionalBlockChoices(storage, key);
  const skippedKeys = new Set(skipsByDate.get(date) ?? []);

  if (skipped) {
    skippedKeys.add(blockKey);
  } else {
    skippedKeys.delete(blockKey);
  }

  if (skippedKeys.size > 0) {
    skipsByDate.set(date, skippedKeys);
  } else {
    skipsByDate.delete(date);
  }

  return saveOptionalBlockChoices(storage, key, skipsByDate);
}
