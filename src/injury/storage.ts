import { addDaysToDate } from "../program/calendar";
import type { InjuryArea } from "../program/model";
import type { Injury, InjuryChoiceKind, InjuryChoices } from "./model";
import { clearInjury, flagInjury } from "./operations";
import { choicesFromWire, choicesToWire, injuriesFromWire, injuriesToWire } from "./wire";

/**
 * Persistence for the injuries and the per-date injury choices, modelled on
 * `noEquipment/storage.ts` (a minimal injected Storage-like object, so tests
 * need no DOM). Settings and Today (Injury 2, step 3) call the load functions
 * at startup and the save functions when the person acts.
 *
 *   keys.injuries        InjuriesWireV1        ⇄ Injury[]        (kept; carried by the JSON export and import)
 *   keys.injuryChoices   InjuryChoicesWireV1   ⇄ InjuryChoices   (throwaway, pruned after 14 days)
 *
 * Every save re-reads the stored value first and changes only what was asked,
 * so a second open copy of the app cannot have its changes overwritten.
 */

/** Choices older than this many days before today are dropped on save; the logged sets carry the lasting record. */
export const INJURY_CHOICE_RETENTION_DAYS = 14;

/** The subset of the Web Storage API this module uses. */
export interface InjuryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Result of a save; `error` is a readable reason the UI can show. */
export type SaveInjuriesResult = { ok: true; injuries: Injury[] } | { ok: false; error: string };

/** Result of `setInjuryChoice`. */
export type SetInjuryChoiceResult = { ok: true; choices: InjuryChoices } | { ok: false; error: string };

/** Reads the stored injuries. Never throws: missing, unreadable or malformed data gives an empty list (or whatever entries were valid). */
export function loadInjuries(storage: InjuryStorage, key: string): Injury[] {
  try {
    const storedText = storage.getItem(key);
    if (storedText === null) return [];
    return injuriesFromWire(JSON.parse(storedText));
  } catch {
    return [];
  }
}

/** Writes `injuries`, or returns the write failure. Never throws. Also used by the import to put an export file's injuries in place. */
export function saveInjuries(storage: InjuryStorage, key: string, injuries: Injury[]): SaveInjuriesResult {
  try {
    storage.setItem(key, JSON.stringify(injuriesToWire(injuries)));
    return { ok: true, injuries };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Flags a new injury and saves: re-reads the stored list, adds `injury` and
 * writes. Fails (nothing written) when the area already has an open injury.
 * Called by Settings' and Today's "I'm injured" flow with `from` set to the
 * real date.
 */
export function flagInjuryAndSave(storage: InjuryStorage, key: string, injury: Injury): SaveInjuriesResult {
  const flagged = flagInjury(loadInjuries(storage, key), injury);
  if (!flagged.ok) return flagged;

  return saveInjuries(storage, key, flagged.injuries);
}

/** Clears the open injury for `area` as of `date` and saves, re-reading first. Called by "My shoulder feels OK" (Injury 3). */
export function clearInjuryAndSave(storage: InjuryStorage, key: string, area: InjuryArea, date: string): SaveInjuriesResult {
  return saveInjuries(storage, key, clearInjury(loadInjuries(storage, key), area, date));
}

/** Reads all stored choices. Never throws: missing, unreadable or malformed data gives empty choices. */
export function loadInjuryChoices(storage: InjuryStorage, key: string): InjuryChoices {
  try {
    const storedText = storage.getItem(key);
    if (storedText === null) return new Map();
    return choicesFromWire(JSON.parse(storedText));
  } catch {
    return new Map();
  }
}

/**
 * The item keys with the "addBack" choice on one date, for Today to build
 * its session from (`applyInjuries` takes this set). Empty when there are none.
 */
export function addBackKeysForDate(choices: InjuryChoices, date: string): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const [itemKey, kind] of choices.get(date) ?? []) {
    if (kind === "addBack") keys.add(itemKey);
  }
  return keys;
}

/**
 * The item keys with the "halfSets" choice ("Half sets today") on one date,
 * for `applyReturnToTraining`. Empty when there are none.
 */
export function halfSetsKeysForDate(choices: InjuryChoices, date: string): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const [itemKey, kind] of choices.get(date) ?? []) {
    if (kind === "halfSets") keys.add(itemKey);
  }
  return keys;
}

/**
 * Sets (`choice` given) or removes (`choice` undefined) one item's choice on
 * one date and saves. Read-modify-write like `setTick`. OTHER dates more than
 * `INJURY_CHOICE_RETENTION_DAYS` before `today` are pruned and an emptied
 * date is removed; the date being written is never pruned. `today` is passed
 * in so tests are deterministic. Never throws.
 */
export function setInjuryChoice(
  storage: InjuryStorage,
  key: string,
  date: string,
  itemKey: string,
  choice: InjuryChoiceKind | undefined,
  today: string,
): SetInjuryChoiceResult {
  const choices = loadInjuryChoices(storage, key);

  const choicesOfDate = new Map(choices.get(date) ?? []);
  if (choice === undefined) choicesOfDate.delete(itemKey);
  else choicesOfDate.set(itemKey, choice);
  choices.set(date, choicesOfDate);

  const oldestKeptDate = addDaysToDate(today, -INJURY_CHOICE_RETENTION_DAYS);
  for (const storedDate of [...choices.keys()]) {
    const isTooOld = storedDate !== date && storedDate < oldestKeptDate; // YYYY-MM-DD strings sort chronologically
    const isEmpty = (choices.get(storedDate)?.size ?? 0) === 0;
    if (isTooOld || isEmpty) choices.delete(storedDate);
  }

  try {
    storage.setItem(key, JSON.stringify(choicesToWire(choices)));
    return { ok: true, choices };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
