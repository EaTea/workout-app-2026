import type { FatigueField, FatigueHistory } from "../fatigue/model";
import { bestRecent, compareToBest, type Comparison, type FatigueWarning } from "../fatigue/operations";
import { element } from "./dom";
import { renderStepper, STEPPER_REFRESH_EVENT, type StepperNumberRules } from "./setEditor";
import {
  BROAD_JUMP_STEP_METRES,
  DEFAULT_BROAD_JUMP_METRES,
  DEFAULT_PULL_UPS,
  MAXIMUM_BROAD_JUMP_METRES,
  MAXIMUM_PULL_UPS,
  MINIMUM_BROAD_JUMP_METRES,
  PREVIEW_SAVING_OFF_MESSAGE,
  describeDrops,
  formatBestRecent,
  formatMetres,
  formatPercentChange,
  parseBroadJumpInput,
  roundToTwoDecimals,
  type CheckInDraft,
} from "./checkin";
import { focusMainHeading } from "./warningBanner";

/**
 * The "Weekly check-in" card at the top of Today (PLAN.md rule 6, mockup 6),
 * drawn by today.ts when `checkInWeekToAsk` says a check is due.
 *
 *   ┌ WEEK 3 · WEEKLY CHECK-IN                       ┐
 *   │ How are you tracking?                          │
 *   │ Takes 2 minutes, before today's warm-up.       │
 *   │ BEST BROAD JUMP                        [Clear] │   Clear: back to blank
 *   │ [ − 2.31 + ] m                          (−1%)  │   green pill
 *   │ Best recent: 2.34 m                            │
 *   │ MAX PULL-UPS                                   │
 *   │ [ − — + ] reps                                 │   blank until tapped
 *   │ Best recent: 12 reps                           │
 *   │ ⚠ Pull-ups are down more than 10% this week.   │   only on a drop
 *   │ [ Save check-in ]   [ Remind me tomorrow ]     │
 *   └────────────────────────────────────────────────┘
 *
 * Both fields start blank (never pre-filled: a blank is never saved as a
 * number). The first tap on a blank stepper lands on "Best recent" (or a
 * default when there is none); "Clear" puts a field back to blank.
 *
 * In a `?date=` preview (`canSave` false) the Save button is disabled, a line
 * says saving is off, and "Remind me tomorrow" is not offered (a snooze would
 * write to storage too; a preview changes nothing).
 *
 * app.ts owns the saving and the snooze; this file only builds the DOM and
 * keeps the pills and the warning in step with the steppers.
 */

/** Callbacks and shared state the card needs from app.ts. */
export interface CheckInCardActions {
  /** The draft the steppers edit; lives in app.ts so a re-render does not reset unsaved values. */
  draft: CheckInDraft;

  /** False in a `?date=` preview: Save is disabled and the snooze button is left out. */
  canSave: boolean;

  /** Saves the check (blank fields skipped). Returns null on success or a message to show inline. */
  onSave: (values: { broadJumpMetres?: number; maxPullUps?: number }) => string | null;

  /** "Remind me tomorrow" tapped (never called when `canSave` is false). */
  onSnooze: () => void;
}

/** Broad jump stepper rules: two decimals, 0.01 to 5 m, typed text up to two decimals. */
const BROAD_JUMP_RULES: StepperNumberRules = {
  round: roundToTwoDecimals,
  maximum: MAXIMUM_BROAD_JUMP_METRES,
  parseTyped: parseBroadJumpInput,
  format: formatMetres,
  allowBlank: true,
};

/** Pull-up stepper rules: whole numbers up to the stored maximum, no typing. */
const PULL_UP_RULES: StepperNumberRules = {
  round: Math.round,
  maximum: MAXIMUM_PULL_UPS,
};

/**
 * Builds the card for program `week`. `history` supplies the "Best recent"
 * values (only checks of earlier weeks count); `ruleText` is the program's
 * `fatigueCheck.rule`, shown in the amber warning while either value is down
 * more than 10%.
 */
export function renderCheckInCard(
  week: number,
  history: FatigueHistory,
  ruleText: string,
  actions: CheckInCardActions,
): HTMLElement {
  const { draft } = actions;
  const card = element("section", "card checkin-card");
  card.setAttribute("aria-label", "Weekly check-in");

  const warning = element("div", "checkin-warning");
  warning.setAttribute("role", "status");

  const error = element("p", "field-error");
  error.setAttribute("role", "alert");

  const saveButton = element("button", "checkin-save", "Save check-in");
  saveButton.type = "button";

  /** Re-evaluates the warning and the Save button after any stepper change. */
  function refreshSummary(): void {
    const drops: FatigueWarning[] = [];
    for (const field of ["broadJumpMetres", "maxPullUps"] as const) {
      const value = draft[field];
      const best = bestRecent(history, field, week);
      if (value === undefined || best === undefined) continue;

      const comparison = compareToBest(value, best);
      if (comparison.isDropOverThreshold) drops.push({ field, value, best, percentChange: comparison.percentChange });
    }

    warning.hidden = drops.length === 0;
    warning.replaceChildren();
    if (drops.length > 0) {
      warning.append(element("strong", undefined, `⚠ ${describeDrops(drops)}`), " ", ruleText);
    }

    saveButton.disabled = !actions.canSave || (draft.broadJumpMetres === undefined && draft.maxPullUps === undefined);
    error.textContent = "";
  }

  const broadJumpSection = renderFieldSection({
    heading: "Best broad jump",
    field: "broadJumpMetres",
    stepperName: "Best broad jump",
    unit: "m",
    history,
    week,
    read: () => draft.broadJumpMetres,
    write: (value) => { draft.broadJumpMetres = value; refreshSummary(); },
    minimum: MINIMUM_BROAD_JUMP_METRES,
    step: BROAD_JUMP_STEP_METRES,
    rules: BROAD_JUMP_RULES,
    defaultStart: DEFAULT_BROAD_JUMP_METRES,
    allowTyping: true,
  });
  const pullUpSection = renderFieldSection({
    heading: "Max pull-ups",
    field: "maxPullUps",
    stepperName: "Max pull-ups",
    unit: "reps",
    history,
    week,
    read: () => draft.maxPullUps,
    write: (value) => { draft.maxPullUps = value; refreshSummary(); },
    minimum: 0,
    step: 1,
    rules: PULL_UP_RULES,
    defaultStart: DEFAULT_PULL_UPS,
    allowTyping: false,
  });

  saveButton.addEventListener("click", () => {
    error.textContent = actions.onSave({ broadJumpMetres: draft.broadJumpMetres, maxPullUps: draft.maxPullUps }) ?? "";
  });

  card.append(
    element("p", "checkin-kicker", `Week ${week} · Weekly check-in`),
    element("h2", "card-title", "How are you tracking?"),
    element("p", "checkin-intro", "Takes 2 minutes, before today's warm-up."),
    broadJumpSection.element,
    pullUpSection.element,
    warning,
    error,
    saveButton,
  );

  if (actions.canSave) {
    const snoozeButton = element("button", "checkin-snooze", "Remind me tomorrow");
    snoozeButton.type = "button";
    snoozeButton.addEventListener("click", actions.onSnooze);
    card.append(snoozeButton);
  } else {
    card.append(element("p", "preview-note", PREVIEW_SAVING_OFF_MESSAGE));
  }

  refreshSummary();
  return card;
}

