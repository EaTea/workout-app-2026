import type { MaxHistoryEntry } from "./model";

/**
 * Pure helpers for the per-exercise history of saved maxes
 * (`TrainingSettings.maxHistory`). A history is a list of entries ordered
 * oldest first, with at most one entry per calendar day; an entry with
 * `savedOn: null` (a max saved before dates were recorded) sorts before every
 * dated one.
 *
 * Callers: the settings screen and the retest card append entries when a max
 * is saved; the schedule asks `maxInEffectOn` which max a past day used; the
 * storage mapping uses `sortedHistory` to keep stored data well ordered.
 */

/** Orders entries oldest first; undated ("unknown, earliest") entries come first. Returns a new array. */
export function sortedHistory(entries: readonly MaxHistoryEntry[]): MaxHistoryEntry[] {
  return [...entries].sort((first, second) => {
    if (first.savedOn === second.savedOn) {
      return 0;
    }
    if (first.savedOn === null) {
      return -1;
    }
    if (second.savedOn === null) {
      return 1;
    }
    return first.savedOn < second.savedOn ? -1 : 1;
  });
}

/**
 * Returns the history after saving `reps` on `date`: a new entry, or, if an
 * entry for that same day already exists, that entry replaced (two saves on
 * one day are one correction, not two maxes). The input is not modified.
 */
export function recordMax(history: readonly MaxHistoryEntry[], reps: number, date: string): MaxHistoryEntry[] {
  const otherDays = history.filter((entry) => entry.savedOn !== date);
  return sortedHistory([...otherDays, { savedOn: date, reps }]);
}

/**
 * The max that was in effect on `date` ("YYYY-MM-DD"): the latest entry dated
 * on or before it. Undated entries count as older than any date. If every
 * entry is dated after `date`, falls back to the earliest entry (the best
 * information there is). Returns undefined only for an empty history.
 * ISO dates compare correctly as strings.
 */
export function maxInEffectOn(history: readonly MaxHistoryEntry[], date: string): number | undefined {
  const ordered = sortedHistory(history);

  let inEffect: MaxHistoryEntry | undefined;
  for (const entry of ordered) {
    if (entry.savedOn === null || entry.savedOn <= date) {
      inEffect = entry;
    }
  }

  return (inEffect ?? ordered[0])?.reps;
}
