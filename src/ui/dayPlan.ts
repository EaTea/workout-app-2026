import type { Program } from "../program/model";
import { compareWithPreviousWeek, buildDayPlan, type DayPlanChanges } from "../program/dayPlan";
import { itemDisplayName } from "../program/rotation";
import type { BlockView, ItemView, SessionView } from "../program/schedule";
import type { TrainingSettings } from "../settings/model";
import { element } from "./dom";
import { formatBlockChange, formatBlockTitle, formatItemChange, formatItemDetails, formatItemDose, formatPlanKicker, formatRange, formatTimerAdjustment } from "./format";
import { planRouteHash } from "./router";
import "./dayPlan.css";

/**
 * The read-only Day plan screen, rendered by app.ts for `#/plan/<day>/<week>`
 * (reached from the Overview's day rows).
 *
 *   buildDayPlan(...)              ─▶ SessionView (what Today would show)
 *   compareWithPreviousWeek(...)   ─▶ DayPlanChanges (vs. the week before)
 *                    └─▶ renderDayPlanScreen
 *      ‹ Program overview            back link
 *      kicker · h1 · subtitle        "Day 1 · Week 4 of 8 · Deload", focus, "~50 min · 6 blocks"
 *      week picker                   1..lengthWeeks, tinted by phase
 *      phase changes                 the phase's list from program.progression
 *      block cards                   same rows as Today, no buttons, plus "Changed: ..." lines
 *
 * Nothing here computes training figures: it formats what `buildSession`
 * returned, with the same `format*` helpers Today uses. It has no logging,
 * timers or last-time hints; Today is the only place to train from.
 */

/** Text on the card shown when the URL asks for a rest day (not linked from anywhere). */
const REST_DAY_MESSAGE = "Recover; no training is planned.";

/**
 * Builds the Day plan for program `week` and `dayNumber`, or returns
 * undefined when they are outside the program (app.ts then shows the
 * Overview). `today` is the shown date, used as the stand-in start when no
 * start date is saved; `search` is `location.search`, kept by the week links
 * so a `?date=` preview survives.
 */
export function renderDayPlanScreen(program: Program, settings: TrainingSettings, week: number, dayNumber: number, today: string, search: string): HTMLElement | undefined {
  const session = buildDayPlan(program, settings, week, dayNumber, today);
  if (session === undefined) {
    return undefined;
  }

  const screen = element("section", "screen day-plan");
  screen.append(renderBackLink());

  if (session.kind === "rest") {
    screen.append(renderRestCard(session, program.lengthWeeks));
    return screen;
  }
  if (session.kind !== "training") {
    // buildDayPlan always has a start date and an in-range week, so only training or rest can come back.
    return undefined;
  }

  const changes = compareWithPreviousWeek(program, settings, week, dayNumber, today);

  const header = element("header", "today-header");
  header.append(
    element("div", "kicker", formatPlanKicker(dayNumber, week, program.lengthWeeks, session.phase)),
    element("h1", "today-title", session.focus),
    element("div", "today-subtitle", `~${session.targetMinutes} min · ${session.blocks.length} blocks`),
  );

  screen.append(header, renderWeekPicker(program, dayNumber, week, search), renderPhaseChanges(program, session));
  session.blocks.forEach((block, index) => screen.append(renderPlanBlock(block, index, session, changes)));
  return screen;
}

/** The "‹ Program overview" link back to `#/overview` (hash only, so a `?date=` preview survives). */
function renderBackLink(): HTMLAnchorElement {
  const link = element("a", "overview-link plan-back-link", "‹ Program overview");
  link.href = "#/overview";
  return link;
}

/** The "Day 7 · Rest" card for a rest day (only reachable by typing the URL). */
function renderRestCard(session: Extract<SessionView, { kind: "rest" }>, lengthWeeks: number): HTMLElement {
  const card = element("div", "card message-card");
  card.append(
    element("div", "kicker", formatPlanKicker(session.dayNumber, session.week, lengthWeeks, session.phase)),
    element("h1", "card-title", `Day ${session.dayNumber} · Rest`),
    element("p", undefined, REST_DAY_MESSAGE),
  );
  return card;
}

/**
 * One link per program week. The shown week has aria-current="true"; every
 * cell carries `data-phase` (the phase's index in program.progression) which
 * the CSS tints. Tapping swaps the plan in place with `location.replace`,
 * so Back still returns to the Overview in one step; the relative "#/plan/.."
 * target keeps the query string (`?date=` preview).
 */
