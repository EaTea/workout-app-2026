import { element } from "./dom";
import { formatShortDate } from "./format";

/**
 * The slim "Previewing 16 Nov · back to today" strip shown at the top of
 * Today and the log screen while the page address carries a `?date=`
 * preview (rule 8), so a preview is never mistaken for the real day.
 * Built by app.ts's render for those two screens.
 *
 *   ?date=2026-11-16 ──▶ renderPreviewStrip("2026-11-16") ──▶ [Previewing 16 Nov · back to today]
 */

/**
 * Builds the strip for `previewDate` ("YYYY-MM-DD"). "back to today" is a
 * plain link to the same page without the query string, which reloads the app
 * on the real date.
 */
export function renderPreviewStrip(previewDate: string): HTMLElement {
  const strip = element("div", "preview-strip");

  const backLink = element("a", "preview-strip-link", "back to today");
  backLink.href = `${window.location.pathname}#/today`;

  strip.append(`Previewing ${formatShortDate(previewDate)} · `, backLink);
  return strip;
}
