import { renderShowMeButton } from "./showMeButton";
import type { Program, Range } from "../program/model";
import type { CombinesByDate } from "../combine/model";
import type { WorkoutLog } from "../log/model";
import { todayLocalDate } from "../program/calendar";
import { compareWithPreviousWeek, buildDayPlan, planDateFor, type DayPlanChanges } from "../program/dayPlan";
import { activeCombineOn, activeDonorOn } from "../program/combineOffers";
import { renderCombinedNote } from "./combineCards";
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
 * so a `?date=` preview survives. `programId` is the active program's catalogue
 * id, used to look up "Show me" animations for the rows. When `combines` holds a combine that involves
 * this day of this week (as the day that was added or the day it was added to),
 * a short "Combined with Day M on <date>" note sits under the header on both
 * days; the plan itself stays as planned. A lapsed combine (its host date
 * passed with nothing logged; see `isLapsedCombine`) shows no note, hence the
 * `log` and the device's `realToday`.
 */
export function renderDayPlanScreen(
  program: Program,
  programId: string,
  settings: TrainingSettings,
  week: number,
  dayNumber: number,
  today: string,
  search: string,
  combines: CombinesByDate = new Map(),
  log: WorkoutLog = { sessions: {} },
  realToday: string = todayLocalDate(),
): HTMLElement | undefined {
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

  screen.append(header);
  const combinedNote = renderCombinedNoteFor(program, settings, week, dayNumber, combines, log, realToday);
  if (combinedNote !== undefined) screen.append(combinedNote);

  screen.append(renderWeekPicker(program, dayNumber, week, search), renderPhaseChanges(program, session));
  session.blocks.forEach((block, index) => screen.append(renderPlanBlock(programId, block, index, session, changes)));
  return screen;
}

/**
 * The "Combined with Day M on <date>" note for this day of this week, or
 * undefined. Works out the day's calendar date from the saved start date, then
 * asks whether it is a host date (combined with the added day) or a donor date
 * (combined into the host day). No start date, or no combine: no note.
 */
function renderCombinedNoteFor(
  program: Program,
  settings: TrainingSettings,
  week: number,
  dayNumber: number,
  combines: CombinesByDate,
  log: WorkoutLog,
  realToday: string,
): HTMLElement | undefined {
  if (settings.startDate === null) return undefined;

  const date = planDateFor(settings.startDate, week, dayNumber);

  const hostCombine = activeCombineOn(program, settings.startDate, date, combines, log, realToday);
  if (hostCombine !== undefined) return renderCombinedNote(hostCombine.addedDay, hostCombine.addedDate);

  const donor = activeDonorOn(program, settings.startDate, date, combines, log, realToday);
  if (donor !== undefined) return renderCombinedNote(donor.hostDay, donor.hostDate);

  return undefined;
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
 * target keeps the query string (`?date=` preview). After a tap that changes
 * the week, focus moves to the new current-week link (the old element is gone
 * after the re-render), so keyboard users keep their place.
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
      const targetHash = planRouteHash(dayNumber, week);
      if (window.location.hash === targetHash) {
        // Same week: no hashchange and no re-render, so this link is still the current one.
        link.focus();
        return;
      }

      // app.ts's render listener was added first, so this runs after the new picker is drawn.
      window.addEventListener("hashchange", focusCurrentWeekLink, { once: true });
      window.location.replace(targetHash);
    });
    picker.append(link);
  }

  return picker;
}

/** Moves focus to the picker's current-week link; run once after a week tap's re-render has drawn the new picker. */
function focusCurrentWeekLink(): void {
  document.querySelector<HTMLElement>('.plan-week[aria-current="true"]')?.focus();
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

/** One block card (`programId` is passed on to the rows for "Show me"): numbered title, the between-pairs rest, an optional block "Changed" line (after the current figures), then the item rows. */
function renderPlanBlock(programId: string, block: BlockView, blockIndex: number, session: Extract<SessionView, { kind: "training" }>, changes: DayPlanChanges | undefined): HTMLElement {
  const position = block.position;
  const card = element("section", "card block-card");
  card.append(element("h2", "block-title", formatBlockTitle(position, block)));

  const blockChange = changes?.blocks.find((change) => change.blockIndex === blockIndex);

  if (block.restSecBetweenPairs) {
    card.append(element("p", "plan-block-rest", `Rest ${formatRange(block.restSecBetweenPairs)}s between pairs`));
    if (block.restAdjustment !== undefined) {
      card.append(element("p", "timer-adjustment", formatTimerAdjustment(session.phase, block.restAdjustment, "rest")));
    }
  }

  // After the current figures, so the previous figure reads as a note on them.
  if (changes !== undefined && blockChange !== undefined) {
    card.append(element("p", "plan-changed", formatBlockChange(position, blockChange.previous, changes.previousWeek)));
  }

  block.items.forEach((item, itemIndex) => {
    const itemChange = changes?.items.find((change) => change.blockIndex === blockIndex && change.itemIndex === itemIndex);
    // The block line already reports changed minutes/rounds; the item line must not repeat them.
    const blockReportsFigures = blockChange !== undefined && (blockChange.previous.minutes !== block.minutes || !sameRange(blockChange.previous.rounds, block.rounds));
    const changedText = changes !== undefined && itemChange !== undefined ? formatItemChange(itemChange.previous, item, itemChange.previousWeek, blockReportsFigures) : undefined;
    card.append(renderPlanItemRow(programId, item, session.phase, changedText));
  });

  return card;
}

/** True when two optional ranges are both absent or have equal bounds. */
function sameRange(first: Range | undefined, second: Range | undefined): boolean {
  return first === undefined || second === undefined ? first === second : first.min === second.min && first.max === second.max;
}

/**
 * One read-only item row, laid out like Today's (name, details, dose) but
 * with no button, link or timer apart from the sibling "Show me" button for
 * exercises that have an animation (`programId` says which program's). `changedText` is the "Changed: ..." line for
 * an item that differs from the previous week, or undefined.
 */
function renderPlanItemRow(programId: string, item: ItemView, phase: string, changedText: string | undefined): HTMLElement {
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

  // The same sibling "Show me" button as Today's rows; the plan row itself stays read-only.
  const showMeButton = renderShowMeButton(programId, item, "item-start item-show-me");
  if (showMeButton !== undefined) {
    row.append(showMeButton);
  }
  return row;
}
