import { toDayNumber } from "../program/calendar";
import { INJURY_AREAS, type InjuryArea } from "../program/model";
import { INJURY_CHOICE_KINDS, INJURY_SIDES, type Injury, type InjuryChoiceKind, type InjuryChoices, type InjurySide } from "./model";

/**
 * Stored (JSON) shapes of the injuries and the injury choices, and their
 * mappings to the internal types in `model.ts`. Only these four functions
 * convert; `storage.ts` calls them on load and save.
 *
 *   injuries:  { "version": 1, "injuries": [ { "area": "shoulder", "side": "right", "from": "2026-11-22", "note": "..." } ] }
 *   choices:   { "version": 1, "choices": { "2026-11-23": { "3:pull_up": "addBack" } } }
 *
 * Loading is tolerant, like the no-equipment ticks: a wrong version or shape
 * gives nothing, and a bad entry is skipped without a crash. A damaged value
 * is dropped without a `.corrupt-` backup (an injury flag is cheap to set again).
 */

/** One stored injury. `to` and `note` are left out when absent. */
export interface InjuryWire {
  area: string;
  side: string;
  from: string;
  to?: string;
  note?: string;
}

/** Format v1 of the stored injuries. */
export interface InjuriesWireV1 {
  version: 1;
  injuries: InjuryWire[];
}

/** Format v1 of the stored choices: a choice kind per item key per YYYY-MM-DD date. Another kind is added later by widening the kind's values. */
export interface InjuryChoicesWireV1 {
  version: 1;
  choices: Record<string, Record<string, string>>;
}

/** Same item-key shape as the no-equipment ticks: "<position>:<id>" or "<day>.<position>:<id>". */
const ITEM_KEY_PATTERN = /^(\d+\.)?\d+:[a-z0-9_]+$/;

/** Converts internal injuries to the stored shape, in the order given. Absent `to` and `note` are left out of the JSON. */
export function injuriesToWire(injuries: readonly Injury[]): InjuriesWireV1 {
  return {
    version: 1,
    injuries: injuries.map((injury) => {
      const wire: InjuryWire = { area: injury.area, side: injury.side, from: injury.from };
      if (injury.to !== undefined) wire.to = injury.to;
      if (injury.note !== undefined) wire.note = injury.note;
      return wire;
    }),
  };
}

/**
 * Converts untrusted parsed JSON to internal injuries. Never throws. An
 * injury is skipped when its area is not a known area, its side is not
 * left/right/both, or `from` is not a real date. A bad `to` (not a real date,
 * or before `from`) is dropped, leaving the injury flagged (the cautious
 * reading); a `note` that is not text is dropped.
 */
export function injuriesFromWire(wire: unknown): Injury[] {
  if (!isRecord(wire) || wire.version !== 1 || !Array.isArray(wire.injuries)) return [];

  const injuries: Injury[] = [];
  for (const rawInjury of wire.injuries) {
    if (!isRecord(rawInjury)) continue;

    const { area, side, from, to, note } = rawInjury;
    if (!isInjuryArea(area) || !isInjurySide(side) || typeof from !== "string" || !isRealCalendarDate(from)) continue;

    const injury: Injury = { area, side, from };
    if (typeof to === "string" && isRealCalendarDate(to) && to >= from) injury.to = to; // YYYY-MM-DD strings sort chronologically
    if (typeof note === "string" && note !== "") injury.note = note;
    injuries.push(injury);
  }

  return injuries;
}

/** Converts internal choices to the stored shape, with dates and keys sorted so the JSON is stable. Dates with no choices are left out. */
export function choicesToWire(choices: InjuryChoices): InjuryChoicesWireV1 {
  const wireChoices: Record<string, Record<string, string>> = {};

  for (const date of [...choices.keys()].sort()) {
    const choicesOfDate = choices.get(date) ?? new Map<string, InjuryChoiceKind>();
    if (choicesOfDate.size === 0) continue;

    const wireDate: Record<string, string> = {};
    for (const itemKey of [...choicesOfDate.keys()].sort()) wireDate[itemKey] = choicesOfDate.get(itemKey) as string;
    wireChoices[date] = wireDate;
  }

  return { version: 1, choices: wireChoices };
}

/**
 * Converts untrusted parsed JSON to internal choices. Never throws: a wrong
 * version or shape gives empty choices; a date that is not real, an item key
 * of the wrong shape and a choice kind this version doesn't know are each
 * dropped (a date left with no choices is dropped too).
 */
export function choicesFromWire(wire: unknown): InjuryChoices {
  const choices: InjuryChoices = new Map();
  if (!isRecord(wire) || wire.version !== 1 || !isRecord(wire.choices)) return choices;

  for (const [date, rawDateChoices] of Object.entries(wire.choices)) {
    if (!isRealCalendarDate(date) || !isRecord(rawDateChoices)) continue;

    const choicesOfDate = new Map<string, InjuryChoiceKind>();
    for (const [itemKey, rawKind] of Object.entries(rawDateChoices)) {
      if (ITEM_KEY_PATTERN.test(itemKey) && isChoiceKind(rawKind)) choicesOfDate.set(itemKey, rawKind);
    }
    if (choicesOfDate.size > 0) choices.set(date, choicesOfDate);
  }

  return choices;
}

/** True for a plain JSON object (not null, not an array). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True for a known injury area. */
function isInjuryArea(value: unknown): value is InjuryArea {
  return typeof value === "string" && (INJURY_AREAS as readonly string[]).includes(value);
}

/** True for left, right or both. */
function isInjurySide(value: unknown): value is InjurySide {
  return typeof value === "string" && (INJURY_SIDES as readonly string[]).includes(value);
}

/** True for a choice kind this version knows. */
function isChoiceKind(value: unknown): value is InjuryChoiceKind {
  return typeof value === "string" && (INJURY_CHOICE_KINDS as readonly string[]).includes(value);
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
