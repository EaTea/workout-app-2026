import type { DayNumber, Program } from "../program/model";
import type { LoggedSession, LoggedSet, WorkoutLog } from "./model";
import { sessionDates } from "./operations";

/**
 * Data behind the History "Progress" charts: for one strength exercise, the
 * best set of each session placed on the program's week axis.
 *
 *   WorkoutLog + Program
 *        │ chartableExercises ─▶ [{ exerciseId, name }]            (the picker)
 *        │ progressSeries(exerciseId) ─▶ ProgressPoint[]           (the charts)
 *        └ deloadWeeks ─▶ [4, 8]                                    (shaded bands)
 *
 * Only work done in a mainStrength, miniDose or explosive block counts, so
 * warm-up, core and finisher sets of the same exercise never mix in. The log
 * stores a block position, not a block type, so the type is resolved from the
 * program by the session's stored day and the set's block position, exactly
 * as `lastTime.ts` does. Anything that cannot be resolved is left out rather
 * than guessed.
 */

/** Block types whose sets are charted. */
export const CHARTED_BLOCK_TYPES: readonly string[] = ["mainStrength", "miniDose", "explosive"];

/** An exercise offered in the Progress picker. */
export interface ChartableExercise {
  exerciseId: string;

  /** Display name from the program library (the id itself when the library no longer has it). */
  name: string;

  /** Latest session date (YYYY-MM-DD) with a charted set of the exercise; used to choose the default. */
  lastLoggedDate: string;
}

/** One session's best numbers for one exercise. */
export interface ProgressPoint {
  /** Program date "YYYY-MM-DD" of the session. */
  date: string;

  /** Program week (1-based) stored with the session. */
  week: number;

  /** Program day (1-7) stored with the session, when known; used to spread same-week points along the week. */
  day?: DayNumber;

  /** Most reps in any charted set of the exercise that day. */
  bestReps: number;

  /** Heaviest load in kg in any charted set that day; undefined when no load was logged. */
  heaviestKg?: number;
}

/**
 * The type of block a logged set was done in, resolved from the program by the
 * session's stored day (as `lastTime.ts` does). Undefined when it cannot be
 * resolved: no stored day, or the program no longer has the day, block or exercise.
 */
function blockTypeOfLoggedSet(program: Program, session: LoggedSession, set: LoggedSet): string | undefined {
  if (session.day === undefined) return undefined;

  const block = program.days[session.day]?.blocks[set.blockPosition - 1];
  const isExerciseInBlock = block?.items.some((item) => item.exerciseId === set.exerciseId) ?? false;
  return isExerciseInBlock ? block?.type : undefined;
}

/** True when the set was done in a block type that is charted. Shared by the picker list and the series. */
function isChartedSet(program: Program, session: LoggedSession, set: LoggedSet): boolean {
  const blockType = blockTypeOfLoggedSet(program, session, set);
  return blockType !== undefined && CHARTED_BLOCK_TYPES.includes(blockType);
}

/**
 * Exercises logged at least once in a charted block, sorted by name, for the
 * Progress picker. Called by the History screen on every redraw, so edits and
 * deletes keep the picker current.
 */
export function chartableExercises(log: WorkoutLog, program: Program): ChartableExercise[] {
  const lastDateByExercise = new Map<string, string>();

  // Dates are ISO strings, so plain comparison is chronological.
  for (const date of sessionDates(log)) {
    const session = log.sessions[date];
    if (session === undefined) continue;

    for (const set of session.sets) {
      if (!isChartedSet(program, session, set)) continue;
      const previous = lastDateByExercise.get(set.exerciseId);
      if (previous === undefined || date > previous) lastDateByExercise.set(set.exerciseId, date);
    }
  }

  const exercises = [...lastDateByExercise].map(([exerciseId, lastLoggedDate]) => ({
    exerciseId,
    name: program.exercises[exerciseId]?.name ?? exerciseId,
    lastLoggedDate,
  }));
  return exercises.sort((first, second) => first.name.localeCompare(second.name));
}

/**
 * The best-per-session series for one exercise, oldest session first. A session
 * is skipped when it has no stored program week, a week outside the program,
 * or no charted set with reps. Used by the chart view and its table.
 */
export function progressSeries(log: WorkoutLog, program: Program, exerciseId: string): ProgressPoint[] {
  const points: ProgressPoint[] = [];

  for (const date of sessionDates(log).slice().sort()) {
    const session = log.sessions[date];
    if (session === undefined) continue;
    if (session.programWeek === undefined || session.programWeek < 1 || session.programWeek > program.lengthWeeks) continue;

    const chartedSets = session.sets.filter((set) => set.exerciseId === exerciseId && isChartedSet(program, session, set));
    const repsLogged = chartedSets.flatMap((set) => (set.reps === undefined ? [] : [set.reps]));
    const loadsLogged = chartedSets.flatMap((set) => (set.loadKg === undefined || set.loadKg <= 0 ? [] : [set.loadKg]));
    if (repsLogged.length === 0) continue;

    points.push({
      date,
      week: session.programWeek,
      day: session.day,
      bestReps: Math.max(...repsLogged),
      heaviestKg: loadsLogged.length > 0 ? Math.max(...loadsLogged) : undefined,
    });
  }
  return points;
}

/**
 * Program weeks to shade as deloads: every week of a progression phase whose
 * name starts with "Deload" ("Deload", "Deload + retest"), i.e. 4 and 8 in the
 * shipped program. The model has no deload flag on phases, so the name is the source.
 */
export function deloadWeeks(program: Program): number[] {
  const weeks = program.progression.filter((phase) => /^deload/i.test(phase.phase)).flatMap((phase) => phase.weeks);
  return [...new Set(weeks)].sort((first, second) => first - second);
}
