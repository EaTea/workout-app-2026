import type { WorkoutLog } from "../log/model";
import { optionalBlockKey, type OptionalBlockKey, type SkippedBlocksByDate } from "../optionalBlocks/model";
import { isBlockStarted } from "../optionalBlocks/session";
import { blockSlotsOf, type CombinedSession, type TrainingSessionView } from "../program/combine";
import type { DayNumber } from "../program/model";
import { element } from "./dom";
import "./combine.css";

/**
 * The pieces of Today that belong to optional blocks (PR 28 design, rules 2
 * and 3): the "Boxing today?" question under the header and the one-line card
 * that replaces a skipped block. Display only: taps call back into app.ts,
 * which stores the choice (`optionalBlocks/storage.ts`) and re-renders.
 *
 *   header
 *   ┌──────────────────────────────────┐
 *   │ Boxing today?                    │  one row per optional block that is not skipped
 *   │ [ Yes ]  [ Skip ]                │  (prefixed "D1"/"D5" on a combined day)
 *   └──────────────────────────────────┘
 *   ...blocks...
 *   6 · Finisher   Boxing skipped today · [ Add it back ]   (replaces a skipped block's card,
 *                                                            and is the only way back)
 */

/** Which control of a block's question should get keyboard focus after a tap re-renders Today. */
export type OptionalBlockControl = "keep" | "skip" | "addBack";

/** What Today needs for optional blocks; supplied by app.ts, which owns the stored skips. */
export interface OptionalBlocksOptions {
  /** All stored skips (Today reads the shown date's). */
  skippedByDate: SkippedBlocksByDate;

  /** False on a date after the real today (like other future writes): no question, no "Add it back". */
  canChoose: boolean;

  /**
   * "Yes" / "Skip" / "Add it back" tapped: stores the choice for the shown
   * date, re-renders, and focuses `focusAfter` of that block. Returns null on
   * success or a message to show under the buttons.
   */
  onSetSkipped: (blockKey: OptionalBlockKey, skipped: boolean, focusAfter: OptionalBlockControl) => string | null;
}

/** One undecided optional block of the shown session, as the question card needs it. */
export interface OptionalBlockEntry {
  blockKey: OptionalBlockKey;

  /** The block's `optional.label`, e.g. "Boxing". */
  label: string;

  /** The program day the block belongs to (for the "D1" prefix on a combined day). */
  day: DayNumber;
}

/** "Boxing today?" */
export function questionText(label: string): string {
  return `${label} today?`;
}

/** The accessible name of the Yes button: it carries the label as written, so a screen reader hears what is being answered. */
export function yesButtonName(label: string): string {
  return `Yes, ${label} today`;
}

/** The accessible name of the Skip button, with the label as written. */
export function skipButtonName(label: string): string {
  return `Skip ${label} today`;
}

/** "Boxing skipped today": the line that replaces a skipped block's card. */
export function skippedLineText(label: string): string {
  return `${label} skipped today`;
}

/**
 * The optional blocks of `session` whose question should show: those with
 * `optional` set that are not skipped and have no set logged yet for any of
 * their items on `date` (once a round is logged the choice is final, rule 2;
 * once skipped, the skipped line's "Add it back" is the way back). In display
 * order.
 */
export function undecidedOptionalBlocks(session: TrainingSessionView | CombinedSession, log: WorkoutLog, date: string): OptionalBlockEntry[] {
  const entries: OptionalBlockEntry[] = [];

  for (const { source, block } of blockSlotsOf(session)) {
    if (block.optional === undefined || block.skipped) continue;
    // An injury left every item out: the block shows its own "left out" line instead of the question.
    if (block.items.length > 0 && block.items.every((item) => item.leftOut !== undefined)) continue;
    if (isBlockStarted(log, date, source.day, source.blockPosition, block.items.map((item) => item.exercise.id))) continue;

    entries.push({ blockKey: optionalBlockKey(source.day, source.blockPosition), label: block.optional.label, day: source.day });
  }

  return entries;
}

/** Marks a button so app.ts can put focus back on it after the re-render. */
function tagControl(button: HTMLButtonElement, blockKey: OptionalBlockKey, control: OptionalBlockControl): void {
  button.dataset.optionalBlockKey = blockKey;
  button.dataset.optionalBlockControl = control;
}

/**
 * The question card: one row per entry with "Yes" (chosen by default, shown
 * with `aria-pressed`) and "Skip" buttons. `showDayLabel` prefixes "D1" style
 * tags (combined days). A failed save shows its message under the buttons.
 */
export function renderOptionalBlockQuestions(entries: OptionalBlockEntry[], showDayLabel: boolean, onSetSkipped: OptionalBlocksOptions["onSetSkipped"]): HTMLElement {
  const container = element("div", "optional-block-questions");

  for (const entry of entries) {
    const row = element("div", "optional-block-question");

    const questionLine = element("div", "item-name-line");
    if (showDayLabel) questionLine.append(element("span", "item-day-label", `D${entry.day}`));
    questionLine.append(element("span", "optional-block-question-text", questionText(entry.label)));

    const errorLine = element("p", "field-error");
    errorLine.setAttribute("role", "alert");

    const yesButton = element("button", "combine-button optional-block-button", "Yes");
    yesButton.type = "button";
    yesButton.setAttribute("aria-label", yesButtonName(entry.label));
    yesButton.setAttribute("aria-pressed", "true");
    tagControl(yesButton, entry.blockKey, "keep");
    yesButton.addEventListener("click", () => {
      const failure = onSetSkipped(entry.blockKey, false, "keep");
      if (failure !== null) errorLine.textContent = failure;
    });

    const skipButton = element("button", "combine-button optional-block-button", "Skip");
    skipButton.type = "button";
    skipButton.setAttribute("aria-label", skipButtonName(entry.label));
    skipButton.setAttribute("aria-pressed", "false");
    tagControl(skipButton, entry.blockKey, "skip");
    skipButton.addEventListener("click", () => {
      const failure = onSetSkipped(entry.blockKey, true, "addBack");
      if (failure !== null) errorLine.textContent = failure;
    });

    const buttons = element("div", "optional-block-buttons");
    buttons.append(yesButton, skipButton);

    row.append(questionLine, buttons, errorLine);
    container.append(row);
  }

  return container;
}

/**
 * The card that replaces a skipped block: its numbered title (the block keeps
 * its number) and "Boxing skipped today · Add it back". `onAddBack` is
 * undefined when the choice can't be changed (a date after today), which
 * leaves just the text.
 */
export function renderSkippedBlockCard(title: string, label: string, blockKey: OptionalBlockKey, onAddBack: (() => string | null) | undefined): HTMLElement {
  const card = element("section", "card block-card skipped-block-card");
  card.append(element("h2", "block-title", title));
  card.append(element("p", "skipped-block-line", skippedLineText(label)));

  if (onAddBack !== undefined) {
    const errorLine = element("p", "field-error");
    errorLine.setAttribute("role", "alert");

    const button = element("button", "combine-button optional-block-button", "Add it back");
    button.type = "button";
    tagControl(button, blockKey, "addBack");
    button.addEventListener("click", () => {
      const failure = onAddBack();
      if (failure !== null) errorLine.textContent = failure;
    });
    card.append(button, errorLine);
  }

  return card;
}
