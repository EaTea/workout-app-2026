import type { Range } from "../program/model";
import type { BlockView, ItemView, RepTarget, SetView } from "../program/schedule";

/**
 * Pure text formatting for the Today screen and the exercise sheet.
 * Everything here turns already-computed `SessionView` data into strings;
 * it never does training arithmetic (that lives in program/schedule.ts).
 *
 *   ItemView ──▶ formatItemDose        "5 / min", "6 × 6", "Set max"
 *            ──▶ formatItemDetails     ["Rest 30–45s", "per side", ...]
 *            ──▶ formatSetBreakdown    "8–10 heavy, then 15–25 moderate ×2"
 */

/** Typographic separators used across the UI. */
const EN_DASH = "–";
const MULTIPLY = "×";
const DOT = " · ";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Friendly names for the block type ids used in program.json. One place to edit. */
const BLOCK_LABELS: Record<string, string> = {
  warmup: "Warm-up",
  explosive: "Explosive",
  mainStrength: "Main strength",
  miniDose: "Mini-dose",
  core: "Core",
  finisher: "Finisher",
};

/** The big right-hand figure of an item row, plus optional extras. */
export interface ItemDose {
  /** Main figure, e.g. "6 × 6" or "Set max". */
  text: string;
  /** Smaller line under it, e.g. "9 min" for an EMOM. */
  subtext?: string;
  /** Set when the figure depends on a max Ed hasn't entered; the UI links to Settings. */
  needsMaxExerciseId?: string;
}

/** "12–15" for a real range, "6" when both ends match. */
export function formatRange(range: Range): string {
  return range.min === range.max ? String(range.min) : `${range.min}${EN_DASH}${range.max}`;
}

/** Text for one rep target; a missing max reads "Set max". */
export function formatRepTarget(target: RepTarget): string {
  switch (target.kind) {
    case "fixed":
      return String(target.count);
    case "range":
      return `${target.min}${EN_DASH}${target.max}`;
    case "text":
      return target.text;
    case "needsMax":
      return "Set max";
  }
}

