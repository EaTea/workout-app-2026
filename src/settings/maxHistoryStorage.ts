import type { MaxHistoryEntry } from "./model";
import { recordMax, sortedHistory } from "./maxHistory";
import { toDayNumber } from "../program/calendar";
import type { ProgramStorageKeys } from "../storage/programKeys";

/**
 * Persistence of the max history (every max the athlete ever saved) in its own
 * localStorage key, apart from the settings. It is separate on purpose: the
 * settings key stays in its v2 format, so an older copy of the app (a
 * suspended home-screen app, or the old shell before an update reload) still
 * reads the settings correctly, and whatever it writes there can never wipe
 * the history.
 *
 *   <programId>.settings      (v2: startDate, maxReps, maxSavedOn)
 *   <programId>.max-history   (v1: per exercise, entries oldest first)
 *            \                               /
 *             `-- loadSettings merges them --'  (see storage.ts)
 *
 * The wire type (`MaxHistoryWireV1`) is what is stored; the internal type is
 * `Record<string, MaxHistoryEntry[]>`. Only `maxHistoryFromWire` and
 * `maxHistoryToWire` convert between them.
 */

// The JSON-encoded `MaxHistoryWireV1` lives under `keys.maxHistory` of the
// active program's `ProgramStorageKeys`.

/** One saved max on the wire; `savedOn` is null when the date is unknown. */
export interface MaxHistoryEntryWire {
  savedOn: string | null;
  reps: number;
}

/** Format v1: per exercise id, the saved maxes oldest first. */
export interface MaxHistoryWireV1 {
  version: 1;
  maxHistory: Record<string, MaxHistoryEntryWire[]>;
}

/**
 * Converts untrusted stored data into an internal history. Tolerant by
 * design: anything missing, malformed or from an unknown version gives an
 * empty history; bad entries are dropped; an exercise with no valid entry is
 * left out. Entries are sorted oldest first (undated first) with one entry
 * per date (the later one in file order wins).
 */
export function maxHistoryFromWire(wire: unknown): Record<string, MaxHistoryEntry[]> {
  const result: Record<string, MaxHistoryEntry[]> = {};
  if (typeof wire !== "object" || wire === null) {
    return result;
  }

  const record = wire as Record<string, unknown>;
  const rawHistory = record.maxHistory;
  if (record.version !== 1 || typeof rawHistory !== "object" || rawHistory === null || Array.isArray(rawHistory)) {
    return result;
  }

  for (const [exerciseId, rawEntries] of Object.entries(rawHistory)) {
    if (!Array.isArray(rawEntries)) {
      continue;
    }

    let entries: MaxHistoryEntry[] = [];
    for (const raw of rawEntries) {
      const entry = validHistoryEntry(raw);
      if (entry === undefined) {
        continue;
      }
      // A later duplicate of a date replaces the earlier one; undated entries
      // are kept as they come (two undated maxes are both "earliest").
      entries = entry.savedOn === null ? [...entries, entry] : recordMax(entries, entry.reps, entry.savedOn);
    }

    if (entries.length > 0) {
      result[exerciseId] = sortedHistory(entries);
    }
  }
  return result;
}

/** Converts an internal history to the stored shape (a copy; always version 1). */
export function maxHistoryToWire(history: Record<string, MaxHistoryEntry[]>): MaxHistoryWireV1 {
  const maxHistory: Record<string, MaxHistoryEntryWire[]> = {};
  for (const [exerciseId, entries] of Object.entries(history)) {
    if (entries.length > 0) {
      maxHistory[exerciseId] = entries.map((entry) => ({ savedOn: entry.savedOn, reps: entry.reps }));
    }
  }
  return { version: 1, maxHistory };
}

/** Returns the entry if it has a positive integer `reps` and a real date or null `savedOn`; otherwise undefined. */
function validHistoryEntry(raw: unknown): MaxHistoryEntry | undefined {
  if (typeof raw !== "object" || raw === null) {
    return undefined;
  }

  const { savedOn, reps } = raw as Record<string, unknown>;
  if (typeof reps !== "number" || !Number.isInteger(reps) || reps <= 0) {
    return undefined;
  }
  if (savedOn === null) {
    return { savedOn: null, reps };
  }
  if (typeof savedOn !== "string") {
    return undefined;
  }

  try {
    toDayNumber(savedOn);
    return { savedOn, reps };
  } catch {
    return undefined;
  }
}

/**
 * Reads the history from `storage`. Never throws: missing, unparsable or
 * inaccessible storage gives an empty history. Called by `loadSettings`.
 */
export function loadMaxHistory(storage: Storage, keys: ProgramStorageKeys): Record<string, MaxHistoryEntry[]> {
  try {
    const stored = storage.getItem(keys.maxHistory);
    if (stored === null) {
      return {};
    }
    return maxHistoryFromWire(JSON.parse(stored));
  } catch {
    return {};
  }
}

/** Writes the history to `storage` as JSON. May throw if storage is full or blocked. Called by `saveSettings`. */
export function saveMaxHistory(history: Record<string, MaxHistoryEntry[]>, storage: Storage, keys: ProgramStorageKeys): void {
  storage.setItem(keys.maxHistory, JSON.stringify(maxHistoryToWire(history)));
}
