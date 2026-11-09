import type { Program } from "../program/model";
import type { WorkoutLog } from "../log/model";
import { chartableExercises, deloadWeeks, progressSeries, type ChartableExercise, type ProgressPoint } from "../log/progress";
import { DAYS_PER_WEEK } from "../program/model";
import { element } from "./dom";
import { formatShortDate } from "./format";
import "./progressChart.css";

/**
 * The "Progress" section at the top of History: an exercise picker, a line
 * chart of best reps per session over the program weeks (and a second chart
 * of heaviest load when any load was logged), and a small table with the same
 * numbers, which is the accessible source of truth.
 *
 *   renderProgressSection(program, log)
 *     ┌ Progress ─────────────────────────┐
 *     │ [ Pull-ups                     ▾ ]│  native <select>, remembered per visit
 *     │  reps                              │
 *     │  8┤        ·deload·                │  inline SVG, role="img" + aria-label
 *     │  4┤  ●──●──●  ░░░                  │
 *     │  0┴──W1─W2─W3─W4─W5─W6─W7─W8       │
 *     │ Week  Date   Best reps  Heaviest kg│  table
 *     └────────────────────────────────────┘
 *
 * Data comes from `log/progress.ts`; this file only draws. Text is set through
 * `textContent` / `setAttribute` (see `dom.ts`), never innerHTML.
 */

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

/** Chart size in SVG user units; the SVG scales to the card width through its viewBox. */
const CHART_WIDTH = 340;
const CHART_HEIGHT = 190;
const MARGIN = { left: 34, right: 8, top: 14, bottom: 26 };

/** The exercise picked in the picker, kept in memory for the page visit (not stored). */
let rememberedExerciseId: string | undefined;

/** A vertical axis scale with evenly spaced "nice" gridlines starting at 0. */
export interface NiceAxis {
  /** Top of the axis, a multiple of the step and at least the data maximum. */
  max: number;

  /** Gridline values from 0 to `max`, inclusive (3 or 4 intervals for typical data). */
  ticks: number[];
}

/**
 * Picks an axis from 0 to a round maximum with at most 4 intervals, e.g. a
 * data maximum of 7 gives 0, 2, 4, 6, 8 and 12 gives 0, 5, 10, 15. Used for
 * both charts' vertical axes.
 */
export function niceAxis(dataMax: number): NiceAxis {
  const candidates = [1, 2, 5];

  for (let magnitude = 1; ; magnitude *= 10) {
    for (const candidate of candidates) {
      const step = candidate * magnitude;
      const intervals = Math.max(1, Math.ceil(dataMax / step));
      if (intervals <= 4) {
        // Steps of 1, 2 or 5 times a power of ten, so labels are round whole numbers.
        const ticks = Array.from({ length: intervals + 1 }, (_, index) => index * step);
        return { max: intervals * step, ticks };
      }
    }
  }
}

/**
 * One sentence for the SVG's aria-label, e.g. "Pull-ups best reps rose from 5
 * in week 1 to 7 in week 3". `quantity` is "best reps" or "heaviest load";
 * `unit` is "" or " kg". Needs at least one value.
 */
export function describeTrend(name: string, quantity: string, unit: string, values: { week: number; value: number }[]): string {
  const first = values[0];
  const last = values[values.length - 1];
  if (first === undefined || last === undefined) return `${name} ${quantity}: nothing logged`;

  if (values.length === 1) return `${name} ${quantity} was ${first.value}${unit} in week ${first.week}`;

  const verb = last.value > first.value ? "rose" : last.value < first.value ? "fell" : "stayed";
  if (verb === "stayed") return `${name} ${quantity} stayed at ${first.value}${unit} from week ${first.week} to week ${last.week}`;
  return `${name} ${quantity} ${verb} from ${first.value}${unit} in week ${first.week} to ${last.value}${unit} in week ${last.week}`;
}

/**
 * Where on the exercise to start: the remembered pick if it is still
 * chartable, else the most recently logged exercise (ties: first by name).
 * Undefined when nothing is chartable.
 */
