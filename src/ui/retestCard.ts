import type { Exercise } from "../program/model";
import type { TrainingSettings } from "../settings/model";
import { element } from "./dom";
import { PREVIEW_SAVING_OFF_MESSAGE } from "./checkin";
import { renderStepper } from "./setEditor";

/**
 * The "Retest week" card at the top of Today (PLAN.md rule 5), drawn by
 * today.ts when `retestExercisesToSave` finds something to ask for.
 *
 *   ┌ Retest week                                              ┐
 *   │ Test your max <names from program.json>, then save...    │
 *   │ Pull-ups   [ − 12 + ] reps   [Save max]                  │
 *   │ Dips       [ − 15 + ] reps   [Save max]                  │
 *   │ [Not today]                                              │
 *   └──────────────────────────────────────────────────────────┘
 *
 * One Save button per exercise (not one for both): Ed often tests one
 * exercise at a time, and a save is immediate and re-renders Today, so the
 * saved exercise's row drops out while the other stays. app.ts owns the
 * saving; this file only builds the DOM.
 *
 * In a `?date=` preview (`canSave` false) every Save is disabled, a line says
 * saving is off, and "Not today" is not offered: a preview changes nothing
 * (a preview save would stamp the real date and change the max for every week).
 */

/** Callbacks and shared state the card needs from app.ts. */
export interface RetestCardActions {
  /** False in a `?date=` preview: the Save buttons are disabled and "Not today" is left out. */
  canSave: boolean;

  /**
   * Saves a new max for one exercise (stamped with the real date, persisted,
   * Today re-rendered by app.ts). Returns null on success or a message to
   * show inline when the device refused the write.
   */
  onSaveMax: (exerciseId: string, newMax: number) => string | null;

  /** "Not today" tapped: hide the card for the shown date (never called when `canSave` is false). */
  onDismiss: () => void;

  /**
   * Stepper values typed so far, by exercise id. Lives in app.ts so a
   * re-render after saving one exercise does not reset the other's stepper.
   */
  drafts: Record<string, number | undefined>;
}

/**
 * Joins exercise names for a sentence in lower case: "pull-ups", "pull-ups
 * and dips", "a, b and c". The names come from program.json's `maxTested`
 * exercises, so the card never hard-codes which exercises are tested.
 */
export function joinExerciseNames(names: string[]): string {
  const lowered = names.map((name) => name.toLowerCase());
  if (lowered.length <= 1) return lowered.join("");

  return `${lowered.slice(0, -1).join(", ")} and ${lowered[lowered.length - 1]}`;
}

/**
 * Moves focus to the first stepper button of the retest card, if it is still
 * on screen. Called by app.ts after a Save max re-render, because the button
 * that was pressed is gone with its row; returns false when no row is left
 * (the card is gone) so the caller can fall back to the main heading.
 */
export function focusRemainingRetestStepper(): boolean {
  const button = document.querySelector<HTMLElement>(".retest-card .log-stepper-button");
  if (button === null) return false;

  button.focus();
  return true;
}

/**
 * Builds the card for the exercises still to retest. Each stepper starts at
 * the draft value if there is one, else the current saved max (undefined
 * shows "—" and the first + gives 1).
 */
export function renderRetestCard(
  exercises: Exercise[],
  settings: TrainingSettings,
  actions: RetestCardActions,
): HTMLElement {
  const card = element("section", "card retest-card");
  card.setAttribute("aria-label", "Retest week");
  card.append(
    element("h2", "card-title", "Retest week"),
    element("p", "retest-intro", `Test your max ${joinExerciseNames(exercises.map((exercise) => exercise.name))}, then save them. This week's EMOMs switch to the new numbers.`),
  );

  for (const exercise of exercises) {
    card.append(renderRetestRow(exercise, settings, actions));
  }

  if (actions.canSave) {
    const dismissButton = element("button", "retest-dismiss", "Not today");
    dismissButton.type = "button";
    dismissButton.addEventListener("click", actions.onDismiss);
    card.append(dismissButton);
  } else {
    card.append(element("p", "preview-note", PREVIEW_SAVING_OFF_MESSAGE));
  }

  return card;
}

/** One exercise: its name, a reps stepper, a Save button and an inline error slot. */
function renderRetestRow(exercise: Exercise, settings: TrainingSettings, actions: RetestCardActions): HTMLElement {
  const row = element("div", "retest-row");
  const { drafts } = actions;
  drafts[exercise.id] ??= settings.maxReps[exercise.id]; // stays undefined when no max yet: shown as "—"

  const error = element("p", "field-error");
  error.setAttribute("role", "alert");

  const saveButton = element("button", "retest-save", "Save max");
  saveButton.type = "button";
  saveButton.disabled = !actions.canSave;
  saveButton.setAttribute("aria-label", `Save max for ${exercise.name}`);
  saveButton.addEventListener("click", () => {
    const newMax = drafts[exercise.id];
    if (newMax === undefined) {
      error.textContent = "Set your max first";
      return;
    }
    error.textContent = actions.onSaveMax(exercise.id, newMax) ?? "";
  });

  const stepperRow = renderStepper(
    `${exercise.name} max`,
    "reps",
    () => drafts[exercise.id],
    (value) => { drafts[exercise.id] = value; },
    1,
    1,
    false,
  );
  stepperRow.append(saveButton); // beside the stepper, on the same line

  row.append(element("div", "retest-name", exercise.name), stepperRow, error);
  return row;
}
