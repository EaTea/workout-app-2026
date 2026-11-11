import type { Program } from "../program/model";
import { toDayNumber } from "../program/calendar";
import type { TrainingSettings } from "../settings/model";
import { element } from "./dom";
import { renderExportSection, type ExportSource } from "./exportSection";

/**
 * The Settings screen: start date plus one tested-max input per exercise the
 * program flags with `maxTested` (so adding a tested exercise to program.json
 * adds an input here automatically). Rendered by `app.ts` for `#/settings`.
 *
 * The form's fields are read back by `readSettingsForm`; validation lives in
 * `validateSettingsForm` so it can be unit tested without a DOM.
 */

/** Raw text values as typed into the form. */
export interface SettingsFormValues {
  startDate: string;
  /** Raw text per exercise id; empty string means "not tested". */
  maxReps: Record<string, string>;
}

/** The fields the form edits; the saved-on dates are added by `stampMaxSavedDates`. */
export type SettingsFormResult = Pick<TrainingSettings, "startDate" | "maxReps">;

/** Result of validating the form: either clean settings or messages per field. */
export type SettingsValidation =
  | { ok: true; settings: SettingsFormResult }
  | { ok: false; errors: { startDate?: string; maxReps: Record<string, string> } };

/**
 * Works out the new `maxSavedOn` when the form is saved: a max field the user
 * EDITED during this visit (`editedExerciseIds`) is stamped with `today` even
 * if the number is unchanged, so "retested, same number" counts as a retest;
 * an untouched max keeps its previous date (which may be missing for data
 * saved before dates were recorded); a cleared max loses its date. Saving only
 * the start date edits no max field, so it stamps nothing. Called by the Save
 * handler after validation, with `today` the real local date (never the
 * `?date=` preview). "Start today" does not go through here.
 */
export function stampMaxSavedDates(
  previous: Pick<TrainingSettings, "maxSavedOn">,
  newMaxReps: Record<string, number>,
  editedExerciseIds: ReadonlySet<string>,
  today: string,
): Record<string, string> {
  const maxSavedOn: Record<string, string> = {};

  for (const exerciseId of Object.keys(newMaxReps)) {
    if (editedExerciseIds.has(exerciseId)) {
      maxSavedOn[exerciseId] = today;
      continue;
    }

    const previousDate = previous.maxSavedOn[exerciseId];
    if (previousDate !== undefined) {
      maxSavedOn[exerciseId] = previousDate;
    }
  }

  return maxSavedOn;
}

/**
 * Checks raw form text and converts it to the form's settings fields. Called by the
 * Save handler; the error messages are shown inline under each field.
 */
export function validateSettingsForm(values: SettingsFormValues): SettingsValidation {
  const errors: { startDate?: string; maxReps: Record<string, string> } = { maxReps: {} };
  const maxReps: Record<string, number> = {};

  let startDate: string | null = null;
  if (values.startDate === "") {
    errors.startDate = "Choose the date you start (or started) the program.";
  } else {
    try {
      toDayNumber(values.startDate);
      startDate = values.startDate;
    } catch {
      errors.startDate = "That is not a valid date.";
    }
  }

  for (const [exerciseId, text] of Object.entries(values.maxReps)) {
    const trimmed = text.trim();
    if (trimmed === "") {
      continue;
    }
    if (!/^\d+$/.test(trimmed) || Number(trimmed) < 1) {
      errors.maxReps[exerciseId] = "Enter a whole number of reps, 1 or more (or leave blank).";
      continue;
    }
    maxReps[exerciseId] = Number(trimmed);
  }

  if (errors.startDate !== undefined || Object.keys(errors.maxReps).length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, settings: { startDate, maxReps } };
}

/**
 * Builds the Settings screen. `today` is the real local date, stamped on maxes
 * the user edited. `onSave` is called with validated settings when the user
 * presses Save; `app.ts` persists them, shows "Saved" and navigates.
 * `onSave` returns null on success or a message to show inline (e.g. storage
 * is full or blocked), in which case the user stays on this screen.
 * `getExportSource`, when given, adds the Export card below the form; it is
 * called when an export button is pressed so the file holds the latest data.
 */
