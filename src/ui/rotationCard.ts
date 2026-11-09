import "./rotation.css";
import type { WarmupRotation } from "../program/model";
import { element } from "./dom";

/**
 * The "Warm-up rotation" card on Today, shown on the first training day of a
 * swapped block of weeks (rotation.ts `isFirstRotationDay`) until "Got it".
 *
 *   ┌ Warm-up rotation                                   ┐
 *   │ From this week, swap: Single-leg hip thrust →      │
 *   │ Kickbacks, YTWI raises → Reverse fly, ...          │
 *   │ Also available: Tricep pushdown                    │
 *   │ [Got it]                                           │
 *   └────────────────────────────────────────────────────┘
 *
 * app.ts owns the dismissal; this file builds the DOM and maps the stored
 * dismissal.
 */

/** localStorage key holding the week number the card was dismissed for. */
export const ROTATION_DISMISSED_STORAGE_KEY = "explosive-endurance.rotation-dismissed";

/** Wire type for the dismissal: the stored text is just the week number. */
export type RotationDismissedWire = string;

/**
 * Converts stored text (untrusted, possibly null or corrupt) into the week
 * the card was dismissed for, or undefined when nothing valid is stored.
 * Called once at startup by app.ts.
 */
export function rotationDismissedFromWire(wire: RotationDismissedWire | null): number | undefined {
  if (wire === null || !/^[1-9][0-9]*$/.test(wire)) return undefined;
  return Number(wire);
}

/** Converts the dismissed week to its stored text. Called by app.ts when "Got it" is tapped. */
export function rotationDismissedToWire(dismissedWeek: number): RotationDismissedWire {
  return String(dismissedWeek);
}

/**
 * Builds the card. `swapDescriptions` are "<original name> → <new name>"
 * pairs (today.ts resolves the original names from the exercise library);
 * `onDismiss` is called by the "Got it" button.
 */
export function renderRotationCard(swapDescriptions: string[], rotation: WarmupRotation, onDismiss: () => void): HTMLElement {
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
  dismissButton.addEventListener("click", onDismiss);
  card.append(dismissButton);

  return card;
}
