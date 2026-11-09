/** Name shown in the page heading; will later come from the program data. */
export const APP_TITLE = "Explosive Endurance";

/**
 * Builds the HTML for the temporary skeleton screen.
 *
 * Exists so the skeleton has one small piece of real, testable logic. Called
 * by `main.ts` at startup; replaced by the real "Today" screen in a later
 * PR 1 step. Pure function: no DOM access, so it can be unit tested in Node.
 */
export function buildPlaceholderHtml(title: string): string {
  return `<main class="placeholder"><h1>${title}</h1></main>`;
}