export function renderSettingsScreen(
  program: Program,
  current: TrainingSettings,
  today: string,
  onSave: (settings: TrainingSettings) => string | null,
  getExportSource?: () => ExportSource,
): HTMLElement {
  const screen = element("section", "screen");
  screen.append(element("h1", "screen-title", "Settings"));

  const form = element("form", "card settings-form");
  form.noValidate = true; // we show our own inline errors

  // Start date
  const startDateInput = element("input");
  startDateInput.type = "date";
  startDateInput.id = "start-date";
  startDateInput.name = "startDate";
  startDateInput.value = current.startDate ?? "";
  const startDateError = element("p", "field-error");
  form.append(
    buildField("Start date", startDateInput, startDateError, "Day 1 of the program. Week 1 runs for 7 days from here."),
  );

  // Tested maxes, driven by the program data
  const maxInputs: Record<string, HTMLInputElement> = {};
  const maxErrors: Record<string, HTMLElement> = {};
  /** Max fields typed in during this visit; any `input` event counts, even if the value ends up the same. */
  const editedExerciseIds = new Set<string>();
  for (const exercise of Object.values(program.exercises)) {
    if (!exercise.maxTested) {
      continue;
    }
    const input = element("input");
    // Deliberately type="text": a type="number" input reports "" for junk like
    // "1e", which would silently read as "not tested" and wipe the stored max.
    // Text lets `validateSettingsForm` see exactly what was typed.
    input.type = "text";
    input.id = `max-${exercise.id}`;
    input.name = `max-${exercise.id}`;
    input.inputMode = "numeric";
    input.pattern = "[0-9]*";
    input.autocomplete = "off";
    input.value = current.maxReps[exercise.id]?.toString() ?? "";
    const error = element("p", "field-error");
    input.addEventListener("input", () => editedExerciseIds.add(exercise.id));
    maxInputs[exercise.id] = input;
    maxErrors[exercise.id] = error;
    form.append(buildField(`Max reps: ${exercise.name}`, input, error));
  }

  const saveError = element("p", "field-error");
  saveError.setAttribute("role", "alert");

  const saveButton = element("button", "primary-button", "Save");
  saveButton.type = "submit";
  form.append(saveError, saveButton);

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    const maxTexts: Record<string, string> = {};
    for (const [exerciseId, input] of Object.entries(maxInputs)) {
      maxTexts[exerciseId] = input.value;
    }
    const result = validateSettingsForm({ startDate: startDateInput.value, maxReps: maxTexts });

    // Clear old messages, then show new ones.
    startDateError.textContent = "";
    saveError.textContent = "";
    for (const error of Object.values(maxErrors)) {
      error.textContent = "";
    }
    if (!result.ok) {
      startDateError.textContent = result.errors.startDate ?? "";
      for (const [exerciseId, message] of Object.entries(result.errors.maxReps)) {
        const errorElement = maxErrors[exerciseId];
        if (errorElement) {
          errorElement.textContent = message;
        }
      }
      return;
    }

    const maxSavedOn = stampMaxSavedDates(current, result.settings.maxReps, editedExerciseIds, today);
    saveError.textContent = onSave({ ...result.settings, maxSavedOn }) ?? "";
  });

  screen.append(form);
  if (getExportSource !== undefined) {
    screen.append(renderExportSection(program, getExportSource));
  }
  return screen;
}

/** Wraps a labelled input with optional hint text and an error slot. */
function buildField(labelText: string, input: HTMLInputElement, errorElement: HTMLElement, hint?: string): HTMLElement {
  const field = element("div", "field");
  const label = element("label", "field-label", labelText);
  label.htmlFor = input.id;
  field.append(label, input);
  if (hint) {
    field.append(element("p", "field-hint", hint));
  }
  errorElement.setAttribute("role", "alert");
  field.append(errorElement);
  return field;
}
