import "./programPicker.css";
import type { ProgramPickerCard } from "../program/picker";
import { saveActiveProgramId } from "../storage/activeProgram";
import { element } from "./dom";
import { formatOverviewHeadline } from "./format";

/**
 * The program picker, "Choose your program" (`#/programs`).
 *
 *   buildProgramPicker(...) ─▶ ProgramPickerCard[] ─▶ renderProgramPickerScreen
 *
 *   ┌──────────────────────────────────┐
 *   │ Choose your program              │
 *   │ ┌──────────────────────────────┐ │
 *   │ │ Explosive Endurance  Current │ │  one big button per program
 *   │ │ goal                         │ │  (disabled, with the reason, when
 *   │ │ 8 weeks · 6 training days …  │ │   its file is broken)
 *   │ └──────────────────────────────┘ │
 *   └──────────────────────────────────┘
 *        │ tap a card
 *        ▼
 *   chooseProgramAndReload: save the id, go to #/overview, reload the page
 *   (the app shell holds ONE program's storage keys and data from startup,
 *    so the only clean way to switch is a restart; each program keeps its
 *    own data, so nothing is lost)
 *
 * Two homes: inside the app shell (reached from "Switch program", with the
 * bottom nav) and, when no program is chosen yet, as the whole app via
 * `showProgramPicker`.
 */

/** Shown when the choice could not be saved, so the reload would just reopen the same screen. */
const CHOICE_NOT_SAVED_MESSAGE = "Couldn't save your choice on this device";

/**
 * Saves `programId` as the active program, then opens its Overview with a page
 * reload so the app restarts with that program's keys. Returns null on success
 * (the page is going away) or a message to show inline when saving failed, in
 * which case nothing is reloaded. Passed to the picker as its `onChoose`.
 */
export function chooseProgramAndReload(programId: string): string | null {
  const saved = saveActiveProgramId(localStorage, programId);
  if (!saved.ok) return `${CHOICE_NOT_SAVED_MESSAGE} (${saved.error}).`;

  // Setting the hash first means the reloaded page opens on the Overview.
  window.location.hash = "#/overview";
  window.location.reload();
  return null;
}

/**
 * Builds the picker screen. `onChoose` is called with the tapped program's id
 * and returns null or an inline error message (see `chooseProgramAndReload`);
 * a broken program's card is disabled and never calls it.
 */
export function renderProgramPickerScreen(cards: ProgramPickerCard[], onChoose: (programId: string) => string | null): HTMLElement {
  const screen = element("section", "screen program-picker");
  screen.append(element("h1", "screen-title", "Choose your program"));

  const chooseError = element("p", "field-error");
  chooseError.setAttribute("role", "alert");

  for (const card of cards) {
    screen.append(renderProgramCard(card, (programId) => void (chooseError.textContent = onChoose(programId) ?? "")));
  }

  screen.append(chooseError);
  return screen;
}

/** One card as a large button (spans, since a button may only hold phrasing content): name (with a "Current" badge), goal and headline numbers, or the load error. */
function renderProgramCard(card: ProgramPickerCard, onTap: (programId: string) => void): HTMLButtonElement {
  const button = element("button", card.isCurrent ? "card program-card program-card-current" : "card program-card");
  button.type = "button";

  const name = element("span", "program-card-name", card.kind === "available" ? card.name : card.programId);
  if (card.isCurrent) {
    name.append(element("span", "program-card-current-badge", "Current"));
  }
  button.append(name);

  if (card.kind === "broken") {
    button.disabled = true;
    button.append(element("span", "program-card-error", `This program can't be loaded: ${card.error}`));
    return button;
  }

  button.append(
    element("span", "program-card-goal", card.goal),
    element("span", "program-card-headline", formatOverviewHeadline(card.lengthWeeks, card.trainingDaysPerWeek, card.weeklyMinutes)),
  );
  button.addEventListener("click", () => onTap(card.programId));
  return button;
}

/**
 * Shows the picker as the whole app inside `root` (no bottom nav): used by
 * main.ts when no program has been chosen yet. Choosing saves and reloads.
 */
export function showProgramPicker(root: HTMLElement, cards: ProgramPickerCard[]): void {
  const main = element("main", "app-main");
  main.append(renderProgramPickerScreen(cards, chooseProgramAndReload));
  root.replaceChildren(main);
}

/**
 * A "Switch program" link to the picker at `#/programs`. Shown at the top of
 * the Overview and in Settings (hash-only, so a `?date=` preview survives).
 */
export function renderSwitchProgramLink(): HTMLAnchorElement {
  const link = element("a", "switch-program-link", "Switch program");
  link.href = "#/programs";
  return link;
}
