import type { Combine, CombinesByDate } from "./model";
import { combinesFromWire, combinesToWire } from "./wire";

/**
 * Persistence for the combines, modelled on `noEquipment/storage.ts` (a
 * minimal injected Storage-like object, so tests need no DOM). Today's screen
 * (PR 25 step 4) calls `loadCombines` at startup, `addCombine` when "Add Day
 * N" is tapped and `removeCombine` for "Undo combine"; the JSON export reads
 * it with `loadCombines` and the import writes it with `saveCombines`.
 *
 * The value lives under `keys.combines` as JSON `CombinesWireV1`. Combines are
 * not pruned: there is at most one per training day, and the donor-date card
 * must keep showing for past dates.
 */

/** The subset of the Web Storage API this module uses. */
export interface CombinesStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Result of the saving functions; `error` is a readable reason the UI can show. */
export type SaveCombinesResult = { ok: true; combines: CombinesByDate } | { ok: false; error: string };

/**
 * Reads all stored combines. Never throws: missing, unreadable or malformed
 * data gives no combines (or whichever entries were valid). Called at startup
 * and by the saving functions to re-read before changing anything.
 */
export function loadCombines(storage: CombinesStorage, key: string): CombinesByDate {
  try {
    const storedText = storage.getItem(key);
    if (storedText === null) return new Map();
    return combinesFromWire(JSON.parse(storedText));
  } catch {
    // Unreadable storage or invalid JSON: start with none.
    return new Map();
  }
}

/**
 * Replaces the stored combines with `combines` (used by the import, which
 * replaces everything). Never throws: a write failure returns `{ ok: false }`.
 */
export function saveCombines(storage: CombinesStorage, key: string, combines: CombinesByDate): SaveCombinesResult {
  try {
    storage.setItem(key, JSON.stringify(combinesToWire(combines)));
    return { ok: true, combines };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Records that `combine.addedDay` was added to the session on `hostDate`.
 * Read-modify-write: it re-reads the stored combines first and changes only
 * this host date, so a second open copy of the app cannot have its combines
 * overwritten. Never throws.
 */
export function addCombine(storage: CombinesStorage, key: string, hostDate: string, combine: Combine): SaveCombinesResult {
  const combines = loadCombines(storage, key);
  combines.set(hostDate, combine);
  return saveCombines(storage, key, combines);
}

/** Removes the combine on `hostDate` ("Undo combine"); a date with none is left as is. Read-modify-write like `addCombine`. Never throws. */
export function removeCombine(storage: CombinesStorage, key: string, hostDate: string): SaveCombinesResult {
  const combines = loadCombines(storage, key);
  combines.delete(hostDate);
  return saveCombines(storage, key, combines);
}
