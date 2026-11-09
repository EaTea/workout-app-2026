import type { ProgramWarning } from "../program/model";
import { element } from "./dom";

/**
 * Moves keyboard/screen-reader focus to the Today screen's main heading (the
 * session title, or the card title on message screens). Called right after
 * Dismiss removes the banner, because the focused Dismiss button disappears
 * with it and focus would otherwise fall back to the top of the page.
 * Headings aren't focusable by default, so `tabindex=-1` is set here
 * (focusable by script, not part of the Tab order).
 */
export function focusMainHeading(): void {
  const heading = document.querySelector<HTMLElement>(".app-main h1, .app-main .message-card .card-title");
  if (heading === null) return;

  heading.setAttribute("tabindex", "-1");
  heading.focus();
}

/**
 * Builds the amber banner shown at the top of the Today screen when
 * program.json has fields the app doesn't recognise (see `ProgramWarning`).
 * Called by app.ts only when `warnings` is non-empty and the banner hasn't
 * been dismissed; `onDismiss` lets app.ts remember the dismissal for this
 * page load (it re-renders; the banner then moves focus to the heading).
 *
 * A misspelt optional field silently changes the session, so when any warning
 * carries a "did you mean" suggestion the wording is stronger and the list is
 * expanded by default instead of collapsed:
 *
 *   ┌ ⚠ program.json has 2 fields ... may be typos ...        [Dismiss] ┐
 *   │ ▾ Show which fields                                                │
 *   │    days[0]...weeklyIncreese  unknown field, ignored — did you mean │
 *   │                              "weeklyIncrease"?                     │
 *   └────────────────────────────────────────────────────────────────────┘
 *
 * Built with createElement/textContent only (via `element`), because the
 * paths come from program.json.
 */
export function renderWarningBanner(warnings: ProgramWarning[], onDismiss: () => void): HTMLElement {
  const banner = element("div", "card warning-banner");
  banner.setAttribute("role", "status");

  const count = warnings.length;
  const noun = count === 1 ? "field" : "fields";
  const hasSuggestion = warnings.some((warning) => warning.suggestion !== undefined);
  const summaryText = hasSuggestion
    ? `program.json has ${count} ${noun} the app doesn't recognise. Some look like typos, so parts of today's session may be missing.`
    : `program.json has ${count} ${noun} the app doesn't recognise, so ${count === 1 ? "it was" : "they were"} ignored`;

  const header = element("div", "warning-banner-header");
  const dismissButton = element("button", "warning-dismiss", "Dismiss");
  dismissButton.type = "button";
  dismissButton.addEventListener("click", () => {
    onDismiss();
    focusMainHeading();
  });
  header.append(element("p", "warning-banner-text", summaryText), dismissButton);

  const details = element("details", "warning-details");
  details.open = hasSuggestion;

  const warningList = element("ul", "warning-paths");
  for (const warning of warnings) {
    const item = element("li");
    item.append(element("span", "warning-path", warning.path), element("span", "warning-message", warning.message));
    warningList.append(item);
  }
  details.append(element("summary", undefined, "Show which fields"), warningList);

  banner.append(header, details);
  return banner;
}
