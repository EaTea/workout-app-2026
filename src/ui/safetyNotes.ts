import { element } from "./dom";
import { openSheet } from "./exerciseSheet";
import "./safetyNotes.css";

/**
 * The program's safety notes (`program.safety`) shown in two places, so the
 * person can always find them again after the first visit:
 *
 *   Overview ──▶ renderSafetyNotesCard      "Before you start" card, last card above the pinned Start bar
 *   Today    ──▶ renderSafetyNotesLink      small "Safety notes" button under the header
 *                  └─ tap ─▶ openSheet(...)  the same bottom sheet as the exercise details
 *
 * Both only draw the strings they are given; the notes are never gating: the
 * Start button works whether or not the card was read (PLAN.md, PR 14).
 */

/** The notes as a list, one `<li>` each; shared by the card and the sheet. */
function renderNoteList(notes: string[]): HTMLElement {
  const list = element("ul", "safety-notes-list");
  for (const note of notes) {
    list.append(element("li", undefined, note));
  }
  return list;
}

/**
 * The Overview's "Before you start" card. Shown every time the Overview is
 * shown (not only before starting), in calm amber so it reads as a notice
 * rather than an error. Called by renderOverviewScreen when the program has
 * safety notes.
 */
export function renderSafetyNotesCard(notes: string[]): HTMLElement {
  const card = element("section", "card safety-notes-card");
  card.append(element("h2", "safety-notes-title", "Before you start"), renderNoteList(notes));
  return card;
}

/**
 * Today's small "Safety notes" link-styled button. Opens the full list in the
 * bottom sheet; the sheet's Close button, Escape, the backdrop and the Back
 * button all close it and focus returns to this button. Called by
 * renderTrainingDay and renderMessageCard (rest day etc.) in today.ts when
 * the program has safety notes.
 */
export function renderSafetyNotesLink(notes: string[]): HTMLButtonElement {
  const button = element("button", "safety-notes-link", "Safety notes");
  button.type = "button";
  button.addEventListener("click", () => {
    const title = element("h2", "sheet-title", "Safety notes");
    title.id = "sheet-title";
    openSheet([title, renderNoteList(notes)], button);
  });
  return button;
}
