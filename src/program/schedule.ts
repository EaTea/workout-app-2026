import type { Block, BlockItem, Exercise, Format, Program, ProgressionPhase, Range, Reps, TimerAdjustments } from "./model";
import { DAYS_PER_WEEK, MAX_INTERVAL_WORK_SECONDS, MAX_REST_SECONDS, MIN_TIMER_SECONDS } from "./model";
import { applyRotationToBlocks } from "./rotation";
import { addDaysToDate, programStatus } from "./calendar";
import type { TrainingSettings } from "../settings/model";
import { maxInEffectOn } from "../settings/maxHistory";

/**
 * Turns the program plus the athlete's settings into the concrete session
 * for one calendar date. Pure functions only: no UI, no storage.
 *
 *   Program + TrainingSettings + "YYYY-MM-DD"
 *        │  calendar.programStatus  -> week / day number / not started / complete
 *        │  phase lookup            -> Base, Deload, ...
 *        ▼
 *   SessionView  (rest day, or blocks of items with final numbers)
 *
 * The UI renders a `SessionView` and never does arithmetic of its own.
 */

// ---------------------------------------------------------------------------
// View types (what the UI receives)
// ---------------------------------------------------------------------------

/**
 * A rep target ready to display.
 *  - fixed / range: final numbers (after max-percent and weekly increase)
 *  - text: free text from the program, shown as written
 *  - needsMax: the target depends on a tested max that Ed has not entered;
 *    the UI should ask for it (`percentMin`/`percentMax` are fractions, 0.4 = 40%)
 */
export type RepTarget =
  | { kind: "fixed"; count: number; basis?: MaxBasis }
  | { kind: "range"; min: number; max: number; basis?: MaxBasis }
  | { kind: "text"; text: string }
  | { kind: "needsMax"; exerciseId: string; percentMin: number; percentMax: number };

/**
 * Explains where a percent-of-max target came from, so the UI can show
 * "40% of max 12 · +1 this week" without doing any arithmetic itself.
 * Present only on targets derived from a tested max.
 *  - percentMin / percentMax: fractions (0.4 = 40%)
 *  - max: the athlete's tested max the percentage was applied to
 *  - weeklyIncrease: reps already added to the figure this week
 *    (0 in week 1 of a phase and for items that don't progress). In a deload
 *    it is the increase of the previous week, held rather than dropped.
 *  - heldForDeload: true when this is a deload week and `weeklyIncrease`
 *    is last week's figure carried over (the UI says so).
 *  - usesRetestedMax: true in a retest week (week 8) once the athlete has
 *    saved a max for this exercise during that week: the target is
 *    floor(max x pct) from the retested max, with no increase and no hold.
 *    Set only on EMOM items (those with a weeklyIncrease), not mini-doses.
 *  - awaitingRetest: true in a retest week while no max has been saved for
 *    this exercise during the week. The previous week's increase is held
 *    (`heldForDeload` is also true) and the UI asks the athlete to save a
 *    retested max.
 */
export interface MaxBasis {
  percentMin: number;
  percentMax: number;
  max: number;
  weeklyIncrease: number;
  heldForDeload: boolean;
  usesRetestedMax: boolean;
  awaitingRetest: boolean;
}

/**
 * What a week's items need to know to resolve their targets; computed once
 * per session in `buildSession`.
 *  - offset: weekly increases to add (see `weeklyIncreaseOffsetForWeek`)
 *  - retestHeldOffset: in a retest week, the previous week's offset, which
 *    EMOMs hold until a retested max is saved (0 outside retest weeks)
 *  - timerAdjustments: the phase's timer changes, if it has any
 *  - weekStartDate: first calendar day of the program week; a max saved
 *    from that day to the week's last day (Day 7) counts as retested
 *  - heldEmomDates: in a retest week, per exercise id, the date of the last
 *    day of the previous week whose session has that exercise's EMOM. The
 *    held figure uses the max in effect on that day (what that week showed).
 *    Empty outside retest weeks.
 */
