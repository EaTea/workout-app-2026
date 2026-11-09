import { element } from "./dom";

/** Wording of the banner shown when Today was left open past midnight. */
export const NEW_DAY_MESSAGE = "It's a new day.";
export const NEW_DAY_BUTTON_LABEL = "Show today's session";

/**
 * Builds the banner app.ts inserts at the top of Today when the local date
 * has changed since the screen was drawn. It deliberately does not swap the
 * session itself (that could replace the workout under someone training at
 * 23:30 and lose scroll position); `onShowToday` is called only when Ed taps
 * the button, and app.ts then re-renders Today for the new date.
 *
 * Reuses the amber warning-banner look, with one big tap target:
 *
 *   ┌ It's a new day.                                  ┐
 *   │ [            Show today's session              ] │
 *   └──────────────────────────────────────────────────┘
 */
export function renderNewDayBanner(onShowToday: () => void): HTMLElement {
  const banner = element("div", "card warning-banner new-day-banner");
  banner.setAttribute("role", "status");

  const button = element("button", "new-day-button", NEW_DAY_BUTTON_LABEL);
  button.type = "button";
  button.addEventListener("click", onShowToday);

  banner.append(element("p", "warning-banner-text", NEW_DAY_MESSAGE), button);
  return banner;
}
