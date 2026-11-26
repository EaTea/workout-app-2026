import type { TrainingBreak } from "../break/model";
import { historyBreakLine } from "./breakText";

/*
 * Where History puts the breaks from training: each break is one line among
 * the day cards, newest first like the cards. Pure functions so the ordering
 * is unit tested; `history.ts` draws what they return.
 *
 *   shown dates (newest first)   breaks                      result
 *   2026-12-07                   26 Nov to 3 Dec     ──▶     card 2026-12-07
 *   2026-11-25                                               break 26 Nov
 *   2026-11-23                                               card 2026-11-25
 *                                                            card 2026-11-23
 */

/** One row of the History list: a day's card or a break's line. */
export type HistoryEntry = { kind: "session"; date: string } | { kind: "break"; trainingBreak: TrainingBreak };

/**
 * Merges the dates that have cards with the breaks, newest first. A break is
 * placed by its first day (`from`); on a tie with a card's date the break
 * comes first (it was taken after that day's session).
 *
 * While older weeks are still hidden (`hasOlderWeeks`), a break that began
 * before the oldest shown card is left out: it belongs with the older weeks,
 * where "Show older weeks" will bring it in. Otherwise every break is listed,
 * including ones older than every card.
 *
 * `shownDates` must already be newest first (as `groupDatesIntoWeeks` gives).
 */
export function interleaveBreaks(shownDates: readonly string[], breaks: readonly TrainingBreak[], hasOlderWeeks: boolean): HistoryEntry[] {
  const oldestShownDate = shownDates[shownDates.length - 1];
  const breaksToShow = breaks
    .filter((trainingBreak) => !hasOlderWeeks || oldestShownDate === undefined || trainingBreak.from > oldestShownDate)
    .sort((first, second) => (first.from < second.from ? 1 : first.from > second.from ? -1 : 0)); // newest first

  const entries: HistoryEntry[] = [];
  let nextBreakIndex = 0;

  for (const date of shownDates) {
    // Every break that began on or after this card's date goes above it.
    while (nextBreakIndex < breaksToShow.length && breaksToShow[nextBreakIndex]!.from >= date) {
      entries.push({ kind: "break", trainingBreak: breaksToShow[nextBreakIndex]! });
      nextBreakIndex += 1;
    }
    entries.push({ kind: "session", date });
  }

  for (; nextBreakIndex < breaksToShow.length; nextBreakIndex += 1) {
    entries.push({ kind: "break", trainingBreak: breaksToShow[nextBreakIndex]! });
  }

  return entries;
}

/** The two lines of a break's History entry: "On a break · 26 Nov to 2 Dec" and, when there is one, its note. */
export function breakNoteLines(trainingBreak: TrainingBreak): [string, string | undefined] {
  return [historyBreakLine(trainingBreak), trainingBreak.note];
}