function renderWeekPicker(program: Program, dayNumber: number, shownWeek: number, search: string): HTMLElement {
  const picker = element("nav", "plan-weeks");
  picker.setAttribute("aria-label", "Week");

  for (let week = 1; week <= program.lengthWeeks; week++) {
    const isShown = week === shownWeek;
    const link = element("a", isShown ? "plan-week plan-week-current" : "plan-week", String(week));
    link.href = `${search}${planRouteHash(dayNumber, week)}`;
    link.dataset.phase = String(phaseIndexForWeek(program, week));
    link.setAttribute("aria-label", `Week ${week}`);
    if (isShown) {
      link.setAttribute("aria-current", "true");
    }

    link.addEventListener("click", (event) => {
      event.preventDefault();
      window.location.replace(planRouteHash(dayNumber, week));
    });
    picker.append(link);
  }

  return picker;
}

/** Index in program.progression of the phase covering `week` (-1 if none, which the schedule would reject anyway). */
function phaseIndexForWeek(program: Program, week: number): number {
  return program.progression.findIndex((entry) => entry.weeks.includes(week));
}

/** The shown week's phase name and every change listed for it, as a small card. */
function renderPhaseChanges(program: Program, session: Extract<SessionView, { kind: "training" }>): HTMLElement {
  const card = element("div", session.isDeload ? "card plan-phase plan-phase-deload" : "card plan-phase");
  card.append(element("div", "plan-phase-name", session.phase));

  const changes = program.progression.find((entry) => entry.phase === session.phase)?.changes ?? [];
  if (changes.length > 0) {
    const list = element("ul", "plan-phase-changes");
    for (const change of changes) {
      list.append(element("li", undefined, change));
    }
    card.append(list);
  }

  return card;
}

/** One block card: numbered title, an optional "Changed" line, the between-pairs rest, then the item rows. */
function renderPlanBlock(block: BlockView, blockIndex: number, session: Extract<SessionView, { kind: "training" }>, changes: DayPlanChanges | undefined): HTMLElement {
  const position = blockIndex + 1;
  const card = element("section", "card block-card");
  card.append(element("h2", "block-title", formatBlockTitle(position, block)));

  const blockChange = changes?.blocks.find((change) => change.blockIndex === blockIndex);
  if (changes !== undefined && blockChange !== undefined) {
    card.append(element("p", "plan-changed", formatBlockChange(position, blockChange.previous, changes.previousWeek)));
  }

  if (block.restSecBetweenPairs) {
    card.append(element("p", "plan-block-rest", `Rest ${formatRange(block.restSecBetweenPairs)}s between pairs`));
    if (block.restAdjustment !== undefined) {
      card.append(element("p", "timer-adjustment", formatTimerAdjustment(session.phase, block.restAdjustment, "rest")));
    }
  }

  block.items.forEach((item, itemIndex) => {
    const itemChange = changes?.items.find((change) => change.blockIndex === blockIndex && change.itemIndex === itemIndex);
    const changedText = changes !== undefined && itemChange !== undefined ? formatItemChange(itemChange.previous, item, changes.previousWeek) : undefined;
    card.append(renderPlanItemRow(item, session.phase, changedText));
  });

  return card;
}

/**
 * One read-only item row, laid out like Today's (name, details, dose) but
 * with no button, link or timer. `changedText` is the "Changed: ..." line for
 * an item that differs from the previous week, or undefined.
 */
function renderPlanItemRow(item: ItemView, phase: string, changedText: string | undefined): HTMLElement {
  const row = element("div", "item-row");
  const content = element("div", "item-open plan-item");

  const text = element("span", "item-text");
  text.append(element("span", "item-name", itemDisplayName(item)));
  if (item.rotatedIn !== undefined) {
    text.append(element("span", "item-rotated-in", `Rotated in for ${item.rotatedIn.originalName}`));
  }

  const details = formatItemDetails(item);
  if (details.length > 0) {
    text.append(element("span", "item-details", details.join(" · ")));
  }
  if (item.workSecAdjustment !== undefined) {
    text.append(element("span", "timer-adjustment", formatTimerAdjustment(phase, item.workSecAdjustment, "work")));
  }
  if (item.showsSameEveryWeekNote) {
    text.append(element("span", "timer-adjustment", "Same every week"));
  }
  if (changedText !== undefined) {
    text.append(element("span", "plan-changed", changedText));
  }

  const dose = formatItemDose(item);
  const doseBox = element("span", "item-dose");
  doseBox.append(element("span", "item-dose-main", dose.text));
  if (dose.subtext) {
    doseBox.append(element("span", "item-dose-sub", dose.subtext));
  }

  content.append(text, doseBox);
  row.append(content);
  return row;
}
