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
 * Today or the log screen show.
 */

/** The area these words are written for (the only one so far). */
const AREA: InjuryArea = "shoulder";

/**
 * The sentence for the "Your shoulder" section, or undefined when the item
 * is untagged for the shoulder (no `loads.shoulder` on its exercise and no
 * `injury.shoulder` stand-in), so the sheet shows no section at all. A
 * stand-in without a level in the file is worded as "avoid", the stricter
 * reading. The dose is the stand-in's own view for this week (built by the
 * schedule, so deloads and weekly increases already apply).
 */
export function injurySectionLine(item: Pick<ItemView, "exercise" | "injury">): string | undefined {
  const level = item.exercise.loads?.[AREA];
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