/** "Mon 9 Nov" from "2026-11-09". Used in the Today header and "Program starts ..." line. */
export function formatShortDate(calendarDate: string): string {
  const [year = 0, month = 1, day = 1] = calendarDate.split("-").map(Number);
  const weekday = WEEKDAY_NAMES[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${weekday} ${day} ${MONTH_NAMES[month - 1]}`;
}

/** Small header line, e.g. "Mon 9 Nov · Week 2 of 8". */
export function formatSessionKicker(calendarDate: string, week: number, lengthWeeks: number): string {
  return `${formatShortDate(calendarDate)}${DOT}Week ${week} of ${lengthWeeks}`;
}

/** Friendly label for a block type id; unknown ids fall back to the raw id. */
export function blockLabel(type: string): string {
  return BLOCK_LABELS[type] ?? type;
}

/** Block card title, e.g. "1 · Warm-up · 2 rounds" or "3 · Main strength · 9 min". */
export function formatBlockTitle(position: number, block: BlockView): string {
  const parts = [String(position), blockLabel(block.type)];

  if (block.rounds) {
    parts.push(`${formatRange(block.rounds)} ${block.rounds.max === 1 ? "round" : "rounds"}`);
  } else if (block.minutes !== undefined) {
    parts.push(`${block.minutes} min`);
  } else if (block.format === "superset") {
    parts.push("superset");
  }

  return parts.join(DOT);
}

/** True when every set has the same target text, so "N × target" is accurate. */
function setsAreUniform(sets: SetView[]): boolean {
  const [firstSet] = sets;
  if (!firstSet) return true;
  const first = describeSet(firstSet);
  return sets.every((set) => describeSet(set) === first);
}

/** A set reduced to "reps load" text, used to compare and group sets. */
function describeSet(set: SetView): string {
  const reps = set.target ? formatRepTarget(set.target) : "";
  return set.load ? `${reps} ${set.load}`.trim() : reps;
}

/** The first set's needsMax target, if any set depends on a missing max. */
function missingMaxExerciseId(item: ItemView): string | undefined {
  const candidates = [item.target, ...item.sets.map((set) => set.target)];
  for (const target of candidates) {
    if (target?.kind === "needsMax") {
      return target.exerciseId;
    }
  }
  return undefined;
}

/**
 * The dose shown at the right of an item row. Examples:
 * "6 × 6", "5 / min" (+ "9 min"), "4–5 × 20–30s", "2 × 30s", "12–15",
 * "3 sets" (per-set prescriptions), "Set max".
 */
export function formatItemDose(item: ItemView): ItemDose {
  const needsMaxExerciseId = missingMaxExerciseId(item);
  if (needsMaxExerciseId !== undefined) {
    return { text: "Set max", needsMaxExerciseId };
  }

  if (item.format === "emom" && item.minutes !== undefined) {
    const perMinute = item.target ? `${formatRepTarget(item.target)} / min` : "EMOM";
    return { text: perMinute, subtext: `${item.minutes} min` };
  }

  if (item.rounds && item.workSec) {
    return { text: `${formatRange(item.rounds)} ${MULTIPLY} ${formatRange(item.workSec)}s` };
  }

  if (item.sets.length > 0) {
    const count = item.sets.length;

    if (item.durationSec !== undefined && item.sets.every((set) => !set.target)) {
      return { text: `${count} ${MULTIPLY} ${item.durationSec}s` };
    }
    if (!setsAreUniform(item.sets)) {
      return { text: `${count} sets` };
    }
    const target = item.sets[0]?.target;
    return { text: target ? `${count} ${MULTIPLY} ${formatRepTarget(target)}` : `${count} sets` };
  }

  if (item.target) {
    return { text: formatRepTarget(item.target) };
  }
  if (item.durationSec !== undefined) {
    return { text: `${item.durationSec}s` };
  }
  return { text: "" };
}

/**
 * Describes sets that differ, grouping neighbours:
 * "8–10 heavy, then 15–25 moderate ×2". Returns undefined when the sets are
 * uniform (the dose already says everything) or there are none.
 */
export function formatSetBreakdown(item: ItemView): string | undefined {
  if (item.sets.length === 0 || setsAreUniform(item.sets)) {
    return undefined;
  }

  const groups: { text: string; count: number }[] = [];
  for (const set of item.sets) {
    const text = describeSet(set);
    const last = groups[groups.length - 1];
    if (last && last.text === text) {
      last.count += 1;
    } else {
      groups.push({ text, count: 1 });
    }
  }

  return groups.map((group) => (group.count > 1 ? `${group.text} ${MULTIPLY}${group.count}` : group.text)).join(", then ");
}

/**
 * The secondary line facts for an item, in reading order. Only data present
 * in the view is shown (nothing is invented).
 */
export function formatItemDetails(item: ItemView): string[] {
  const details: string[] = [];

  const breakdown = formatSetBreakdown(item);
  if (breakdown) details.push(breakdown);
  if (item.restSec) details.push(`Rest ${formatRange(item.restSec)}s`);
  if (item.perSide) details.push("per side");
  if (item.tempo) details.push(`tempo: ${item.tempo}`);
  if (item.load) details.push(item.load.charAt(0).toUpperCase() + item.load.slice(1));
  if (item.weeklyIncrease) details.push(`${item.weeklyIncrease} each week`);
  if (item.note) details.push(item.note);
  if (item.optional) details.push("optional");

  return details;
}

/** One-line prescription for the exercise sheet: dose plus the item's details. */
export function formatPrescriptionSummary(item: ItemView): string {
  const dose = formatItemDose(item);
  const doseText = dose.subtext ? `${dose.text}, ${dose.subtext}` : dose.text;
  return [doseText, ...formatItemDetails(item)].filter((part) => part !== "").join(DOT);
}