interface WeekContext {
  isDeload: boolean;
  isRetest: boolean;
  offset: number;
  retestHeldOffset: number;
  timerAdjustments?: TimerAdjustments;
  weekStartDate: string;
  heldEmomDates: Record<string, string>;
}

/** The increase handling chosen for one item; carried into `resolveReps`. */
interface IncreaseChoice {
  increase: number;
  heldForDeload: boolean;
  usesRetestedMax: boolean;
  awaitingRetest: boolean;
  /** Max to use instead of the current one (the week 8 hold); undefined = the current max. */
  heldMax?: number;
}

/** One set of an item, with its computed rep target. */
export interface SetView {
  target?: RepTarget;
  load?: string;
}

/** One exercise in a session, with all numbers already computed for the date. */
export interface ItemView {
  exercise: Exercise;
  format: Format;
  /** Sets to perform (already halved in a deload); empty for time-driven items. */
  sets: SetView[];
  /** Item-level target for items without sets (warm-ups, EMOM). */
  target?: RepTarget;
  restSec?: Range;
  /** EMOM minutes (halved in a deload). */
  minutes?: number;
  /** Interval rounds; a ranged program value stays a range outside a deload. */
  rounds?: Range;
  /** Work time per round, already moved by the phase's `intervalWorkSec` adjustment. */
  workSec?: Range;
  /** The seconds added to `workSec` by the phase (e.g. 5 in power endurance); absent when none were. */
  workSecAdjustment?: number;
  /**
   * True for a `sameEveryWeek` item in a week where other items change (a
   * deload week, or a phase with timer adjustments), so Today can say it
   * stays the same. Absent otherwise.
   */
  showsSameEveryWeekNote?: boolean;
  durationSec?: number;
  perSide: boolean;
  optional: boolean;
  load?: string;
  note?: string;
  tempo?: string;
  /**
   * The program's descriptive progression rule (e.g. "+1 rep per minute"),
   * for display as a rule only (the exercise sheet). It is free text and is
   * never parsed: the schedule treats its mere presence as "this item adds 1
   * rep per week" (see `buildItem`). The amount actually added this week is
   * on the target's `basis.weeklyIncrease`.
   */
  weeklyIncrease?: string;
  /**
   * Set on a warm-up item in a rotated week (see rotation.ts): show
   * `displayName` instead of the exercise's name, with "Rotated in for
   * <originalName>". `exercise` stays the original so logging keeps its id.
   */
  rotatedIn?: { displayName: string; originalName: string };
  /**
   * The item's "No equipment" swap as it would be done this week: the same
   * week, deload halving and timer changes applied to the swap's exercise and
   * dose (see `applyNoEquipmentSwap`). Present only on items whose program
   * entry has a swap, and dropped from a warm-up the rotation replaces. The exercise sheet shows it as "No equipment: <swap>,
   * <this week's dose>"; Today ignores it until PR 19 adds the tick that
   * switches a row over to it.
   */
  noEquipment?: ItemView;
  /**
   * Set when this view is a ticked "No equipment" swap (see
   * `applyNoEquipmentChoices` in noEquipment.ts): the original item's
   * exercise, so Today can say "Instead of <original name>" and show the tick
   * ticked. Absent on every normal view.
   */
  swappedFrom?: Exercise;
}

/** One block of the session, in program order. */
export interface BlockView {
  /**
   * The block's 1-based position in the program day (`program.days[d].blocks`),
   * which is the `blockPosition` logged sets are keyed by. It is stored rather
   * than derived from the index in `SessionView.blocks` because a block with
   * no items this week is left out of the session, and the blocks after it
   * must keep their position so logging, History and "Last time" keep working.
   */
  position: number;
  type: string;
  format: Format;
  /** Superset rounds (not halved for warm-ups). */
  rounds?: Range;
  minutes?: number;
  /** Rest between pairs, already moved by the phase's `coreRestBetweenPairsSec` adjustment. */
  restSecBetweenPairs?: Range;
  /** The seconds added to `restSecBetweenPairs` by the phase (e.g. -15); absent when none were. */
  restAdjustment?: number;
  items: ItemView[];
}

