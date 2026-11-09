import type { Program } from "../program/model";
import { toDayNumber } from "../program/calendar";
import type { TrainingSettings } from "../settings/model";
import { element } from "./dom";

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

/** Result of validating the form: either clean settings or messages per field. */
export type SettingsValidation =
  | { ok: true; settings: TrainingSettings }
  | { ok: false; errors: { startDate?: string; maxReps: Record<string, string> } };

/**
 * Checks raw form text and converts it to `TrainingSettings`. Called by the
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
 * Builds the Settings screen. `onSave` is called with validated settings when
 * the user presses Save; `app.ts` persists them, shows "Saved" and navigates.
 */
export function renderSettingsScreen(
  program: Program,
  current: TrainingSettings,
  onSave: (settings: TrainingSettings) => void,
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
    buildField("Start date", startDateInput, startDateError, "Week 1 begins on the Monday of the week containing this date."),
  );

  // Tested maxes, driven by the program data
  const maxInputs: Record<string, HTMLInputElement> = {};
  const maxErrors: Record<string, HTMLElement> = {};
  for (const exercise of Object.values(program.exercises)) {
    if (!exercise.maxTested) {
      continue;
    }
    const input = element("input");
    input.type = "number";
    input.id = `max-${exercise.id}`;
    input.name = `max-${exercise.id}`;
    input.inputMode = "numeric";
    input.min = "1";
    input.step = "1";
    input.value = current.maxReps[exercise.id]?.toString() ?? "";
    const error = element("p", "field-error");
    maxInputs[exercise.id] = input;
    maxErrors[exercise.id] = error;
    form.append(buildField(`Max reps: ${exercise.name}`, input, error));
  }

  const saveButton = element("button", "primary-button", "Save");
  saveButton.type = "submit";
  form.append(saveButton);

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    const maxTexts: Record<string, string> = {};
    for (const [exerciseId, input] of Object.entries(maxInputs)) {
      maxTexts[exerciseId] = input.value;
    }
    const result = validateSettingsForm({ startDate: startDateInput.value, maxReps: maxTexts });

    // Clear old messages, then show new ones.
    startDateError.textContent = "";
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

    onSave(result.settings);
  });

  screen.append(form);
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
