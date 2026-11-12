import { hasDemo, loadDemo } from "../demo/registry";
import type { ItemView } from "../program/schedule";
import { itemDisplayName } from "../program/rotation";
import { element } from "./dom";
import { formatItemDose } from "./format";
import { openDemoView } from "./demoView";

/**
 * The "▶ Show me" button shared by Today's rows, the day plan's rows and the
 * log screen's header. It exists only when the exercise has a demo in the
 * registry (src/demo/registry.ts), so Explosive Endurance never gets one.
 *
 *   today.ts / dayPlan.ts / logScreen.ts
 *        │  renderShowMeButton(programId, item, className)
 *        ▼
 *   hasDemo(programId, exerciseId) ──no──▶ undefined (no button)
 *        │ yes (a cheap id lookup; the demos themselves are not built yet)
 *        ▼
 *   <button> ──tap──▶ openDemoView(loadDemo(programId, exerciseId), { title, dose, opener })
 *
 * The view opens at once with its header and a black stage; the demo is built
 * (a lazy chunk, once) and starts playing when loadDemo resolves.
 *
 * The button is always a SIBLING of a row's main button, so tapping the row
 * still opens the log screen (as with "Start EMOM").
 */

/** The text the view's header shows, worked out from the row's item. */
export interface ShowMeHeaderText {
  /** The exercise's display name, e.g. "High wall sit" (a rotated-in swap uses its own name). */
  title: string;
  /** The same dose text the row shows, e.g. "3 × 20s". */
  dose: string;
}

/**
 * What the Show me view's header says for `item`: the name and dose exactly as
 * the row shows them, so the view and the row can never disagree. Pure, so it
 * is unit tested without a DOM.
 */
export function showMeHeaderText(item: ItemView): ShowMeHeaderText {
  return { title: itemDisplayName(item), dose: formatItemDose(item).text };
}

/**
 * Builds the "▶ Show me" button for `item`, or returns undefined when program
 * `programId` has no demo for that exercise. `className` lets each screen style
 * it (Today and the plan use "item-show-me", the log header "log-show-me").
 * The demo and the renderer chunks are only loaded once the view is
 * opened, so building a screen full of these buttons stays cheap.
 */
export function renderShowMeButton(programId: string, item: ItemView, className: string): HTMLButtonElement | undefined {
  const exerciseId = item.exercise.id;
  if (!hasDemo(programId, exerciseId)) {
    return undefined;
  }

  const headerText = showMeHeaderText(item);

  const button = element("button", className, "▶ Show me");
  button.type = "button";
  // The visible text comes first in the accessible name (WCAG 2.5.3 label in name).
  button.setAttribute("aria-label", `Show me how, ${headerText.title}`);

  button.addEventListener("click", () => {
    openDemoView(loadDemo(programId, exerciseId), { title: headerText.title, dose: headerText.dose, opener: button });
  });
  return button;
}
