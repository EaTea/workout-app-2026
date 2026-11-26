import { INJURY_SIDES, type Injury, type InjurySide } from "../injury/model";
import { activeInjuriesOn } from "../injury/operations";
import { clearInjuryAndSave, flagInjuryAndSave, loadInjuries, type InjuryStorage } from "../injury/storage";
import { INJURY_AREAS, type InjuryArea, type Program } from "../program/model";
import { element } from "./dom";
import { openSheet } from "./exerciseSheet";
import {
  BANNER_ADVICE,
  SIDE_LABELS,
  areaLabel,
  checkedSheetText,
  clearButtonLabel,
  clearConfirmationText,
  injuryTitleLine,
  pastInjuryLine,
  programSupportsInjuries,
} from "./injuryFlagText";
import "./injuryFlag.css";

/**
 * The screens' parts of the injury flag (words are in `injuryFlagText.ts`,
 * storage in `injury/storage.ts`):
 *
 *   Today   ──▶ renderInjuredLink ───────────▶ #/settings (the Injury section)
 *           ──▶ renderInjuryBanners ─ [When to get it checked] ─▶ openCheckedSheet
 *   Settings ─▶ renderInjurySettingsSection
 *                 not flagged:  [form: area, side, note] ─ Flag it ─▶ flagInjuryAndSave ─▶ sheet, once
 *                 flagged:      "Right shoulder · since 22 Nov", note, [When to get it checked],
 *                               [My shoulder feels OK] ─ confirm ─▶ clearInjuryAndSave
 *                 past injuries as plain lines underneath
 *
 * The flag always starts and ends on the REAL date (`today`, never a
 * `?date=` preview), like the other saves.
 */

/** What the Settings section needs from the app shell. */
export interface InjurySettingsOptions {
  /** Where the injuries live; `localStorage` in the app. */
  storage: InjuryStorage;

  /** The program's `injuries` storage key. */
  storageKey: string;

  /** The real local date: the start of a new flag and the end of a cleared one. */
  today: string;
}

/**
 * Opens the "When to get it checked" sheet for `area`, reusing the bottom
 * sheet of the exercise details and Steady Strength's safety notes. Focus
 * returns to `opener` when it closes. Called from the Settings section (once,
 * right after flagging, and from its button) and from Today's banner.
 */
export function openCheckedSheet(area: InjuryArea, opener: HTMLElement): void {
  const text = checkedSheetText(area);

  const title = element("h2", "sheet-title", text.heading);
  title.id = "sheet-title";

  const redFlags = element("ul", "safety-notes-list");
  for (const redFlag of text.redFlags) {
    redFlags.append(element("li", undefined, redFlag));
  }

  openSheet(
    [
      title,
      element("p", "injury-sheet-text", text.intro),
      element("p", "injury-sheet-text", text.redFlagsLead),
      redFlags,
      element("p", "injury-sheet-text", text.whileFlagged),
      element("p", "injury-sheet-text", text.closing),
    ],
    opener,
  );
}

/** A "When to get it checked" button, link-styled, that opens the sheet for `area`. */
function renderCheckedButton(area: InjuryArea, className: string): HTMLButtonElement {
  const button = element("button", className, "When to get it checked");
  button.type = "button";
  button.addEventListener("click", () => openCheckedSheet(area, button));
  return button;
}

/**
 * Today's "I'm injured" link, shown next to "Safety notes" for a program that
 * knows how to train around injuries. It goes to Settings, where the Injury
 * section sits at the top.
 */
export function renderInjuredLink(program: Pick<Program, "exercises">): HTMLAnchorElement | undefined {
  if (!programSupportsInjuries(program)) return undefined;

  const link = element("a", "safety-notes-link", "I'm injured");
  link.href = "#/settings";
  return link;
}

/**
 * The banners at the top of Today, one per injury flagged on `date`:
 *
 *   ┌ Right shoulder · since 22 Nov ─────────────┐
 *   │ Pain-free only.                            │
 *   │ [When to get it checked]                   │
 *   └────────────────────────────────────────────┘
 *
 * Uses the amber `warning-banner` look. Empty when nothing is flagged on
 * `date`, so a `?date=` before the flag shows none.
 */
export function renderInjuryBanners(injuries: readonly Injury[], date: string): HTMLElement[] {
  return activeInjuriesOn(injuries, date).map((injury) => {
    const banner = element("div", "card warning-banner injury-banner");
    banner.setAttribute("role", "status");
    banner.append(
      element("p", "injury-banner-title", injuryTitleLine(injury)),
      element("p", "injury-banner-advice", BANNER_ADVICE),
      renderCheckedButton(injury.area, "injury-banner-button"),
    );
    return banner;
  });
}

/**
 * The Injury card on Settings, or undefined for a program with no tagged
 * exercises. It redraws itself in place after each change (flag, clear), so
 * the screen around it is untouched.
 */
