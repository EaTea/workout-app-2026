import type { SkippedBlocksByDate } from "../optionalBlocks/model";
import { optionalBlockKey, type OptionalBlockKey } from "../optionalBlocks/model";
import type { WorkoutLog } from "../log/model";
import { setsForItem } from "../log/operations";
import { blockSlotsOf, type CombinedSession, type TrainingSessionView } from "../program/combine";
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
 *   │ Boxing today?                    │  one line per optional block
 *   │ [ Box ]  [ Skip boxing ]         │  (prefixed "D1"/"D5" on a combined day)
 *   └──────────────────────────────────┘
 *   ...blocks...
 *   6 · Finisher   Boxing skipped today · [ Add it back ]   (replaces the block's card)
 */

/** What Today needs for optional blocks; supplied by app.ts, which owns the stored skips. */
export interface OptionalBlocksOptions {
  /** All stored skips (Today reads the shown date's). */
  skippedByDate: SkippedBlocksByDate;

  /** "Skip" / "Box" / "Add it back" tapped: stores the choice for the shown date. Returns null on success or a message to show under the buttons. */
  onSetSkipped: (blockKey: OptionalBlockKey, skipped: boolean) => string | null;
}

/** One optional block of the shown session, as the question card needs it. */
export interface OptionalBlockEntry {
  blockKey: OptionalBlockKey;

  /** The block's `optional.label`, e.g. "Boxing". */
  label: string;

  /** The program day the block belongs to (for the "D1" prefix on a combined day). */
  day: number;

  skipped: boolean;
}

/** "Boxing today?" */
export function questionText(label: string): string {
  return `${label} today?`;
}

/** "Skip boxing": the label lower-cased because it sits mid-sentence. */
export function skipButtonText(label: string): string {
  return `Skip ${label.toLowerCase()}`;
}

/**
 * The button that keeps the block: "Box" for "Boxing". It drops a trailing
 * "ing" from the label (best effort for a one-word activity; any other label
 * is used as it is), because the label itself is a noun-like name and the
 * button reads as a verb.
 */
export function keepButtonText(label: string): string {
  const stem = /^(.{2,})ing$/i.exec(label)?.[1];
  return stem ?? label;
}

/** "Boxing skipped today": the line that replaces a skipped block's card. */
export function skippedLineText(label: string): string {
  return `${label} skipped today`;
}

/**
 * The optional blocks of `session` that can still be decided: those with
 * `optional` set and no set logged yet for any of their items on `date`
 * (once a round is logged the choice is final, rule 2). In display order.
 */
export function undecidedOptionalBlocks(session: TrainingSessionView | CombinedSession, log: WorkoutLog, date: string): OptionalBlockEntry[] {
  const entries: OptionalBlockEntry[] = [];

  for (const { source, block } of blockSlotsOf(session)) {
    if (block.optional === undefined || isBlockStarted(log, date, source.day, source.blockPosition, block.items.map((item) => item.exercise.id))) continue;

    entries.push({ blockKey: optionalBlockKey(source.day, source.blockPosition), label: block.optional.label, day: source.day, skipped: block.skipped === true });
  }

  return entries;
}

/** True when any of the given exercises has a logged set in this day's block on `date`. */
export function isBlockStarted(log: WorkoutLog, date: string, day: number, blockPosition: number, exerciseIds: string[]): boolean {
  return exerciseIds.some((exerciseId) => setsForItem(log, date, blockPosition, exerciseId, day).length > 0);
}

/**
 * The question card: one row per entry with Box / Skip buttons, the current
 * choice marked with `aria-pressed`. `showDayLabel` prefixes "D1" style tags
 * (combined days). A failed save shows its message under the buttons.
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

    const buttons = element("div", "optional-block-buttons");
    const choices: Array<{ text: string; skipped: boolean }> = [
      { text: keepButtonText(entry.label), skipped: false },
      { text: skipButtonText(entry.label), skipped: true },
    ];
    for (const choice of choices) {
      const button = element("button", "combine-button optional-block-button", choice.text);
      button.type = "button";
      button.setAttribute("aria-pressed", String(entry.skipped === choice.skipped));
      button.addEventListener("click", () => {
        const failure = onSetSkipped(entry.blockKey, choice.skipped);
        if (failure !== null) errorLine.textContent = failure;
      });
      buttons.append(button);
    }

    row.append(questionLine, buttons, errorLine);
    container.append(row);
  }

  return container;
}

/**
 * The card that replaces a skipped block: its numbered title (the block keeps
 * its number) and "Boxing skipped today · Add it back". `onAddBack` is
 * undefined once a round of the block is logged, which leaves just the text.
 */
export function renderSkippedBlockCard(title: string, label: string, onAddBack: (() => string | null) | undefined): HTMLElement {
  const card = element("section", "card block-card skipped-block-card");
  card.append(element("h2", "block-title", title));

  const line = element("p", "skipped-block-line", skippedLineText(label));
  card.append(line);

  if (onAddBack !== undefined) {
    const errorLine = element("p", "field-error");
    errorLine.setAttribute("role", "alert");

    const button = element("button", "combine-button optional-block-button", "Add it back");
    button.type = "button";
    button.addEventListener("click", () => {
      const failure = onAddBack();
      if (failure !== null) errorLine.textContent = failure;
    });
    card.append(button, errorLine);
  }

  return card;
}
