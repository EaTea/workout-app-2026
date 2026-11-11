/**
 * Program overview view model: everything the Overview (welcome) screen shows,
 * worked out from the internal `Program` and the current `ProgramStatus`.
 *
 *   Program ─┐
 *            ├─▶ buildProgramOverview ─▶ ProgramOverview ─▶ src/ui/overview.ts (renders it)
 *   Status  ─┘
 *
 * Pure and DOM-free, and it reads only the internal model (no wire types), so
 * nothing about the shipped program is hard-coded here. Session-block ids in
 * `sessionOrder` are passed through as-is; the UI turns them into labels.
 */

import type { Day, DayNumber, Program } from "./model";
import { DAYS_PER_WEEK } from "./model";
import type { ProgramStatus } from "./calendar";

/** Block types whose first exercise is shown as a day's "key exercise". */
const KEY_EXERCISE_BLOCK_TYPES = ["explosive", "mainStrength"];

/** One phase of the progression, as the phase strip shows it. */
export interface PhaseOverview {
  name: string;
  /** The program weeks (1-based) this phase covers, in order. */
  weeks: number[];
  firstWeek: number;
  lastWeek: number;
  /** The phase's first change line, or "" when it lists none. */
  summary: string;
  /** True when the program is active and the current week falls in this phase. */
  isCurrent: boolean;
}

/** A training day's row in "a typical week". */
export interface TrainingDayOverview {
  kind: "training";
  dayNumber: DayNumber;
  focus: string;
  targetMinutes: number;
  /** Names of the first explosive and the first main-strength exercise, in that order, when present. */
  keyExercises: string[];
}

/** A rest day's row (the program's rest day, or any day with no entry in program.days). */
export interface RestDayOverview {
  kind: "rest";
  dayNumber: DayNumber;
}

/** One row of "a typical week". */
export type DayOverview = TrainingDayOverview | RestDayOverview;

/** The single primary call to action, by where the program stands. */
export type CallToAction =
  | { kind: "startToday"; label: string; firstDay: { dayNumber: DayNumber; focus: string } }
  | { kind: "previewFirstDay"; label: string; startsOn: string }
  | { kind: "goToToday"; label: string; week: number; dayNumber: DayNumber }
  | { kind: "setNewStartDate"; label: string };

/** The whole Overview screen's content. */
export interface ProgramOverview {
  name: string;
  goal: string;
  lengthWeeks: number;
  trainingDaysPerWeek: number;
  /** Sum of the training days' target minutes. */
  weeklyMinutes: number;
  phases: PhaseOverview[];
  /** The current program week while the program is active; undefined otherwise. */
  currentWeek?: number;
  /** Rows for day 1 to 7, in order. */
  days: DayOverview[];
  /** The program's session block ids in order, unlabelled (the UI maps them to labels). */
  sessionOrder: string[];
  callToAction: CallToAction;
}

/**
 * Builds the row for one day number: a training row if program.days has it
 * (and it is not the rest day), otherwise a rest row. Called by
 * `buildProgramOverview` for each of day 1 to 7.
 */
function buildDayOverview(program: Program, dayNumber: DayNumber): DayOverview {
  const day: Day | undefined = program.days[dayNumber];

  if (dayNumber === program.restDay || day === undefined) {
    return { kind: "rest", dayNumber };
  }

  // The first item of each key block type, in the order of KEY_EXERCISE_BLOCK_TYPES.
  const keyExercises: string[] = [];
  for (const blockType of KEY_EXERCISE_BLOCK_TYPES) {
    const firstItem = day.blocks.find((block) => block.type === blockType)?.items[0];
    if (firstItem !== undefined) {
      keyExercises.push(firstItem.exercise.name);
    }
  }

  return { kind: "training", dayNumber, focus: day.focus, targetMinutes: day.targetMinutes, keyExercises };
}

/**
 * Builds the call to action for the current status. For a fresh install it
 * names the first training day so one tap starts the program; otherwise it
 * previews, resumes or restarts. Called by `buildProgramOverview`.
 */
function buildCallToAction(status: ProgramStatus, days: DayOverview[]): CallToAction {
  switch (status.kind) {
    case "noStartDate": {
      // Days are in ascending order, so the first training row is the lowest-numbered one.
      const firstTrainingDay = days.find((day): day is TrainingDayOverview => day.kind === "training");
      const firstDay = firstTrainingDay
        ? { dayNumber: firstTrainingDay.dayNumber, focus: firstTrainingDay.focus }
        : { dayNumber: 1, focus: "" };
      return { kind: "startToday", label: `Start Day ${firstDay.dayNumber}: ${firstDay.focus}`, firstDay };
    }

    case "notStarted":
      return { kind: "previewFirstDay", label: "Preview Day 1", startsOn: status.startsOn };

    case "active": {
      const today = days.find((day) => day.dayNumber === status.dayNumber);
      const where = today?.kind === "rest" ? "Rest day" : `Week ${status.week} · Day ${status.dayNumber}`;
      return { kind: "goToToday", label: `Go to today: ${where}`, week: status.week, dayNumber: status.dayNumber };
    }

    case "complete":
      return { kind: "setNewStartDate", label: "Set a new start date" };
  }
}

/**
 * Builds the Overview screen's view model from the program and where today
 * falls in it. Called by the Overview screen (src/ui/overview.ts) on each
 * render; has no side effects.
 */
export function buildProgramOverview(program: Program, status: ProgramStatus): ProgramOverview {
  const currentWeek = status.kind === "active" ? status.week : undefined;

  const phases: PhaseOverview[] = program.progression.map((phase) => ({
    name: phase.phase,
    weeks: [...phase.weeks],
    firstWeek: Math.min(...phase.weeks),
    lastWeek: Math.max(...phase.weeks),
    summary: phase.changes[0] ?? "",
    isCurrent: currentWeek !== undefined && phase.weeks.includes(currentWeek),
  }));

  const days: DayOverview[] = [];
  for (let dayNumber = 1; dayNumber <= DAYS_PER_WEEK; dayNumber++) {
    days.push(buildDayOverview(program, dayNumber));
  }

  const trainingDays = days.filter((day): day is TrainingDayOverview => day.kind === "training");

  return {
    name: program.name,
    goal: program.goal,
    lengthWeeks: program.lengthWeeks,
    trainingDaysPerWeek: trainingDays.length,
    weeklyMinutes: trainingDays.reduce((total, day) => total + day.targetMinutes, 0),
    phases,
    currentWeek,
    days,
    sessionOrder: [...program.sessionOrder],
    callToAction: buildCallToAction(status, days),
  };
}
