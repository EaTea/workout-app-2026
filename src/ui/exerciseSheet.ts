import type { ItemView } from "../program/schedule";
import { closeOnBack } from "./backToClose";
import { element } from "./dom";
import { formatPrescriptionSummary } from "./format";

/**
 * Bottom sheet with the details for one exercise (cues, alternative,
 * the "No equipment" swap when the item has one, progression, evidence). Opened by the ⓘ button on the log screen.
 *
 *   ⓘ button (log screen) ──click──▶ openExerciseSheet(item, opener)
 *                           ├─ backdrop (tap closes)    ┐ appended to <body>, outside #app,
 *                           └─ dialog (focus moves in)  ┘ so Today re-renders don't remove it
 *   Escape / close button / backdrop / hashchange / Back ──▶ closeSheet ──▶ focus back on `opener`
 *
 * Back closes the sheet (not the log screen) via `closeOnBack`, as the timer
 * overlay does: a marker history entry is pushed on open and released on every close path.
 */

/** Shown for exercises whose evidence is "coaching practice" rather than a link. */
const COACHING_PRACTICE_TEXT = "Based on coaching practice";

/** Selector for things that can take keyboard focus inside the sheet. */
const FOCUSABLE = "a[href], button";

/** Opens the sheet for `item`; `opener` regains focus when it closes. */
export function openExerciseSheet(item: ItemView, opener: HTMLElement): void {
  const { exercise } = item;
  const content: HTMLElement[] = [];

  const category = exercise.maxTested ? `${capitalise(exercise.category)} · Max tested` : capitalise(exercise.category);
  const title = element("h2", "sheet-title", exercise.name);
  title.id = "sheet-title";

  content.push(
    element("div", "kicker", category),
    title,
    ...(item.swappedFrom !== undefined ? [element("p", "sheet-text", `Instead of ${item.swappedFrom.name}`)] : []),
    element("p", "sheet-summary", formatPrescriptionSummary(item)),
  );

  if (item.weeklyIncrease) {
    // The program's progression rule, shown as written (never parsed).
    content.push(sectionHeading("Weekly progression"), element("p", "sheet-text", `${item.weeklyIncrease} each week (not in deload)`));
  }
  if (exercise.cues.length > 0) {
    content.push(sectionHeading("Cues"), bulletList(exercise.cues));
  }
  if (exercise.alternative) {
    content.push(sectionHeading("Alternative"), element("p", "sheet-text", exercise.alternative));
  }
  if (item.noEquipment) {
    content.push(...renderNoEquipmentSection(item.noEquipment));
  }
  if (exercise.progression.length > 0) {
    content.push(sectionHeading("Progression"), bulletList(exercise.progression));
  }
  content.push(sectionHeading("Evidence"), renderEvidence(item));

  openSheet(content, opener);
}

/**
 * Opens a bottom sheet showing `content` under the grab bar and Close button.
 * Shared by the exercise details sheet above and the "Safety notes" sheet on
 * Today (see safetyNotes.ts), so both get the same behaviour: the page behind
 * is inert, Escape / Close / backdrop / Back all close it, and focus returns
 * to `opener`. The content should include an element with id "sheet-title",
 * which labels the dialog.
 */
export function openSheet(content: HTMLElement[], opener: HTMLElement): void {
  const backdrop = element("div", "sheet-backdrop");
  const sheet = element("div", "sheet");
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-labelledby", "sheet-title");
  sheet.tabIndex = -1;

  const closeButton = element("button", "sheet-close", "Close");
  closeButton.type = "button";
  sheet.append(element("div", "sheet-grab"), closeButton, ...content);

  // Everything behind the sheet: made inert so Tab, screen readers and taps
  // cannot reach it, and the body is frozen so the page does not scroll.
  const backgroundRegions = Array.from(document.querySelectorAll<HTMLElement>("#app > main, #app > nav"));
  const previousBodyOverflow = document.body.style.overflow;
  for (const region of backgroundRegions) {
    region.inert = true;
  }
  document.body.style.overflow = "hidden";

  /** Lets the Back button close the sheet; released in closeSheet() on every close path. */
  const backToClose = closeOnBack(window.history, window, () => closeSheet());

  /** Removes the sheet and listeners, restores the page behind it, releases the Back marker, then returns focus to the row. */
  function closeSheet(): void {
    backToClose.release();
    for (const region of backgroundRegions) {
      region.inert = false;
    }
    document.body.style.overflow = previousBodyOverflow;
    document.removeEventListener("keydown", handleKeydown);
    window.removeEventListener("hashchange", closeSheet);
    backdrop.remove();
    sheet.remove();
    if (opener.isConnected) {
      opener.focus();
    }
  }

  /** Escape closes; Tab is kept inside the sheet while it is open. */
  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      closeSheet();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = Array.from(sheet.querySelectorAll<HTMLElement>(FOCUSABLE));
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  closeButton.addEventListener("click", closeSheet);
  backdrop.addEventListener("click", closeSheet);
  document.addEventListener("keydown", handleKeydown);
  window.addEventListener("hashchange", closeSheet);

  document.body.append(backdrop, sheet);
  // Start on Close so Shift+Tab/Tab always begin inside the first/last handling.
  closeButton.focus();
}

/**
 * The "No equipment" section: the household-kit swap's name and this week's
 * dose (the swap's own view, built by the schedule, so deloads and weekly
 * increases already apply), then the swap's cues. The cues include its safety
 * points, so they are always shown. Called by `openExerciseSheet` only when
 * the item has a swap; nothing here changes what Today or the log screen do.
 */
function renderNoEquipmentSection(swap: ItemView): HTMLElement[] {
  const section = [
    sectionHeading("No equipment"),
    element("p", "sheet-text", `${swap.exercise.name}: ${formatPrescriptionSummary(swap)}`),
  ];
  if (swap.exercise.cues.length > 0) {
    section.push(bulletList(swap.exercise.cues));
  }
  return section;
}

/** The evidence link (new tab, no opener) or the coaching-practice text. */
function renderEvidence(item: ItemView): HTMLElement {
  const evidence = item.exercise.evidence;
  if (evidence.kind !== "url") {
    return element("p", "sheet-text", COACHING_PRACTICE_TEXT);
  }

  const link = element("a", "sheet-link", "Read the evidence ↗");
  link.href = evidence.url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  return link;
}

/** Small uppercase heading for a sheet section. */
function sectionHeading(text: string): HTMLElement {
  return element("h3", "sheet-heading", text);
}

/** Bulleted list of plain-text lines. */
function bulletList(lines: string[]): HTMLElement {
  const list = element("ul", "sheet-list");
  for (const line of lines) {
    list.append(element("li", undefined, line));
  }
  return list;
}

/** "strength" -> "Strength". */
function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