export function chooseExercise(exercises: ChartableExercise[], rememberedId: string | undefined): ChartableExercise | undefined {
  const remembered = exercises.find((exercise) => exercise.exerciseId === rememberedId);
  if (remembered !== undefined) return remembered;

  let mostRecent: ChartableExercise | undefined;
  for (const exercise of exercises) {
    if (mostRecent === undefined || exercise.lastLoggedDate > mostRecent.lastLoggedDate) mostRecent = exercise;
  }
  return mostRecent;
}

/**
 * Builds the Progress card for History, or a short hint when nothing is
 * chartable yet. History calls it on every redraw with its current log, so
 * edits and deletes are reflected; the picker choice survives redraws via
 * module memory.
 */
export function renderProgressSection(program: Program, log: WorkoutLog): HTMLElement {
  const card = element("section", "card progress-card");
  card.setAttribute("aria-labelledby", "progress-heading");
  const heading = element("h2", "card-title", "Progress");
  heading.id = "progress-heading";
  card.append(heading);

  const exercises = chartableExercises(log, program);
  const chosenOrNothing = chooseExercise(exercises, rememberedExerciseId);
  if (chosenOrNothing === undefined) {
    card.append(element("p", "history-empty", "Log a strength exercise to see progress here."));
    return card;
  }
  const chosen: ChartableExercise = chosenOrNothing;

  const label = element("label", "progress-picker-label", "Exercise");
  const picker = element("select", "progress-picker");
  picker.id = "progress-exercise";
  label.htmlFor = picker.id;
  for (const exercise of exercises) {
    const option = element("option", undefined, exercise.name);
    option.value = exercise.exerciseId;
    option.selected = exercise.exerciseId === chosen.exerciseId;
    picker.append(option);
  }

  const details = element("div", "progress-details");
  /** Redraws the charts and table for the picked exercise. */
  function showExercise(exerciseId: string): void {
    const exercise = exercises.find((candidate) => candidate.exerciseId === exerciseId) ?? chosen;
    details.replaceChildren(...renderExerciseProgress(program, exercise, progressSeries(log, program, exerciseId)));
  }
  picker.addEventListener("change", () => {
    rememberedExerciseId = picker.value;
    showExercise(picker.value);
  });

  card.append(label, picker, details);
  showExercise(chosen.exerciseId);
  return card;
}

/** The charts and table for one exercise's series, or a note when no session has a stored week. */
function renderExerciseProgress(program: Program, exercise: ChartableExercise, points: ProgressPoint[]): Element[] {
  if (points.length === 0) {
    return [element("p", "history-empty", `No ${exercise.name} sessions with a program week to chart yet.`)];
  }

  const deloads = deloadWeeks(program);
  const repsValues = points.map((point) => ({ week: point.week, day: point.day, value: point.bestReps }));
  const loadValues = points.flatMap((point) => (point.heaviestKg === undefined ? [] : [{ week: point.week, day: point.day, value: point.heaviestKg }]));

  const elements: Element[] = [
    element("h3", "progress-chart-title", "Best reps per session"),
    renderLineChart(repsValues, program.lengthWeeks, deloads, describeTrend(exercise.name, "best reps", "", repsValues)),
  ];
  if (loadValues.length > 0) {
    elements.push(
      element("h3", "progress-chart-title", "Heaviest load per session (kg)"),
      renderLineChart(loadValues, program.lengthWeeks, deloads, describeTrend(exercise.name, "heaviest load", " kg", loadValues)),
    );
  }
  elements.push(renderProgressTable(exercise.name, points));
  return elements;
}

/** Creates an SVG element with the given attributes (all values are stringified). */
function svgElement<Tag extends keyof SVGElementTagNameMap>(tagName: Tag, attributes: Record<string, string | number>, className?: string, text?: string): SVGElementTagNameMap[Tag] {
  const created = document.createElementNS(SVG_NAMESPACE, tagName);
  for (const [name, value] of Object.entries(attributes)) created.setAttribute(name, String(value));
  if (className !== undefined) created.setAttribute("class", className);
  if (text !== undefined) created.textContent = text;
  return created;
}

