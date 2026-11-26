import type { TrainingBreak } from "../break/model";
import { breakOn, MAX_BREAK_DAYS } from "../break/operations";
import { endBreakAndSave, loadBreaks, startBreakAndSave, type BreakStorage } from "../break/storage";
import type { BreakStartDecision } from "../break/startDate";
import { element } from "./dom";
import {
  BREAK_NOTE_PLACEHOLDER,
  BREAK_PREVIEW_MESSAGE,
  BREAK_SECTION_TITLE,
  DEFAULT_BREAK_DAYS,
  END_BREAK_LABEL,
  START_BREAK_LABEL,
  breakStartNote,
  TAKE_A_BREAK_LABEL,
  parseBreakDays,
  pastBreakLine,
  runningBreakTitleLine,
} from "./breakText";
import "./break.css";

/**
 * The screens' parts of "Break from training" (words are in `breakText.ts`,
 * storage in `break/storage.ts`), modelled on `injuryFlagUi.ts`:
 *
 *   Today    ──▶ renderTakeBreakLink ────────▶ #/settings (the Break section)
 *            ──▶ renderEndBreakControl ─ [End the break today] ─▶ onEnd (app.ts)
 *   Settings ─▶ renderBreakSettingsSection
 *                 no break today: [Take a break] ─▶ form: days, note ─ Start break ─▶ startBreakAndSave
 *                 on a break:     "On a break · Back on 3 Dec", note, [End the break today] ─▶ endBreakAndSave
 *                 other breaks as plain lines underneath
 *                 after each save ─▶ onChanged ─▶ app.ts reloads the breaks and redraws
 *
 * A break starts on the REAL date (`today`, never a `?date=` preview) and ends
 * on it, like the injury flag and the other saves. The one exception: when
 * today is already done (sets logged, or a combine's donor date) it starts
 * tomorrow, and the form says so (`breakStartDate`).
 */

/** What the Settings section needs from the app shell. */
export interface BreakSettingsOptions {
  /** Where the breaks live; `localStorage` in the app. */
  storage: BreakStorage;

  /** The program's `breaks` storage key. */
  storageKey: string;

  /** The real local date: the first day of a new break and the first day back of an ended one. */
  today: string;

  /**
   * Where a new break starts and why (`breakStartDate`, worked out by app.ts
   * from the log and the combines). Asked each time the form opens, so it
   * reflects sets logged since Settings was drawn.
   */
  startDecision: () => BreakStartDecision;

  /** Called after a break was started or ended and saved, so app.ts can refresh the schedule and redraw. */
  onChanged: () => void;
}

/** What Today's break card needs from the app shell. */
export interface BreakTodayOptions {
  /** True only when the shown date is the real today (a `?date=` preview saves nothing). */
  canEnd: boolean;

  /** Ends the break today and redraws Today; returns null on success or a message to show under the button. */
  onEnd: () => string | null;
}

/**
 * Today's "Take a break" link, shown next to "I'm injured" and "Safety
 * notes". Like "I'm injured" it goes to Settings, where the Break section
 * sits under the Injury one.
 */
export function renderTakeBreakLink(): HTMLAnchorElement {
  const link = element("a", "safety-notes-link", TAKE_A_BREAK_LABEL);
  link.href = "#/settings";
  return link;
}

/**
 * The "End the break today" button for the break card on Today, with room for
 * an inline error. On a `?date=` preview (`canEnd` false) there is no button,
 * only a hint, because ending a break saves and a preview never saves.
 */
export function renderEndBreakControl(options: BreakTodayOptions): HTMLElement {
  if (!options.canEnd) return element("p", "field-hint", BREAK_PREVIEW_MESSAGE);

  const wrapper = element("div", "break-end");
  const error = element("p", "field-error");
  error.setAttribute("role", "alert");

  const button = element("button", "primary-button", END_BREAK_LABEL);
  button.type = "button";
  button.addEventListener("click", () => {
    error.textContent = options.onEnd() ?? "";
  });

  wrapper.append(button, error);
  return wrapper;
}

/**
 * The Break card on Settings. It redraws itself in place from storage after
 * each change and then calls `options.onChanged`, so the app's schedule is
 * refreshed at once (the app then redraws the whole screen).
 */
