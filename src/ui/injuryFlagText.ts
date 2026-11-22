import type { Injury, InjurySide } from "../injury/model";
import type { InjuryArea, Program } from "../program/model";
import { formatShortDate } from "./format";

/*
 * The words of the injury flag: the Settings section, Today's banner and the
 * "When to get it checked" sheet. Pure functions (no DOM) so the wording is
 * unit tested; `injuryFlagUi.ts` draws them. Nothing here diagnoses anything
 * or says an area is ready to load again (PLAN.md, "train around an injury").
 *
 *   Injury ──▶ injuryTitleLine ──▶ "Right shoulder · since 22 Nov"   (banner, Settings)
 *   area   ──▶ checkedSheetText ──▶ heading + paragraphs + bullets    (the sheet)
 */

/** The label shown for each area in the picker and in lines of text. */
const AREA_LABELS: Record<InjuryArea, string> = {
  shoulder: "Shoulder",
};

/** The label for the side choices in the form. */
export const SIDE_LABELS: Record<InjurySide, string> = {
  left: "Left",
  right: "Right",
  both: "Both",
};

/** "Shoulder": the area's label as shown in the picker. */
export function areaLabel(area: InjuryArea): string {
  return AREA_LABELS[area];
}

/** "shoulder": the area inside a sentence ("Get your shoulder checked"). */
export function areaWord(area: InjuryArea): string {
  return AREA_LABELS[area].toLowerCase();
}

/** "Right shoulder", "Left shoulder" or "Both shoulders": the side and area together. */
export function sideAreaLabel(side: InjurySide, area: InjuryArea): string {
  if (side === "both") return `Both ${areaWord(area)}s`;
  return `${SIDE_LABELS[side]} ${areaWord(area)}`;
}

/** "Right shoulder · since 22 Nov": the first line of the banner and of the flagged Settings section. */
export function injuryTitleLine(injury: Pick<Injury, "area" | "side" | "from">): string {
  return `${sideAreaLabel(injury.side, injury.area)} · since ${formatShortDate(injury.from)}`;
}

/** "Right shoulder · 22 Nov to 3 Dec": a past (cleared) injury as one plain line. A same-day flag shows a single date. */
export function pastInjuryLine(injury: Pick<Injury, "area" | "side" | "from" | "to">): string {
  const label = sideAreaLabel(injury.side, injury.area);
  const start = formatShortDate(injury.from);
  if (injury.to === undefined || injury.to === injury.from) return `${label} · ${start}`;
  return `${label} · ${start} to ${formatShortDate(injury.to)}`;
}

/** The line under the banner title. Kept in one place so the banner and its test agree. */
export const BANNER_ADVICE = "Pain-free only.";

/** The confirmation shown before clearing a flag; the app asks nothing medical and says so. */
export function clearConfirmationText(area: InjuryArea): string {
  return `The app can't tell whether your ${areaWord(area)} is ready. If a physio or doctor has given you a plan, follow theirs.`;
}

/** The button that starts clearing: "My shoulder feels OK". */
export function clearButtonLabel(area: InjuryArea): string {
  return `My ${areaWord(area)} feels OK`;
}

/**
 * True when the program tags any exercise with `loads` (Explosive Endurance),
 * so Settings and Today only offer injuries where the program knows how to
 * train around them. Steady Strength has none and shows nothing.
 */
export function programSupportsInjuries(program: Pick<Program, "exercises">): boolean {
  return Object.values(program.exercises).some((exercise) => exercise.loads !== undefined);
}

/** The words of the "When to get it checked" sheet. */
export interface CheckedSheetText {
  heading: string;
  intro: string;
  redFlagsLead: string;
  redFlags: string[];
  whileFlagged: string;
  closing: string;
}

/**
 * The "When to get it checked" sheet for `area`, in the wording agreed in
 * PLAN.md (each area will get its own red flags; the shoulder's are here).
 * `injuryFlagUi.ts` lays it out, and shows it once when the flag is set and
 * again from the Today banner.
 */
export function checkedSheetText(area: InjuryArea): CheckedSheetText {
  const word = areaWord(area);

  return {
    heading: `Get your ${word} checked`,
    intro: "This isn't medical advice, and the app can't tell how bad an injury is.",
    redFlagsLead: `Get your ${word} checked by a doctor or physio soon if any of these happen:`,
    redFlags: [
      "You can't lift the arm, or it feels weak or unstable.",
      "It popped, slipped out or changed shape, or you fell on it.",
      "Numbness, tingling or pins and needles run down the arm.",
      "It's very swollen or bruised, or the pain keeps you awake.",
      "It isn't getting better after a week or two.",
    ],
    whileFlagged:
      "While it's flagged, train only what's pain-free. Mild discomfort that settles straight away is OK. If anything is worse the next morning, drop it again.",
    closing: `The app doesn't decide when you're ready to load the ${word} again. A physio's plan beats the app's.`,
  };
}
