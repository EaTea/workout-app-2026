import "./rotation.css";
import type { WarmupRotation } from "../program/model";
import { PREVIEW_SAVING_OFF_MESSAGE } from "./checkin";
import { element } from "./dom";

/**
 * The "Warm-up rotation" card on Today, shown on every training day of a
 * swapped block of weeks (rotation.ts `rotationBlockStartWeek`) until "Got it".
 *
 *   ┌ Warm-up rotation                                   ┐
 *   │ From this week, swap: Single-leg hip thrust →      │
 *   │ Kickbacks, YTWI raises → Reverse fly, ...          │
 *   │ Also available: Tricep pushdown                    │
 *   │ [Got it]                                           │
 *   └────────────────────────────────────────────────────┘
 *
 * In a `?date=` preview (`canDismiss` false) "Got it" is disabled and a line
 * says saving is off, like the other cards: a preview changes nothing stored.
 * app.ts owns the dismissal; this file builds the DOM and maps the stored
 * dismissal.
 */

/**
 * Wire type for the dismissal: stored text. Written as a JSON array of the
 * dismissed blocks' first weeks (for example "[5]"); an older build wrote just
 * the week number ("5"), which is still read.
 */
export type RotationDismissedWire = string;

/**
 * Converts stored text (untrusted, possibly null or corrupt) into the list of
 * block first-weeks whose card was dismissed; empty when nothing valid is
 * stored. Reads both the current "[5]" shape and the older bare "5". Called
 * once at startup by app.ts.
 */
export function rotationDismissedFromWire(wire: RotationDismissedWire | null): number[] {
  if (wire === null) return [];
  if (/^[1-9][0-9]*$/.test(wire)) return [Number(wire)];

  try {
    const parsed: unknown = JSON.parse(wire);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is number => Number.isInteger(entry) && entry >= 1);
  } catch {
    return [];
  }
}

/** Converts the dismissed block first-weeks to their stored text. Called by app.ts when "Got it" is tapped. */
export function rotationDismissedToWire(dismissedBlockWeeks: number[]): RotationDismissedWire {
  return JSON.stringify(dismissedBlockWeeks);
}

/**
 * Builds the card. `swapDescriptions` are "<original name> → <new name>"
 * pairs (today.ts resolves the original names from the exercise library);
 * `onDismiss` is called by the "Got it" button, which is disabled when
 * `canDismiss` is false.
 */
export function renderRotationCard(swapDescriptions: string[], rotation: WarmupRotation, onDismiss: () => void, canDismiss = true): HTMLElement {
  const card = element("section", "card rotation-card");
  card.append(
    element("h2", "card-title", "Warm-up rotation"),
    element("p", "rotation-swaps", `From this week, swap: ${swapDescriptions.join(", ")}`),
  );

  if (rotation.alsoAvailable.length > 0) {
    card.append(element("p", "rotation-also", `Also available: ${rotation.alsoAvailable.join(", ")}`));
  }

  const dismissButton = element("button", "rotation-dismiss", "Got it");
  dismissButton.type = "button";
  dismissButton.disabled = !canDismiss;
  dismissButton.addEventListener("click", onDismiss);
  card.append(dismissButton);

  if (!canDismiss) {
    card.append(element("p", "preview-note", PREVIEW_SAVING_OFF_MESSAGE));
  }

  return card;
}