export function renderBreakSettingsSection(options: BreakSettingsOptions): HTMLElement {
  const section = element("section", "card break-section");
  section.id = "break-section";

  /** Redraws the card from storage. */
  function draw(): void {
    const breaks = loadBreaks(options.storage, options.storageKey);
    const runningBreak = breakOn(breaks, options.today);
    const otherBreaks = breaks.filter((trainingBreak) => trainingBreak !== runningBreak);
    const pastBreaks = otherBreaks.filter((trainingBreak) => trainingBreak.to <= options.today).reverse(); // newest first
    const comingBreaks = otherBreaks.filter((trainingBreak) => trainingBreak.from > options.today);

    section.replaceChildren(element("h2", "card-title", BREAK_SECTION_TITLE));
    section.append(runningBreak === undefined ? buildTakeBreakStart() : buildRunningView(runningBreak));

    appendBreakList(section, "Coming up", comingBreaks);
    appendBreakList(section, "Past breaks", pastBreaks);
  }

  /** The "Take a break" button that reveals the form in place. */
  function buildTakeBreakStart(): HTMLElement {
    const wrapper = element("div", "break-start");
    const openButton = element("button", "injury-secondary-button", TAKE_A_BREAK_LABEL);
    openButton.type = "button";
    openButton.addEventListener("click", () => {
      const form = buildStartForm();
      wrapper.replaceChildren(form);
      form.querySelector<HTMLInputElement>("#break-days")?.focus();
    });

    wrapper.append(openButton);
    return wrapper;
  }

  /** The form: number of days, an optional note and "Start break". Starts today, or tomorrow with a line saying why (`startDecision`). */
  function buildStartForm(): HTMLElement {
    const form = element("form", "break-form");
    form.noValidate = true;

    // Decided once per form, so the sentence shown is the start date that gets saved.
    const startDecision = options.startDecision();
    const startNote = breakStartNote(startDecision);

    const daysInput = element("input");
    daysInput.type = "text";
    daysInput.inputMode = "numeric";
    daysInput.id = "break-days";
    daysInput.autocomplete = "off";
    daysInput.value = String(DEFAULT_BREAK_DAYS);

    const noteInput = element("input");
    noteInput.type = "text";
    noteInput.id = "break-note";
    noteInput.autocomplete = "off";
    noteInput.placeholder = BREAK_NOTE_PLACEHOLDER;

    const error = element("p", "field-error");
    error.setAttribute("role", "alert");
    const startButton = element("button", "primary-button", START_BREAK_LABEL);
    startButton.type = "submit";

    form.append(
      ...(startNote === undefined ? [] : [element("p", "field-hint break-start-note", startNote)]),
      buildLabelledField(`Number of days (1 to ${MAX_BREAK_DAYS})`, daysInput),
      buildLabelledField("Note for the break (optional)", noteInput),
      error,
      startButton,
    );

    form.addEventListener("submit", (event) => {
      event.preventDefault();

      const result = startBreakAndSave(options.storage, options.storageKey, {
        from: startDecision.from,
        days: parseBreakDays(daysInput.value),
        note: noteInput.value,
      });
      if (!result.ok) {
        error.textContent = result.error;
        return;
      }

      draw();
      options.onChanged();
    });

    return form;
  }

  /** A break covering today: its title, note and "End the break today". */
  function buildRunningView(runningBreak: TrainingBreak): HTMLElement {
    const view = element("div", "break-running");
    view.append(element("p", "break-running-title", runningBreakTitleLine(runningBreak)));
    if (runningBreak.note !== undefined) view.append(element("p", "break-running-note", runningBreak.note));

    const error = element("p", "field-error");
    error.setAttribute("role", "alert");
    const endButton = element("button", "primary-button", END_BREAK_LABEL);
    endButton.type = "button";
    endButton.addEventListener("click", () => {
      const result = endBreakAndSave(options.storage, options.storageKey, options.today);
      if (!result.ok) {
        error.textContent = result.error;
        return;
      }

      draw();
      options.onChanged();
    });

    view.append(error, endButton);
    return view;
  }

  draw();
  return section;
}

/** Appends a titled list of plain break lines; nothing when `breaks` is empty. */
function appendBreakList(section: HTMLElement, title: string, breaks: readonly TrainingBreak[]): void {
  if (breaks.length === 0) return;

  const list = element("ul", "break-list");
  for (const trainingBreak of breaks) {
    list.append(element("li", undefined, pastBreakLine(trainingBreak)));
  }
  section.append(element("h3", "break-list-title", title), list);
}

/** A label above a text input, in the Settings form's look. */
function buildLabelledField(labelText: string, input: HTMLInputElement): HTMLElement {
  const field = element("div", "field");
  const label = element("label", "field-label", labelText);
  label.htmlFor = input.id;
  field.append(label, input);
  return field;
}