/** Everything `renderFieldSection` needs for one measurement. */
interface FieldSectionOptions {
  heading: string;
  field: FatigueField;
  stepperName: string;
  unit: string;
  history: FatigueHistory;
  week: number;
  read: () => number | undefined;
  write: (value: number | undefined) => void;
  minimum: number;
  step: number;
  rules: StepperNumberRules;

  /** Where the first tap on a blank stepper lands when there is no "best recent". */
  defaultStart: number;
  allowTyping: boolean;
}

/** A built section. */
interface FieldSection {
  element: HTMLElement;
}

/**
 * One measurement: heading, stepper with its percentage pill, and the "Best
 * recent" line (absent when no earlier check recorded the field). The pill is
 * green when the value is not down more than 10% and amber when it is;
 * absent while the field is blank or there is nothing to compare with. A
 * "Clear" button (44px tall, shown only while the field has a value) puts the
 * field back to blank.
 */
function renderFieldSection(options: FieldSectionOptions): FieldSection {
  const section = element("div", "checkin-field");
  const best = bestRecent(options.history, options.field, options.week);
  const pill = element("span", "pill checkin-pill");

  // The first tap on a blank stepper starts from the best recent value, else a default.
  const rules: StepperNumberRules = { ...options.rules, startingValue: best ?? options.defaultStart };

  const stepperRow = renderStepper(
    options.stepperName,
    options.unit,
    options.read,
    (value) => { options.write(value); refreshPill(); },
    options.minimum,
    options.step,
    false,
    options.allowTyping,
    rules,
  );
  stepperRow.append(pill);

  const clearButton = element("button", "checkin-clear", "Clear");
  clearButton.type = "button";
  clearButton.setAttribute("aria-label", `Clear ${options.heading}`);
  clearButton.addEventListener("click", () => {
    options.write(undefined);
    refreshPill();
    stepperRow.dispatchEvent(new Event(STEPPER_REFRESH_EVENT));
    // The Clear button hides itself now, so keep keyboard focus inside the field.
    stepperRow.querySelector<HTMLElement>(".log-stepper-button:last-of-type")?.focus();
  });

  /** Shows "−17%" in the right colour (hiding it when there is nothing to compare), and shows Clear only while the field has a value. */
  function refreshPill(): void {
    const value = options.read();
    clearButton.hidden = value === undefined;
    pill.hidden = value === undefined || best === undefined;
    if (value === undefined || best === undefined) return;

    const comparison: Comparison = compareToBest(value, best);
    pill.textContent = formatPercentChange(comparison.percentChange);
    pill.classList.toggle("pill-warn", comparison.isDropOverThreshold);
    pill.classList.toggle("pill-ok", !comparison.isDropOverThreshold);
  }

  const titleRow = element("div", "checkin-field-head");
  titleRow.append(element("h3", "checkin-field-title", options.heading), clearButton);
  section.append(titleRow, stepperRow);
  if (best !== undefined) {
    section.append(element("p", "checkin-best", formatBestRecent(options.field, best)));
  }

  refreshPill();
  return { element: section };
}

/**
 * The dismissible amber banner on Today after a check-in with a drop:
 * "Pull-ups are down more than 10% this week. <rule>". `onDismiss` lets app.ts
 * remember the dismissal for that week; focus then moves to the page heading
 * because the Dismiss button disappears with the banner.
 */
export function renderDropBanner(warnings: FatigueWarning[], ruleText: string, onDismiss: () => void): HTMLElement {
  const banner = element("div", "card warning-banner drop-banner");
  banner.setAttribute("role", "status");

  const dismissButton = element("button", "warning-dismiss", "Dismiss");
  dismissButton.type = "button";
  dismissButton.addEventListener("click", () => {
    onDismiss();
    focusMainHeading();
  });

  const text = element("p", "warning-banner-text");
  text.append(element("strong", undefined, `⚠ ${describeDrops(warnings)}`), " ", ruleText);

  const header = element("div", "warning-banner-header");
  header.append(text, dismissButton);
  banner.append(header);
  return banner;
}
