import type { FatigueField, FatigueHistory } from "../fatigue/model";
import { bestRecent, compareToBest, type Comparison, type FatigueWarning } from "../fatigue/operations";
import { element } from "./dom";
import { renderStepper, type StepperNumberRules } from "./setEditor";
import {
  BROAD_JUMP_STEP_METRES,
  MAXIMUM_BROAD_JUMP_METRES,
  MAXIMUM_PULL_UPS,
  MINIMUM_BROAD_JUMP_METRES,
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
 *   │ BEST BROAD JUMP                                │
 *   │ [ − 2.31 + ] m                          (−1%)  │   green pill
 *   │ Best recent: 2.34 m                            │
 *   │ MAX PULL-UPS                                   │
 *   │ [ − 10 + ] reps                        (−17%)  │   amber pill
 *   │ Best recent: 12 reps                           │
 *   │ ⚠ Pull-ups are down more than 10%. <rule>      │   only on a drop
 *   │ [ Save check-in ]   [ Remind me tomorrow ]     │
 *   └────────────────────────────────────────────────┘
 *
 * app.ts owns the saving and the snooze; this file only builds the DOM and
 * keeps the pills and the warning in step with the steppers.
 */

/** Callbacks and shared state the card needs from app.ts. */
export interface CheckInCardActions {
  /** The draft the steppers edit; lives in app.ts so a re-render does not reset unsaved values. */
  draft: CheckInDraft;

  /** Saves the check (blank fields skipped). Returns null on success or a message to show inline. */
  onSave: (values: { broadJumpMetres?: number; maxPullUps?: number }) => string | null;

  /** "Remind me tomorrow" tapped. */
  onSnooze: () => void;
}

/** Broad jump stepper rules: two decimals, 0.01 to 5 m, typed text up to two decimals. */
const BROAD_JUMP_RULES: StepperNumberRules = {
  round: roundToTwoDecimals,
  maximum: MAXIMUM_BROAD_JUMP_METRES,
  parseTyped: parseBroadJumpInput,
  format: formatMetres,
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

    saveButton.disabled = draft.broadJumpMetres === undefined && draft.maxPullUps === undefined;
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
    allowTyping: false,
  });

  saveButton.addEventListener("click", () => {
    error.textContent = actions.onSave({ broadJumpMetres: draft.broadJumpMetres, maxPullUps: draft.maxPullUps }) ?? "";
  });

  const snoozeButton = element("button", "checkin-snooze", "Remind me tomorrow");
  snoozeButton.type = "button";
  snoozeButton.addEventListener("click", actions.onSnooze);

  card.append(
    element("p", "checkin-kicker", `Week ${week} · Weekly check-in`),
    element("h2", "card-title", "How are you tracking?"),
    element("p", "checkin-intro", "Takes 2 minutes, before today's warm-up."),
    broadJumpSection.element,
    pullUpSection.element,
    warning,
    error,
    saveButton,
    snoozeButton,
  );

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
  allowTyping: boolean;
}

/** A built section plus the function that redraws its percentage pill. */
interface FieldSection {
  element: HTMLElement;
  refreshPill: () => void;
}

/**
 * One measurement: heading, stepper with its percentage pill, and the "Best
 * recent" line (absent when no earlier check recorded the field). The pill is
 * green when the value is not down more than 10% and amber when it is;
 * absent while the field is blank or there is nothing to compare with.
 */
function renderFieldSection(options: FieldSectionOptions): FieldSection {
  const section = element("div", "checkin-field");
  const best = bestRecent(options.history, options.field, options.week);
  const pill = element("span", "pill checkin-pill");

  const stepperRow = renderStepper(
    options.stepperName,
    options.unit,
    options.read,
    (value) => { options.write(value); refreshPill(); },
    options.minimum,
    options.step,
    false,
    options.allowTyping,
    options.rules,
  );
  stepperRow.append(pill);

  /** Shows "−17%" in the right colour, or hides the pill when there is nothing to compare. */
  function refreshPill(): void {
    const value = options.read();
    pill.hidden = value === undefined || best === undefined;
    if (value === undefined || best === undefined) return;

    const comparison: Comparison = compareToBest(value, best);
    pill.textContent = formatPercentChange(comparison.percentChange);
    pill.classList.toggle("pill-warn", comparison.isDropOverThreshold);
    pill.classList.toggle("pill-ok", !comparison.isDropOverThreshold);
  }

  section.append(element("h3", "checkin-field-title", options.heading), stepperRow);
  if (best !== undefined) {
    section.append(element("p", "checkin-best", formatBestRecent(options.field, best)));
  }

  refreshPill();
  return { element: section, refreshPill };
}

/**
 * The dismissible amber banner on Today after a check-in with a drop:
 * "Pull-ups are down more than 10%. <rule>". `onDismiss` lets app.ts
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
