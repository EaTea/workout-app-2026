import { element } from "./dom";
import { KILOGRAM_STEP, parseKilogramInput, roundToOneDecimal } from "./kilograms";

/**
 * Editing widgets for one logged set, shared by the log screen (editing a set
 * it just logged) and the History screen (editing any past set), so both look
 * and behave the same.
 *
 *   renderStepper         big − / value / + control with a unit label; the
 *                         kg value can be tapped to type a number instead
 *   renderDeleteButton    "Delete set" that needs a second tap to confirm
 *   renderNoteInput       the optional free-text note field
 *   renderSetEditor       a ready-made panel for History: steppers + note +
 *                         Cancel / Delete / Save buttons
 *
 * The log screen keeps its own draft state and button bar (it also logs new
 * sets) and uses only the first two; History uses `renderSetEditor`.
 */

/**
 * How a stepper rounds, bounds and reads typed text for its kind of number.
 * The default (`KILOGRAM_RULES`) is the kg stepper's; the weekly check-in
 * card passes its own for metres and pull-up counts.
 */
export interface StepperNumberRules {
  /** Rounds after a step, so repeated steps never show floating-point noise ("2.3100000000000005"). */
  round: (value: number) => number;

  /** Largest value stepping up can reach; absent means no cap (the kg stepper's historical behaviour). */
  maximum?: number;

  /** Reads typed text; undefined when it is not acceptable (the field then reverts). Used only with `allowTyping`. */
  parseTyped?: (text: string) => number | undefined;

  /** Text shown for a value; defaults to `String(value)`. Metres use two decimals ("2.30"). */
  format?: (value: number) => string;
}

/** The kg stepper's rules: one decimal, typed text through `parseKilogramInput`. */
const KILOGRAM_RULES: StepperNumberRules = {
  round: roundToOneDecimal,
  parseTyped: (text) => {
    const parsed = parseKilogramInput(text);
    return parsed.isValid ? parsed.kilograms : undefined;
  },
};

/** Smallest reps value the stepper can reach; a set with 0 reps is a skip, not a log. */
export const MINIMUM_REPS = 1;

/** How long a delete button stays armed ("Tap again to delete") before it goes back to its normal label. */
export const DELETE_CONFIRMATION_MILLISECONDS = 4000;

/** Label of the delete button once armed. */
export const DELETE_CONFIRM_LABEL = "Tap again to delete";

/**
 * A big − / value / + stepper with a unit label beside it. `read` and `write`
 * connect it to the caller's draft; an undefined value shows "—" (reps not
 * known yet, or no load; with `zeroMeansNone`, stepping down to 0 clears the
 * value). The value text is updated in place, so focus stays on the pressed button.
 *
 * With `allowTyping` (the kg stepper) the value is a button: tapping it swaps
 * in a decimal text field (`inputmode="decimal"`). Enter or leaving the field
 * commits it through `parseKilogramInput`; Escape or an invalid entry puts
 * the previous value back. A typed 0 means "no load", like stepping down to 0.
 *
 * `rules` (default: kilograms) swaps the rounding, cap, typed-text parsing
 * and display format, so the check-in card can reuse the same widget for
 * metres (0.01 steps, two decimals) and pull-ups.
 */
export function renderStepper(
  name: string,
  unit: string,
  read: () => number | undefined,
  write: (value: number | undefined) => void,
  minimum: number,
  step: number,
  zeroMeansNone: boolean,
  allowTyping = false,
  rules: StepperNumberRules = KILOGRAM_RULES,
): HTMLElement {
  const row = element("div", "log-stepper-row");
  const stepper = element("div", "log-stepper");
  const value: HTMLElement = allowTyping ? element("button", "log-stepper-value log-stepper-value-button") : element("output", "log-stepper-value");
  value.setAttribute("aria-label", name);
  if (value instanceof HTMLButtonElement) {
    value.type = "button";
    value.title = `Tap to type ${unit}`;
  }

  /** Shows the current draft value (or "—" when none). */
  function showValue(): void {
    const current = read();
    value.textContent = current === undefined ? "—" : (rules.format ?? String)(current);
  }

  /** Applies one step; for reps an undefined start steps up to the minimum, and kg steps down to "none". */
  function changeBy(direction: 1 | -1): void {
    const current = read();
    if (current === undefined) {
      if (direction === 1) write(Math.max(minimum, step));
    } else {
      const next = Math.min(rules.maximum ?? Infinity, rules.round(current + direction * step));
      if (zeroMeansNone) {
        write(next <= 0 ? undefined : next);
      } else {
        write(Math.max(minimum, next));
      }
    }
    showValue();
  }

  /**
   * Swaps the value for a decimal text field (kg only). Commits on Enter or
   * when the field loses focus; Escape cancels. Called by tapping the value.
   */
  function startTyping(): void {
    const input = element("input", "log-stepper-input");
    input.type = "text";
    input.inputMode = "decimal";
    const current = read();
    input.value = current === undefined ? "" : String(current);
    input.setAttribute("aria-label", name);

    /** True once the field has been committed or cancelled, so the blur caused by removing it does nothing. */
    let isFinished = false;

    /** Closes the field; a valid entry is written to the draft, anything else reverts. */
    function finish(shouldCommit: boolean, returnFocusToValue: boolean): void {
      if (isFinished) return;
      isFinished = true;

      const typedValue = rules.parseTyped?.(input.value);
      if (shouldCommit && typedValue !== undefined) {
        write(zeroMeansNone && typedValue <= 0 ? undefined : typedValue);
      }

      input.replaceWith(value);
      showValue();
      if (returnFocusToValue) value.focus();
    }

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        finish(true, true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        finish(false, true);
      }
    });
    input.addEventListener("blur", () => finish(true, false));

    value.replaceWith(input);
    input.focus();
    input.select();
  }
  if (allowTyping) value.addEventListener("click", startTyping);

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

/**
 * A "Delete set" button that asks for a second tap. The first tap changes it
 * to "Tap again to delete" (danger style) for `DELETE_CONFIRMATION_MILLISECONDS`,
 * then it reverts; a second tap inside that time calls `onConfirmedDelete`.
 * Shared by the log screen and History so a stray tap never deletes a set.
 */
export function renderDeleteButton(onConfirmedDelete: () => void): HTMLButtonElement {
  const label = "Delete set";
  const button = renderActionButton("log-secondary log-danger", label, () => undefined);
  let revertTimeoutId: number | undefined;

  button.addEventListener("click", () => {
    if (revertTimeoutId !== undefined) {
      window.clearTimeout(revertTimeoutId);
      revertTimeoutId = undefined;
      onConfirmedDelete();
      return;
    }

    button.textContent = DELETE_CONFIRM_LABEL;
    button.classList.add("log-danger-armed");
    revertTimeoutId = window.setTimeout(() => {
      revertTimeoutId = undefined;
      button.textContent = label;
      button.classList.remove("log-danger-armed");
    }, DELETE_CONFIRMATION_MILLISECONDS);
  });
  return button;
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
      renderStepper("kg", "kg", () => (draft.loadKg > 0 ? draft.loadKg : undefined), (value) => { draft.loadKg = value ?? 0; }, 0, KILOGRAM_STEP, true, true),
    );
  }

  panel.append(renderNoteInput(draft.note, (value) => { draft.note = value; }));

  const buttons = element("div", "history-editor-actions");
  buttons.append(
    renderActionButton("log-primary", "✓ Save changes", () => actions.onSave({ ...draft })),
    renderActionButton("log-secondary", "Cancel", actions.onCancel),
    renderDeleteButton(actions.onDelete),
  );
  panel.append(buttons);

  return panel;
}
