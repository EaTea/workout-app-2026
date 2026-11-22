import type { InjuryArea } from "../program/model";
import type { ItemView } from "../program/schedule";
import { formatPrescriptionSummary } from "./format";

/*
 * The words of the exercise sheet's "Your shoulder" section, kept as pure
 * functions so they can be unit tested without a DOM:
 *
 *   level (loads.shoulder)   stand-in?   sentence
 *   avoid                    yes         Loads the shoulder. ... <name> replaces it: <dose>
 *   avoid                    no          Loads the shoulder. ... it's left out, ... add it back ...
 *   caution                  yes         Can load a sore shoulder. ... <name> replaces it: <dose>
 *   caution                  no          Can load a sore shoulder. ... it stays in, pain-free only.
 *
 * `exerciseSheet.ts` calls `injurySectionLine`; nothing here changes what
 * Today or the log screen show. Only while the shoulder is flagged on the date.
 */

/** The area these words are written for (the only one so far). */
const AREA: InjuryArea = "shoulder";

/**
 * The sentence for the "Your shoulder" section, or undefined when the item
 * is untagged for the shoulder (no `loads.shoulder` on its exercise and no
 * `injury.shoulder` stand-in) or the shoulder is not flagged on the date
 * (`isShoulderFlagged`: the section is about what Today does while flagged,
 * so it is shown only then), so the sheet shows no section at all. A
 * stand-in without a level in the file is worded as "avoid", the stricter
 * reading. The dose is the stand-in's own view for this week (built by the
 * schedule, so deloads and weekly increases already apply). For a ticked
 * "No equipment" row the words still describe the original item.
 */
export function injurySectionLine(item: Pick<ItemView, "exercise" | "injury" | "swappedFrom">, isShoulderFlagged: boolean): string | undefined {
  if (!isShoulderFlagged) return undefined;

  // An injury wins over the "No equipment" tick: on a ticked row the sheet gets the
  // swap's view, so the level comes from the ORIGINAL exercise (`swappedFrom`), and the
  // stand-in from the `injury` views `applyNoEquipmentChoices` carried over.
  // Today the ⓘ button isn't shown on rotated warm-up rows (logScreen.ts), so a
  // rotated swap's own `loads` (effectiveLoads in rotation.ts) never reaches here.
  const level = (item.swappedFrom ?? item.exercise).loads?.[AREA];
  const standIn = item.injury?.[AREA];
  if (level === undefined && standIn === undefined) return undefined;

  const intro = level === "caution" ? "Can load a sore shoulder." : "Loads the shoulder.";

  if (standIn !== undefined) {
    return `${intro} While your shoulder is flagged, ${standIn.exercise.name} replaces it: ${formatPrescriptionSummary(standIn)}`;
  }
  if (level === "caution") {
    return `${intro} While your shoulder is flagged, it stays in, pain-free only.`;
  }
  return `${intro} While your shoulder is flagged, it's left out, and you can add it back for a day at half the sets.`;
}

/**
 * The stand-in's cues for the "Your shoulder" section (as the "No equipment"
 * section lists its swap's cues), or an empty list when the item has no
 * shoulder stand-in. Called by `exerciseSheet.ts` after `injurySectionLine`.
 */
export function injuryStandInCues(item: Pick<ItemView, "injury">): string[] {
  return item.injury?.[AREA]?.exercise.cues ?? [];
}
