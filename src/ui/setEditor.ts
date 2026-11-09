import { element } from "./dom";

/**
 * Editing widgets for one logged set, shared by the log screen (editing a set
 * it just logged) and the History screen (editing any past set), so both look
 * and behave the same.
 *
 *   renderStepper         big − / value / + control with a unit label
 *   renderNoteInput       the optional free-text note field
 *   renderSetEditor       a ready-made panel for History: steppers + note +
 *                         Cancel / Delete / Save buttons
 *
 * The log screen keeps its own draft state and button bar (it also logs new
 * sets) and uses only the first two; History uses `renderSetEditor`.
 */

/** Smallest reps value the stepper can reach; a set with 0 reps is a skip, not a log. */
export const MINIMUM_REPS = 1;

/** Kg step. Whole kilograms keep the stepper quick; 0 means no load. */
export const KILOGRAM_STEP = 1;

/**
 * A big − / value / + stepper with a unit label beside it. `read` and `write`
 * connect it to the caller's draft; an undefined value shows "—" (reps not
 * known yet, or no load; with `zeroMeansNone`, stepping down to 0 clears the
 * value). The value text is updated in place, so focus stays on the pressed button.
 */
export function renderStepper(
  name: string,
  unit: string,
  read: () => number | undefined,
  write: (value: number | undefined) => void,
  minimum: number,
  step: number,
  zeroMeansNone: boolean,
): HTMLElement {
  const row = element("div", "log-stepper-row");
  const stepper = element("div", "log-stepper");
  const value = element("output", "log-stepper-value");
  value.setAttribute("aria-label", name);

  /** Shows the current draft value (or "—" when none). */
  function showValue(): void {
    value.textContent = read() === undefined ? "—" : String(read());
  }

  /** Applies one step; for reps an undefined start steps up to the minimum, and kg steps down to "none". */
  function changeBy(direction: 1 | -1): void {
    const current = read();
    if (current === undefined) {
      if (direction === 1) write(Math.max(minimum, step));
    } else {
      const next = current + direction * step;
      if (zeroMeansNone) {
        write(next <= 0 ? undefined : next);
      } else {
        write(Math.max(minimum, next));
      }
    }
    showValue();
  }

  const decrease = element("button", "log-stepper-button", "−");
  decrease.type = "button";
  decrease.setAttribute("aria-label", `Decrease ${name}`);
  decrease.addEventListener("click", () => changeBy(-1));

  const increase = element("button", "log-stepper-button", "+");
  increase.type = "button";
  increase.setAttribute("aria-label", `Increase ${name}`);
  increase.addEventListener("click", () => changeBy(1));

  showValue();
  stepper.append(decrease, value, increase);
  row.append(stepper, element("span", "log-stepper-unit", unit));
  return row;
}

/** The note text field, starting at `initialValue`; every keystroke is reported through `onInput`. */
export function renderNoteInput(initialValue: string, onInput: (value: string) => void): HTMLInputElement {
  const input = element("input", "log-note-input");
  input.type = "text";
  input.value = initialValue;
  input.placeholder = "Note";
  input.setAttribute("aria-label", "Note");
  input.maxLength = 500;
  input.addEventListener("input", () => onInput(input.value));
  return input;
}

/** A big button for an action bar (same look as the log screen's). */
export function renderActionButton(className: string, label: string, onClick: () => void): HTMLButtonElement {
  const button = element("button", `log-action ${className}`, label);
  button.type = "button";
  button.addEventListener("click", onClick);
  return button;
}

/** The values an edit panel starts from and hands back on Save. Zero or undefined kg means no load. */
export interface SetEditorValues {
  /** Undefined for sets that have no reps (rounds, holds) or none was recorded. */
  reps?: number;
  /** 0 means no load. */
  loadKg: number;
  note: string;
}

/** Callbacks for `renderSetEditor`. */
export interface SetEditorActions {
  /** Save tapped, with the edited values. */
  onSave: (values: SetEditorValues) => void;
  /** Cancel tapped. */
  onCancel: () => void;
  /** Delete tapped. */
  onDelete: () => void;
}

/**
 * The edit panel for one logged set on History: reps and kg steppers (only
 * when `showsRepsAndLoad`; rounds and holds only have a note), the note field
 * (always open: the set's note may be cleared), and Cancel / Delete / Save
 * buttons. `title` is the panel heading, e.g. "Set 2". The panel owns its
 * draft; the caller only receives the final values through `actions.onSave`.
 */
export function renderSetEditor(
  title: string,
  initial: SetEditorValues,
  showsRepsAndLoad: boolean,
  actions: SetEditorActions,
): HTMLElement {
  const draft: SetEditorValues = { ...initial };

  const panel = element("div", "log-set-current history-editor");
  panel.append(element("div", "log-set-label log-set-label-current", title));

  if (showsRepsAndLoad) {
    panel.append(
      renderStepper("reps", "reps", () => draft.reps, (value) => { draft.reps = value; }, MINIMUM_REPS, 1, false),
      renderStepper("kg", "kg", () => (draft.loadKg > 0 ? draft.loadKg : undefined), (value) => { draft.loadKg = value ?? 0; }, 0, KILOGRAM_STEP, true),
    );
  }

  panel.append(renderNoteInput(draft.note, (value) => { draft.note = value; }));

  const buttons = element("div", "history-editor-actions");
  buttons.append(
    renderActionButton("log-primary", "✓ Save changes", () => actions.onSave({ ...draft })),
    renderActionButton("log-secondary", "Cancel", actions.onCancel),
    renderActionButton("log-secondary log-danger", "Delete set", actions.onDelete),
  );
  panel.append(buttons);

  return panel;
}