export function renderInjurySettingsSection(program: Pick<Program, "exercises">, options: InjurySettingsOptions): HTMLElement | undefined {
  if (!programSupportsInjuries(program)) return undefined;

  const section = element("section", "card injury-section");
  section.id = "injury-section";

  /** Redraws the card from storage; `openSheetFor`, when given, opens the sheet once drawn (right after flagging). */
  function draw(openSheetFor?: InjuryArea): void {
    const injuries = loadInjuries(options.storage, options.storageKey);
    const openInjuries = injuries.filter((injury) => injury.to === undefined);
    const pastInjuries = injuries.filter((injury) => injury.to !== undefined);

    section.replaceChildren(element("h2", "card-title", "Injury"));

    if (openInjuries.length === 0) {
      section.append(buildFlagForm((area) => draw(area)));
    } else {
      for (const injury of openInjuries) {
        section.append(buildFlaggedView(injury, () => draw()));
      }
    }

    if (pastInjuries.length > 0) {
      const pastList = element("ul", "injury-past-list");
      for (const injury of pastInjuries) {
        pastList.append(element("li", undefined, pastInjuryLine(injury)));
      }
      section.append(element("h3", "injury-past-title", "Past injuries"), pastList);
    }

    if (openSheetFor !== undefined) {
      const opener = section.querySelector<HTMLElement>(".injury-checked-button");
      if (opener !== null) openCheckedSheet(openSheetFor, opener);
    }
  }

  /** The "Flag an injury" form; `onFlagged` redraws and opens the sheet. */
  function buildFlagForm(onFlagged: (area: InjuryArea) => void): HTMLElement {
    const form = element("form", "injury-form");
    form.noValidate = true;
    form.append(element("h3", "injury-subtitle", "Flag an injury"));

    const areaSelect = element("select");
    areaSelect.id = "injury-area";
    for (const area of INJURY_AREAS) {
      const choice = element("option", undefined, areaLabel(area));
      choice.value = area;
      areaSelect.append(choice);
    }

    const sideSelect = element("select");
    sideSelect.id = "injury-side";
    for (const side of INJURY_SIDES) {
      const choice = element("option", undefined, SIDE_LABELS[side]);
      choice.value = side;
      sideSelect.append(choice);
    }

    const noteInput = element("input");
    noteInput.type = "text";
    noteInput.id = "injury-note";
    noteInput.autocomplete = "off";

    const error = element("p", "field-error");
    error.setAttribute("role", "alert");
    const flagButton = element("button", "primary-button", "Flag it");
    flagButton.type = "submit";

    form.append(
      buildLabelledField("Area", areaSelect),
      buildLabelledField("Side", sideSelect),
      buildLabelledField("Note (optional)", noteInput),
      error,
      flagButton,
    );

    form.addEventListener("submit", (event) => {
      event.preventDefault();

      const area = areaSelect.value as InjuryArea;
      const note = noteInput.value.trim();
      const injury: Injury = { area, side: sideSelect.value as InjurySide, from: options.today };
      if (note !== "") injury.note = note;

      const result = flagInjuryAndSave(options.storage, options.storageKey, injury);
      if (!result.ok) {
        error.textContent = result.error;
        return;
      }
      onFlagged(area);
    });

    return form;
  }

  /** One flagged injury: its title, note, the sheet button and the clearing flow. */
  function buildFlaggedView(injury: Injury, onCleared: () => void): HTMLElement {
    const view = element("div", "injury-flagged");
    view.append(element("p", "injury-flagged-title", injuryTitleLine(injury)));
    if (injury.note !== undefined) view.append(element("p", "injury-flagged-note", injury.note));

    const actions = element("div", "injury-actions");
    const checkedButton = renderCheckedButton(injury.area, "injury-checked-button");
    const clearButton = element("button", "injury-secondary-button", clearButtonLabel(injury.area));
    clearButton.type = "button";
    actions.append(checkedButton, clearButton);
    view.append(actions);

    clearButton.addEventListener("click", () => {
      // Ask first, in words that make no medical claim; nothing is cleared until "Yes".
      const confirmation = element("div", "injury-confirm");
      const yesButton = element("button", "primary-button", "Yes, clear it");
      yesButton.type = "button";
      const noButton = element("button", "injury-secondary-button", "Keep it flagged");
      noButton.type = "button";
      const error = element("p", "field-error");
      error.setAttribute("role", "alert");

      noButton.addEventListener("click", () => {
        confirmation.remove();
        clearButton.hidden = false;
        clearButton.focus();
      });
      yesButton.addEventListener("click", () => {
        const result = clearInjuryAndSave(options.storage, options.storageKey, injury.area, options.today);
        if (!result.ok) {
          error.textContent = result.error;
          return;
        }
        onCleared();
      });

      confirmation.append(element("p", undefined, clearConfirmationText(injury.area)), error, yesButton, noButton);
      clearButton.hidden = true;
      view.append(confirmation);
      yesButton.focus();
    });

    return view;
  }

  draw();
  return section;
}

/** A label above a select or text input, in the Settings form's look. */
function buildLabelledField(labelText: string, input: HTMLSelectElement | HTMLInputElement): HTMLElement {
  const field = element("div", "field");
  const label = element("label", "field-label", labelText);
  label.htmlFor = input.id;
  field.append(label, input);
  return field;
}
