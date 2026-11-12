import type { Combine } from "../combine/model";
import type { CombineOffer, DonorInfo } from "../program/combineOffers";
import { element } from "./dom";
import { formatShortDate, formatSessionKicker } from "./format";
import { renderProgramOverviewLink } from "./overview";
import { renderSafetyNotesLink } from "./safetyNotes";
import "./combine.css";

/**
 * The small pieces of Today that belong to "combine two days" (PR 25), kept
 * out of today.ts so that file stays about rows and blocks:
 *
 *   normal training day ─▶ renderCombineOffers   [ Short on time? Add Day 2 to today ]  (just under the header)
 *   combined (host) date ─▶ renderUndoCombine     [ Undo combine ]   (under the header; only while nothing is logged)
 *   Both appear on the real today only, never on a `?date=` preview.
 *   donor date          ─▶ renderDonorCard        "Day 2 done with Day 1 on 9 Nov"
 *   day plans by week   ─▶ renderCombinedNote     "Combined with Day 2 on 10 Nov"
 *
 * Everything here is display only: the taps call back into app.ts, which
 * stores or removes the combine (`combine/storage.ts`) and re-renders.
 */

/** What Today needs to offer, show and undo combines; supplied by app.ts, which owns the stored combines. */
export interface CombineActions {
  /** "Add Day N" tapped: store this combine for the shown date. Returns null on success or a message to show under the button. */
  onAdd: (combine: Combine) => string | null;

  /** "Undo combine" tapped on the shown (host) date. Returns null on success or a message to show under the button. */
  onUndo: () => string | null;
}

/** The label on an offer's button: "Short on time? Add Day 2 to today" or "Add missed Day 1 to today". */
export function offerButtonLabel(offer: CombineOffer): string {
  return offer.kind === "addNext" ? `Short on time? Add Day ${offer.day} to today` : `Add missed Day ${offer.day} to today`;
}

/** The text of the note on a day plan: "Combined with Day 2 on 10 Nov". */
export function combinedNoteText(otherDay: number, otherDate: string): string {
  return `Combined with Day ${otherDay} on ${formatShortDate(otherDate)}`;
}

/**
 * One large button per offer (rule 2), in the order `combineOffersFor` gave.
 * A failed save shows its message under the button; success re-renders Today
 * (app.ts), which replaces this whole block with the combined session.
 */
export function renderCombineOffers(offers: CombineOffer[], actions: CombineActions): HTMLElement {
  const container = element("div", "combine-offers");

  for (const offer of offers) {
    const button = element("button", "combine-button", offerButtonLabel(offer));
    button.type = "button";

    const errorLine = element("p", "field-error");
    errorLine.setAttribute("role", "alert");

    button.addEventListener("click", () => {
      const failure = actions.onAdd(offer.combine);
      if (failure !== null) errorLine.textContent = failure;
    });
    container.append(button, errorLine);
  }

  return container;
}

/** The "Undo combine" button under the header of a combined session; the caller shows it only while nothing is logged on the date. */
export function renderUndoCombine(actions: CombineActions): HTMLElement {
  const container = element("div", "combine-offers");

  const button = element("button", "combine-button", "Undo combine");
  button.type = "button";

  const errorLine = element("p", "field-error");
  errorLine.setAttribute("role", "alert");

  button.addEventListener("click", () => {
    const failure = actions.onUndo();
    if (failure !== null) errorLine.textContent = failure;
  });

  container.append(button, errorLine);
  return container;
}

/**
 * The card shown on a donor date (rule 6) instead of a session, like the
 * rest-day card: "Day 2 done with Day 1 on 9 Nov", with the same overview and
 * safety links as other message cards.
 */
export function renderDonorCard(donor: DonorInfo, date: string, week: number, lengthWeeks: number, safetyNotes: string[]): HTMLElement {
  const card = element("div", "card message-card donor-card");
  card.append(
    element("div", "kicker", formatSessionKicker(date, week, lengthWeeks, donor.day)),
    element("h2", "card-title", `Day ${donor.day} done with Day ${donor.hostDay} on ${formatShortDate(donor.hostDate)}`),
    element("p", undefined, "Nothing more to train today. Rest up."),
    renderProgramOverviewLink(),
  );
  if (safetyNotes.length > 0) card.append(renderSafetyNotesLink(safetyNotes));
  return card;
}

/** The short note on the day plans by week for both days of a combine. */
export function renderCombinedNote(otherDay: number, otherDate: string): HTMLElement {
  return element("p", "combine-note", combinedNoteText(otherDay, otherDate));
}