/** What the Today screen should show for a date. */
export type SessionView =
  | { kind: "noStartDate" }
  | { kind: "notStarted"; startsOn: string }
  | { kind: "complete" }
  | { kind: "rest"; week: number; dayNumber: number; phase: string }
  | {
      kind: "training";
      week: number;
      /** Day of the program week, 1-7, counted from the start date. */
      dayNumber: number;
      phase: string;
      isDeload: boolean;
      focus: string;
      targetMinutes: number;
      blocks: BlockView[];
    };

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Builds the session for `date` ("YYYY-MM-DD", the caller's local today).
 * Called by the Today screen on every render; has no side effects.
 */
export function buildSession(program: Program, settings: TrainingSettings, date: string): SessionView {
  const status = programStatus(settings.startDate, program.lengthWeeks, date);

  if (status.kind !== "active") {
    return status;
  }

  const { week, dayNumber } = status;
  const phase = phaseForWeek(program, week);
  const isDeload = isDeloadPhase(phase);
  const isRetest = phase.retest;
  const day = program.days[dayNumber];

  if (!day) {
    return { kind: "rest", week, dayNumber, phase: phase.phase };
  }

  const weekContext: WeekContext = {
    isDeload,
    isRetest,
    offset: weeklyIncreaseOffsetForWeek(program, week),
    retestHeldOffset: isRetest && week > 1 ? weeklyIncreaseOffsetForWeek(program, week - 1) : 0,
    // Applied whenever the phase carries it, even if the phase were also a
    // deload (the shipped program only sets it on weeks 5-7, which are not).
    timerAdjustments: phase.timerAdjustments,
    // settings.startDate is non-null here: programStatus was "active".
    weekStartDate: addDaysToDate(settings.startDate as string, (week - 1) * DAYS_PER_WEEK),
    heldEmomDates: isRetest && week > 1 ? lastEmomDatesOfWeek(program, settings.startDate as string, week - 1) : {},
  };

  return {
    kind: "training",
    week,
    dayNumber,
    phase: phase.phase,
    isDeload,
    focus: day.focus,
    targetMinutes: day.targetMinutes,
    blocks: applyRotationToBlocks(buildBlocksForWeek(day.blocks, settings, weekContext, week), week, program.warmupRotation),
  };
}

/**
 * For each exercise that has an EMOM (an item with a `weeklyIncrease`) in any
 * training day, the calendar date of the LAST day of program week `week` whose
 * session contains it. Used for the retest week's hold: the held reps must
 * match what that last EMOM showed, i.e. the max in effect on that date.
 * `startDate` is the program's Day 1.
 */
function lastEmomDatesOfWeek(program: Program, startDate: string, week: number): Record<string, string> {
  const weekStartDate = addDaysToDate(startDate, (week - 1) * DAYS_PER_WEEK);
  const dates: Record<string, string> = {};

  // Days are visited in order, so a later day overwrites an earlier one.
  for (let dayNumber = 1; dayNumber <= DAYS_PER_WEEK; dayNumber++) {
    const day = program.days[dayNumber];
    if (day === undefined) {
      continue;
    }
    for (const block of day.blocks) {
      for (const item of block.items) {
        if (item.weeklyIncrease !== undefined) {
          dates[item.exerciseId] = addDaysToDate(weekStartDate, dayNumber - 1);
        }
      }
    }
  }
  return dates;
}

/** Finds the progression entry containing `week`; throws if the program has a gap. */
export function phaseForWeek(program: Program, week: number): ProgressionPhase {
  const phase = program.progression.find((entry) => entry.weeks.includes(week));
  if (!phase) {
    throw new Error(`program.json: no progression phase covers week ${week}`);
  }
  return phase;
}

/**
 * How many weekly increases have accumulated by `week`.
 *  - normal week: the week's 0-based position within its phase
 *  - retest week: 0. This is the offset for a retested max: floor(max x pct)
 *    with no increase and no hold (W8). Until a max is saved in the week,
 *    EMOMs instead hold the previous week's offset (see `chooseIncrease`).
 *  - plain deload week: the previous week's EFFECTIVE offset, so the EMOM
 *    reps are held rather than dropped (W4 holds W3's). If the previous
 *    week is itself a plain deload, its held offset is used in turn, so
 *    consecutive deload weeks all hold the last normal week's figure. A
 *    deload right after a retest week therefore holds 0 (the retest week's
 *    effective offset).
 *  - a plain deload with no previous week (week 1): 0
 */
function weeklyIncreaseOffsetForWeek(program: Program, week: number): number {
  const phase = phaseForWeek(program, week);
  if (phase.retest) {
    return 0;
  }
  if (!isDeloadPhase(phase)) {
    return phase.weeks.indexOf(week);
  }

  if (week <= 1) {
    return 0;
  }
  return weeklyIncreaseOffsetForWeek(program, week - 1);
}

/**
 * Deload is detected from the phase name ("Deload", "Deload + retest") so
 * that the schedule follows the data rather than hard-coding weeks 4 and 8.
 */
function isDeloadPhase(phase: ProgressionPhase): boolean {
  return phase.phase.toLowerCase().startsWith("deload");
}

// ---------------------------------------------------------------------------
// Blocks and items
// ---------------------------------------------------------------------------

/**
 * Builds the session's blocks for program week `weekNumber`: each block keeps
 * only the items that run this week (`runsInWeeks`), and a block left with no
 * items is dropped. Every kept block carries its original 1-based position in
 * the day, so dropping a block never renumbers the ones after it. Called by
 * `buildSession`; the filter runs before `buildBlock` so deload halving and
 * the power-endurance changes only see the items that are shown.
 *
 *   day.blocks [warmup, explosive, main]  -- week 2 drops an emptied "explosive" -->
 *   session    [warmup (position 1), main (position 3)]
 */
function buildBlocksForWeek(blocks: Block[], settings: TrainingSettings, weekContext: WeekContext, weekNumber: number): BlockView[] {
  const views: BlockView[] = [];

  blocks.forEach((block, blockIndex) => {
    const itemsThisWeek = block.items.filter((item) => item.runsInWeeks === "everyWeek" || item.runsInWeeks.has(weekNumber));
    if (itemsThisWeek.length === 0) return;

    views.push(buildBlock({ ...block, items: itemsThisWeek }, blockIndex + 1, settings, weekContext));
  });

  return views;
}

/** Builds one block (at `position` in the program day); warm-ups are never halved in a deload. */
function buildBlock(block: Block, position: number, settings: TrainingSettings, week: WeekContext): BlockView {
  const halve = week.isDeload && block.type !== "warmup";

  // Only core blocks take the rest adjustment (the power-endurance "cut core rest").
  const restAdjustment = week.timerAdjustments?.coreRestBetweenPairsSec ?? 0;
  const restAdjusted = block.type === "core" && block.restSecBetweenPairs !== undefined && restAdjustment !== 0;

  return {
    position,
    type: block.type,
    format: block.format,
    rounds: block.rounds && (halve ? halveRange(block.rounds) : block.rounds),
    minutes: block.minutes === undefined ? undefined : halve ? halveRoundingUp(block.minutes) : block.minutes,
    restSecBetweenPairs: restAdjusted ? shiftRange(block.restSecBetweenPairs as Range, restAdjustment, MAX_REST_SECONDS) : block.restSecBetweenPairs,
    restAdjustment: restAdjusted ? restAdjustment : undefined,
    items: block.items.map((item) => buildItem(item, settings, halve, week)),
  };
}

/**
 * Moves both ends of a range by `seconds`, kept between the timer's floor
 * (MIN_TIMER_SECONDS) and `ceiling` (the matching stepper maximum), so the
 * timer can always start from the result. Used for the phase's timer
 * adjustments (power endurance): work uses MAX_INTERVAL_WORK_SECONDS, rest
 * between pairs uses MAX_REST_SECONDS.
 */
function shiftRange(range: Range, seconds: number, ceiling: number): Range {
  const clamp = (value: number) => Math.min(ceiling, Math.max(MIN_TIMER_SECONDS, value));
  return { min: clamp(range.min + seconds), max: clamp(range.max + seconds) };
}

/**
 * Builds one item: halves volume in a deload (`blockHalve`, decided for the
 * whole block by `buildBlock`), resolves rep targets against the athlete's
 * maxes, and applies the weekly increase to items that declare one. An item
 * marked `sameEveryWeek` ignores `blockHalve` and the phase's interval work
 * adjustment; the parser makes sure such an item has no weekly increase and
 * no block-level rounds or minutes, so it really is the same every week.
 * An item with a "No equipment" swap also gets the swap's view for the same
 * week attached as `noEquipment` (both views come from `buildItemView`).
 */
function buildItem(item: BlockItem, settings: TrainingSettings, blockHalve: boolean, week: WeekContext): ItemView {
  const view = buildItemView(item, settings, blockHalve, week);

  if (item.noEquipment === undefined) {
    return view;
  }

  // The swap goes through exactly the same week arithmetic (halving, weekly
  // increase, timer changes) as the original, via its effective item.
  return { ...view, noEquipment: buildItemView(applyNoEquipmentSwap(item), settings, blockHalve, week) };
}

/**
 * Builds the view of one item exactly as written (no swap handling): the part
 * of `buildItem` that is run once for the original and once for its swap.
 */
function buildItemView(item: BlockItem, settings: TrainingSettings, blockHalve: boolean, week: WeekContext): ItemView {
  const halve = blockHalve && !item.sameEveryWeek;
  const choice = chooseIncrease(item, settings, week);

  // Interval items (heavy bag) unless marked sameEveryWeek take the work adjustment (the power-endurance "longer rounds").
  const workAdjustment = week.timerAdjustments?.intervalWorkSec ?? 0;
  const workAdjusted = item.format === "interval" && item.workSec !== undefined && workAdjustment !== 0 && !item.sameEveryWeek;

  const keptSets = halve ? item.sets.slice(0, Math.ceil(item.sets.length / 2)) : item.sets;

  return {
    exercise: item.exercise,
    format: item.format,
    sets: keptSets.map((set) => ({
      target: set.reps && resolveReps(set.reps, item.exerciseId, settings, choice),
      load: set.load,
    })),
    target: item.reps && resolveReps(item.reps, item.exerciseId, settings, choice),
    restSec: item.restSec,
    minutes: item.minutes === undefined ? undefined : halve ? halveRoundingUp(item.minutes) : item.minutes,
    // Deload intervals use the low end of the range, halved (4-5 -> 2).
    rounds: item.rounds && (halve ? { min: halveRoundingUp(item.rounds.min), max: halveRoundingUp(item.rounds.min) } : item.rounds),
    workSec: workAdjusted ? shiftRange(item.workSec as Range, workAdjustment, MAX_INTERVAL_WORK_SECONDS) : item.workSec,
    workSecAdjustment: workAdjusted ? workAdjustment : undefined,
    showsSameEveryWeekNote: item.sameEveryWeek && (week.isDeload || week.timerAdjustments !== undefined) ? true : undefined,
    durationSec: item.durationSec,
    perSide: item.perSide,
    optional: item.optional,
    load: item.load,
    note: item.note,
    tempo: item.tempo,
    weeklyIncrease: item.weeklyIncrease,
  };
}

/**
 * Builds the "effective item" for a "No equipment" swap: the original item's
 * structure (sets count, rest, format, minutes, rounds, work time, per side,
 * optional, weekly increase, same-every-week) with the swap's exercise and
 * dose. `buildItem` runs it through the normal week arithmetic to get the
 * swap's view (`ItemView.noEquipment`); PR 19 uses it for ticked items.
 *
 *   original item ──┬─ kept:     sets count, restSec, format, minutes, rounds,
 *                   │            workSec, perSide, optional, weeklyIncrease,
 *                   │            sameEveryWeek
 *                   ├─ swap's:   exercise (and exerciseId), load, note, tempo
 *                   │            (never the original's: those describe its kit)
 *                   └─ swap's if given, else the original's: reps, durationSec
 *                      (for items with sets, each set takes the swap's reps and
 *                       loses its own load such as "heavy")
 *
 * `exerciseId` becomes the swap's id: the swap is a different exercise, its
 * sets are logged under that id, and the max logic keyed on it finds no max
 * (the parser guarantees a swap is never max-tested and has its own reps when
 * the original is max-based). The effective item has no `noEquipment`, so a
 * swap is never swapped again. Pure; the original item is not changed.
 */
export function applyNoEquipmentSwap(item: BlockItem): BlockItem {
  const swap = item.noEquipment;
  if (swap === undefined) {
    return item;
  }

  return {
    ...item,
    exerciseId: swap.exercise.id,
    exercise: swap.exercise,
    // Sets keep their position and count; reps come from the swap when it
    // gives them, and per-set loads are dropped.
    sets: item.sets.map((set) => ({ reps: swap.reps ?? set.reps })),
    // An item with sets carries its reps in the sets, not at item level.
    reps: item.sets.length > 0 ? item.reps : (swap.reps ?? item.reps),
    durationSec: swap.durationSec ?? item.durationSec,
    load: swap.load,
    note: swap.note,
    tempo: swap.tempo,
    noEquipment: undefined,
  };
}

/**
 * Decides how an item's weekly increase is applied this week.
 *
 * Only items with a `weeklyIncrease` (the EMOMs) grow week to week. The field
 * is descriptive text and is not parsed: its presence means "+1 rep per
 * week", and `week.offset` is the number of weekly increases accumulated (in
 * a plain deload, last week's: held, not reset).
 *
 *   not an EMOM            -> no increase (mini-doses just use the saved max)
 *   retest week, EMOM:
 *     max saved this week  -> offset 0, from the retested max
 *     no max saved yet     -> hold last week's offset, awaiting a retest
 *     reps not max-based (e.g. a swap's) -> always hold last week's offset
 *   other weeks            -> week.offset (held in a plain deload)
 */
function chooseIncrease(item: BlockItem, settings: TrainingSettings, week: WeekContext): IncreaseChoice {
  if (item.weeklyIncrease === undefined) {
    return { increase: 0, heldForDeload: false, usesRetestedMax: false, awaitingRetest: false };
  }

  if (week.isRetest && item.reps?.kind !== "percentOfMax") {
    // Any EMOM whose reps aren't max-based (in the shipped program, only the
    // swaps: inverted rows, chair dips) never uses a tested max, so a saved
    // max can't "retest" it: it always holds last week's figure.
    return { increase: week.retestHeldOffset, heldForDeload: true, usesRetestedMax: false, awaitingRetest: false };
  }

  if (week.isRetest) {
    const retested = wasMaxSavedDuringWeek(settings, item.exerciseId, week.weekStartDate);

    return retested
      ? { increase: week.offset, heldForDeload: false, usesRetestedMax: true, awaitingRetest: false }
      : {
          increase: week.retestHeldOffset,
          heldForDeload: true,
          usesRetestedMax: false,
          awaitingRetest: true,
          heldMax: heldMaxFor(item.exerciseId, settings, week),
        };
  }

  return { increase: week.offset, heldForDeload: week.isDeload && week.offset > 0, usesRetestedMax: false, awaitingRetest: false };
}

/**
 * The max the retest week's hold is worked out with: the max in effect on the
 * last day of the previous week that had this exercise's EMOM (so a max raised
 * later in that week doesn't change the hold). Undefined (= use the current
 * max) when the exercise has no such day or no history.
 */
function heldMaxFor(exerciseId: string, settings: TrainingSettings, week: WeekContext): number | undefined {
  const emomDate = week.heldEmomDates[exerciseId];
  const history = settings.maxHistory[exerciseId];
  if (emomDate === undefined || history === undefined) {
    return undefined;
  }
  return maxInEffectOn(history, emomDate);
}

/**
 * True when the exercise's max was saved on a date inside the week that starts
 * on `weekStartDate`: Day 1 to Day 7 inclusive. This is THE "retested during
 * the retest week" check: `chooseIncrease` uses it to switch EMOMs to the new
 * max, and the Today retest card (ui/retest.ts) uses it to know which maxes
 * are still to save. The window has an end as well as a start so that moving
 * the start date later (the old save is now before week 8) or earlier (the old
 * save is now after week 8) can't turn an unrelated old save into a retest.
 * ISO dates compare correctly as strings; a max with no known save date
 * counts as not saved.
 */
export function wasMaxSavedDuringWeek(settings: TrainingSettings, exerciseId: string, weekStartDate: string): boolean {
  const savedOn = settings.maxSavedOn[exerciseId];
  const weekEndDate = addDaysToDate(weekStartDate, DAYS_PER_WEEK - 1);
  return savedOn !== undefined && savedOn >= weekStartDate && savedOn <= weekEndDate;
}

/**
 * For a retest-week TRAINING day, returns the date of that week's Day 1;
 * for any other date (no start date, not started, complete, a non-retest
 * week, or a rest day) returns undefined. Used by the Today retest card to
 * decide whether to appear and which saved dates count as "retested" (see `wasMaxSavedDuringWeek`).
 */
export function retestWeekStartDate(program: Program, settings: TrainingSettings, date: string): string | undefined {
  const status = programStatus(settings.startDate, program.lengthWeeks, date);
  if (status.kind !== "active") {
    return undefined;
  }

  const isRetestWeek = phaseForWeek(program, status.week).retest;
  const isTrainingDay = program.days[status.dayNumber] !== undefined;
  if (!isRetestWeek || !isTrainingDay) {
    return undefined;
  }

  // settings.startDate is non-null here: programStatus was "active".
  return addDaysToDate(settings.startDate as string, (status.week - 1) * DAYS_PER_WEEK);
}

/** Halves a count, rounding up (5 -> 3, 2 -> 1). */
function halveRoundingUp(count: number): number {
  return Math.ceil(count / 2);
}

/** Halves both ends of a range, rounding up. */
function halveRange(range: Range): Range {
  return { min: halveRoundingUp(range.min), max: halveRoundingUp(range.max) };
}

/**
 * Converts program reps into a displayable target. Percent-of-max becomes
 * floor(max x pct), at least 1; the weekly `increase` is added after that.
 * Percent-of-max targets also carry a `basis` so the UI can explain them;
 * `choice` says how the weekly increase applies (see `chooseIncrease`).
 */
function resolveReps(reps: Reps, exerciseId: string, settings: TrainingSettings, choice: IncreaseChoice): RepTarget {
  const { increase } = choice;

  switch (reps.kind) {
    case "text":
      return { kind: "text", text: reps.text };

    case "fixed":
      return { kind: "fixed", count: reps.count + increase };

    case "range":
      return rangeTarget(reps.min + increase, reps.max + increase);

    case "percentOfMax": {
      const currentMax = settings.maxReps[exerciseId];
      if (currentMax === undefined) {
        return { kind: "needsMax", exerciseId, percentMin: reps.min, percentMax: reps.max };
      }
      const max = choice.heldMax ?? currentMax;
      const low = Math.max(1, floorPercentOfMax(max, reps.min));
      const high = Math.max(1, floorPercentOfMax(max, reps.max));
      const basis: MaxBasis = { percentMin: reps.min, percentMax: reps.max, max, weeklyIncrease: increase, heldForDeload: choice.heldForDeload, usesRetestedMax: choice.usesRetestedMax, awaitingRetest: choice.awaitingRetest };
      return rangeTarget(low + increase, high + increase, basis);
    }
  }
}

/**
 * floor(max x fraction), nudged by 1e-9 first. Fractions like 0.57 aren't
 * exact in binary floating point (100 x 0.57 = 56.99999999999999), so a bare
 * floor would drop a whole rep. The nudge is far smaller than any real
 * difference between rep counts, so it only repairs those artefacts.
 */
function floorPercentOfMax(max: number, fraction: number): number {
  return Math.floor(max * fraction + 1e-9);
}

/** A range whose ends match is shown as a single fixed number. */
function rangeTarget(min: number, max: number, basis?: MaxBasis): RepTarget {
  return min === max ? { kind: "fixed", count: min, basis } : { kind: "range", min, max, basis };
}
