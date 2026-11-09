import type { ProgramWarning } from "../program/model";
import { element } from "./dom";

/**
 * Builds the amber banner shown at the top of the Today screen when
 * program.json has fields the app doesn't recognise (see `ProgramWarning`).
 * Called by app.ts only when `warnings` is non-empty and the banner hasn't
 * been dismissed; `onDismiss` lets app.ts remember the dismissal for this
 * page load.
 *
 *   ┌ ⚠ program.json has 2 fields the app doesn't recognise... [Dismiss] ┐
 *   │ ▸ Show which fields   (expands to a list of paths)                  │
 *   └─────────────────────────────────────────────────────────────────────┘
 *
 * Built with createElement/textContent only (via `element`), because the
 * paths come from program.json.
 */
export function renderWarningBanner(warnings: ProgramWarning[], onDismiss: () => void): HTMLElement {
  const banner = element("div", "card warning-banner");
  banner.setAttribute("role", "status");

  const count = warnings.length;
  const noun = count === 1 ? "field" : "fields";
  const summaryText = `program.json has ${count} ${noun} the app doesn't recognise, so ${count === 1 ? "it was" : "they were"} ignored`;

  const header = element("div", "warning-banner-header");
  const dismissButton = element("button", "warning-dismiss", "Dismiss");
  dismissButton.type = "button";
  dismissButton.addEventListener("click", onDismiss);
  header.append(element("p", "warning-banner-text", summaryText), dismissButton);

  const details = element("details", "warning-details");
  const pathList = element("ul", "warning-paths");
  for (const warning of warnings) {
    pathList.append(element("li", undefined, warning.path));
  }
  details.append(element("summary", undefined, "Show which fields"), pathList);

  banner.append(header, details);
  return banner;
}
