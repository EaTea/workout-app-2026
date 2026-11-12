import type { DayNumber, Program } from "../program/model";
import type { LoggedSession, LoggedSet, WorkoutLog } from "./model";
import { sessionDates } from "./operations";
import { setDay } from "./setDay";

/**
 * Data behind the History "Progress" charts: for one exercise done in one
 * type of block (e.g. pull-ups in main strength, or pull-ups in a mini-dose),
 * the best set of each session placed on the program's week axis. Block types
 * are never mixed in one series, because their reps and loads are not comparable.
 *
 *   WorkoutLog + Program
 *        │ chartableExercises ─▶ [{ exerciseId, blockType, label }] (the picker)
 *        │ progressSeries(exerciseId, blockType) ─▶ ProgressPoint[] (the charts)
 *        └ deloadWeeks ─▶ [4, 8]                                    (shaded bands)
 *
 * Only work done in a mainStrength, miniDose, explosive or strength block counts, so
 * warm-up, core and finisher sets of the same exercise never mix in. The log
 * stores a block position, not a block type, so the type is resolved from the
 * program by the set's effective day (`setDay`) and its block position, exactly
 * as `lastTime.ts` does. Anything that cannot be resolved is left out rather
 * than guessed.
 */

/**
 * Block types whose sets are charted. "strength" is Steady Strength's
 * rep-based work (sit-to-stand and so on); its "isometric" holds log no reps,
 * so they have nothing to chart and are left out.
 */
export const CHARTED_BLOCK_TYPES: readonly string[] = ["mainStrength", "miniDose", "explosive", "strength"];

/** Human labels for the charted block types, used in the picker ("Pull-ups — Main strength"). */
const BLOCK_TYPE_LABELS: Record<string, string> = {
  mainStrength: "Main strength",
  miniDose: "Mini-dose",
  explosive: "Explosive",
  strength: "Strength",
};

/** The label for a block type, falling back to the raw type for one the map does not know. */
export function blockTypeLabel(blockType: string): string {
  return BLOCK_TYPE_LABELS[blockType] ?? blockType;
}

/** An exercise in one block type, offered in the Progress picker. */
export interface ChartableExercise {
  exerciseId: string;

  /** Block type the sets were done in ("mainStrength", "miniDose", "explosive" or "strength"). */
  blockType: string;

  /** Unique picker value for the exercise and block type together. */
  key: string;

  /** Display name from the program library (the id itself when the library no longer has it). */
  name: string;

  /** Picker text: the name and block type label, e.g. "Pull-ups — Main strength". */
  label: string;

  /** Latest session date (YYYY-MM-DD) with a charted set of the exercise; used to choose the default. */
  lastLoggedDate: string;
}

/** One session's best numbers for one exercise in one block type. */
export interface ProgressPoint {
  /** Program date "YYYY-MM-DD" of the session. */
  date: string;

  /** Program week (1-based) stored with the session. */
  week: number;

  /** Program day (1-7) stored with the session, when known; used to spread same-week points along the week. */
  day?: DayNumber;

  /** Most reps in any set of the exercise in that block type that day. */
  bestReps: number;

  /** Heaviest load in kg in any such set that day (may come from a different set than the best reps); undefined when no load was logged. */
  heaviestKg?: number;
}

/**
 * The type of block a logged set was done in, resolved from the program by the
 * set's effective day (`setDay`, as `lastTime.ts` does). Undefined when it cannot be
 * resolved: no day on the set or session, or the program no longer has the day, block or exercise.
 */
function blockTypeOfLoggedSet(program: Program, session: LoggedSession, set: LoggedSet): string | undefined {
  const day = setDay(session, set);
  if (day === undefined) return undefined;

  const block = program.days[day]?.blocks[set.blockPosition - 1];
  const isExerciseInBlock = block?.items.some((item) => item.exerciseId === set.exerciseId) ?? false;
  return isExerciseInBlock ? block?.type : undefined;
}

/** The charted block type a set was done in, or undefined when it is not in a charted block. Shared by the picker list and the series. */
function chartedBlockTypeOfSet(program: Program, session: LoggedSession, set: LoggedSet): string | undefined {
  const blockType = blockTypeOfLoggedSet(program, session, set);
  return blockType !== undefined && CHARTED_BLOCK_TYPES.includes(blockType) ? blockType : undefined;
}

/** The picker key for an exercise in a block type; the one place the two are joined. */
export function chartKey(exerciseId: string, blockType: string): string {
  return `${exerciseId}|${blockType}`;
}

/**
 * Exercise and block type combinations logged at least once in a charted
 * block, sorted by name then block type, for the Progress picker. Called by the History screen on every redraw, so edits and
 * deletes keep the picker current.
 */
export function chartableExercises(log: WorkoutLog, program: Program): ChartableExercise[] {
  const combinations = new Map<string, { exerciseId: string; blockType: string; lastLoggedDate: string }>();

  // Dates are ISO strings, so plain comparison is chronological.
  for (const date of sessionDates(log)) {
    const session = log.sessions[date];
    if (session === undefined) continue;

    for (const set of session.sets) {
      const blockType = chartedBlockTypeOfSet(program, session, set);
      if (blockType === undefined) continue;

      const key = chartKey(set.exerciseId, blockType);
      const previous = combinations.get(key);
      if (previous === undefined || date > previous.lastLoggedDate) {
        combinations.set(key, { exerciseId: set.exerciseId, blockType, lastLoggedDate: date });
      }
    }
  }

  const exercises = [...combinations].map(([key, combination]) => {
    const name = program.exercises[combination.exerciseId]?.name ?? combination.exerciseId;
    return { ...combination, key, name, label: `${name} — ${blockTypeLabel(combination.blockType)}` };
  });
  return exercises.sort((first, second) => first.name.localeCompare(second.name) || first.blockType.localeCompare(second.blockType));
}

/**
 * The best-per-session series for one exercise in one block type, oldest session first. A session
 * is skipped when it has no stored program week, a week outside the program,
 * or no set of that block type with reps. Used by the chart view and its table.
 */
export function progressSeries(log: WorkoutLog, program: Program, exerciseId: string, blockType: string): ProgressPoint[] {
  const points: ProgressPoint[] = [];

  for (const date of sessionDates(log).slice().sort()) {
    const session = log.sessions[date];
    if (session === undefined) continue;
    if (session.programWeek === undefined || session.programWeek < 1 || session.programWeek > program.lengthWeeks) continue;

    const chartedSets = session.sets.filter((set) => set.exerciseId === exerciseId && chartedBlockTypeOfSet(program, session, set) === blockType);
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