/**
 * Draws one line chart: weeks 1..`weekCount` across, 0..nice max up, deload
 * weeks shaded and labelled, a polyline and a marker per value. A value sits
 * inside its week's band, shifted by its day (so two sessions in one week do
 * not overlap). The SVG is `role="img"` with `ariaSummary`; the table below
 * carries the exact numbers.
 */
function renderLineChart(values: { week: number; day?: number; value: number }[], weekCount: number, deloads: number[], ariaSummary: string): SVGSVGElement {
  const plotWidth = CHART_WIDTH - MARGIN.left - MARGIN.right;
  const plotHeight = CHART_HEIGHT - MARGIN.top - MARGIN.bottom;
  const weekWidth = plotWidth / weekCount;
  const axis = niceAxis(Math.max(...values.map((entry) => entry.value)));

  const xOfWeekStart = (week: number): number => MARGIN.left + (week - 1) * weekWidth;
  const yOfValue = (value: number): number => MARGIN.top + plotHeight * (1 - value / axis.max);
  /** Day 1 sits near the left of the week band and day 7 near the right; unknown day is the middle. */
  const xOfValue = (entry: { week: number; day?: number }): number =>
    xOfWeekStart(entry.week) + weekWidth * (entry.day === undefined ? 0.5 : (Math.min(entry.day, DAYS_PER_WEEK) - 0.5) / DAYS_PER_WEEK);

  const svg = svgElement("svg", { viewBox: `0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`, role: "img", "aria-label": ariaSummary }, "progress-chart");

  // Deload bands go first so gridlines and the line draw over them.
  for (const week of deloads.filter((candidate) => candidate >= 1 && candidate <= weekCount)) {
    svg.append(
      svgElement("rect", { x: xOfWeekStart(week), y: MARGIN.top, width: weekWidth, height: plotHeight }, "progress-chart-deload-band"),
      svgElement("text", { x: xOfWeekStart(week) + weekWidth / 2, y: MARGIN.top + 10 }, "progress-chart-deload-label", "Deload"),
    );
  }

  for (const tick of axis.ticks) {
    svg.append(
      svgElement("line", { x1: MARGIN.left, x2: CHART_WIDTH - MARGIN.right, y1: yOfValue(tick), y2: yOfValue(tick) }, "progress-chart-gridline"),
      svgElement("text", { x: MARGIN.left - 6, y: yOfValue(tick) + 4, "text-anchor": "end" }, "progress-chart-axis-label", String(tick)),
    );
  }

  for (let week = 1; week <= weekCount; week += 1) {
    svg.append(svgElement("text", { x: xOfWeekStart(week) + weekWidth / 2, y: CHART_HEIGHT - 8, "text-anchor": "middle" }, "progress-chart-axis-label", `W${week}`));
  }

  const linePoints = values.map((entry) => `${xOfValue(entry).toFixed(1)},${yOfValue(entry.value).toFixed(1)}`).join(" ");
  svg.append(svgElement("polyline", { points: linePoints }, "progress-chart-line"));
  for (const entry of values) {
    svg.append(svgElement("circle", { cx: xOfValue(entry).toFixed(1), cy: yOfValue(entry.value).toFixed(1), r: 4.5 }, "progress-chart-point"));
  }
  return svg;
}

/** The compact table of the same numbers (Week, Date, Best reps, Heaviest kg), one row per session. */
function renderProgressTable(name: string, points: ProgressPoint[]): HTMLTableElement {
  const table = element("table", "progress-table");
  table.append(element("caption", undefined, `${name}: best set per session`));

  const headerRow = element("tr");
  for (const title of ["Week", "Date", "Best reps", "Heaviest kg"]) {
    const cell = element("th", undefined, title);
    cell.scope = "col";
    headerRow.append(cell);
  }
  const head = element("thead");
  head.append(headerRow);
  table.append(head);

  const body = element("tbody");
  for (const point of points) {
    const row = element("tr");
    row.append(
      element("td", undefined, `W${point.week}`),
      element("td", undefined, formatShortDate(point.date)),
      element("td", undefined, String(point.bestReps)),
      element("td", undefined, point.heaviestKg === undefined ? "–" : String(point.heaviestKg)),
    );
    body.append(row);
  }
  table.append(body);
  return table;
}
