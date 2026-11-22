import type { WorkoutLog } from "../log/model";
import { setsForItem } from "../log/operations";
import { estimatedBlockMinutes } from "../optionalBlocks/session";
import type { TrainingSettings } from "../settings/model";
import { noEquipmentItemKey } from "./noEquipment";
import { INJURY_AREAS, type InjuryArea, type InjuryLoadLevel, type Program } from "./model";
import { buildBlocksForDate, type BlockView, type ItemView, type SessionView } from "./schedule";

/*
 * How a flagged area reaches the screen (PLAN.md, "Plan: train around an
 * injury"). Pure: no storage, no clock, no UI.
 *
 *   injuries ─▶ activeAreasOn(date) ─┐
 *   choices  ─▶ addBackKeysForDate ──┤
 *   log (locks) ─────────────────────┤
 *                                    ▼
 *   buildSession ─▶ applyInjuries ─▶ noEquipmentChoices/applyNoEquipmentChoices ─▶ Today / log screen
 *   (unswapped)     (this module)    (an injury wins: this step drops the swap
 *                                     of any row it leaves out or stands in for)
 *
 * Why injuries run BEFORE the no-equipment swaps: `applyNoEquipmentChoices`
 * replaces a ticked row with the swap's view, which loses the original item
 * the injury rules need (its stand-in, its sets to halve for "Add it back").
 * So `applyInjuries` works on the unswapped session and removes
 * `ItemView.noEquipment` from every row it leaves out, stands in for or adds
 * back; the later swap step then finds nothing to swap, and Today (which
 * shows the tick only where `noEquipment` exists) hides the tick.
 *
 * What happens to one item, by the strictest level over the flagged areas:
 *
 *   level    stand-in for the area?   result
 *   -------  -----------------------  -----------------------------------------
 *   avoid    yes                      the stand-in view (injuryStandInFor)
 *   avoid    no                       leftOut (kept in the data, not counted)
 *            ... and "Add it back"    the original at half the sets, painFreeOnly, addedBack
 *   caution  yes                      the stand-in view
 *   caution  no                       kept as written, painFreeOnly
 *   none     -                        unchanged
 *
 * Logged sets lock a row, as with the no-equipment ticks: sets under the
 * original's id keep the original; sets under a stand-in's id keep that
 * stand-in. "Add it back" outranks the lock, because the added-back row IS
 * the original exercise and logging its first set must not undo the choice.
 */

/** Everything `applyInjuries` needs besides the session and the choices. */
export interface InjuryContext {
  program: Program;
  settings: TrainingSettings;

  /** The log the locks are read from. */
  log: WorkoutLog;

  /** The date sets are logged under (the host date of a combined session). */
  logDate: string;

  /** The date the session was built for (its week and day), used to build an area-free session. Same as `logDate` unless one day of a combined session. */
  sessionDate: string;
}

/** Rough seconds per set of a core exercise, for the area-free session's minutes (the file gives no minutes for it). */
const ESTIMATED_SECONDS_PER_SET = 45;

/**
 * Returns `session` with the flagged `activeAreas` applied to every item
 * (see the table above), and, when that leaves a training day with no main
 * work, the area's own session instead (`areaFreeSession`).
 *
 * `addBackKeys` are the date's "Add it back" item keys
 * (`noEquipmentItemKey`; day-qualified when `qualifyKeysWithDay`, for one day
 * of a combined session). `targetMinutes` drops by the minutes of each
 * left-out EMOM or timed item. Non-training sessions, and any session when no
 * area is flagged, are returned as they are. Pure; the input is not mutated.
 * Called by `buildSwappedSession` and `buildSwappedCombinedSession`
 * (noEquipment/session.ts) right after `buildSession`.
 */
export function applyInjuries(
  session: SessionView,
  context: InjuryContext,
  activeAreas: readonly InjuryArea[],
  addBackKeys: ReadonlySet<string>,
  qualifyKeysWithDay = false,
): SessionView {
  if (session.kind !== "training" || activeAreas.length === 0) return session;

  const keyDay = qualifyKeysWithDay ? session.dayNumber : undefined;
  let minutesLeftOut = 0;

  const blocks = session.blocks.map((block) => ({
    ...block,
    items: block.items.map((item) => {
      const itemKey = noEquipmentItemKey(block.position, item.exercise.id, keyDay);
      const changed = applyInjuriesToItem(item, block, itemKey, session.dayNumber, context, activeAreas, addBackKeys);
      if (changed.leftOut !== undefined) minutesLeftOut += estimatedItemMinutes(block, item);
      return changed;
    }),
  }));

  const flaggedSession = { ...session, blocks, targetMinutes: Math.max(0, session.targetMinutes - minutesLeftOut) };

  return replaceWithAreaFreeSession(flaggedSession, context, activeAreas);
}

/** The strictest level the flagged areas give an exercise, and the areas at that level in `INJURY_AREAS` order; undefined when none tags it. */
function strictestLevel(item: ItemView, activeAreas: readonly InjuryArea[]): { level: InjuryLoadLevel; areas: InjuryArea[] } | undefined {
  const levelsByArea = INJURY_AREAS.filter((area) => activeAreas.includes(area)).map((area) => ({ area, level: item.exercise.loads?.[area] }));

  const level: InjuryLoadLevel | undefined = levelsByArea.some((entry) => entry.level === "avoid") ? "avoid" : levelsByArea.some((entry) => entry.level === "caution") ? "caution" : undefined;
  if (level === undefined) return undefined;

  return { level, areas: levelsByArea.filter((entry) => entry.level === level).map((entry) => entry.area) };
}

/** Decides what happens to one item; see the table at the top of this file. */
function applyInjuriesToItem(
  item: ItemView,
  block: BlockView,
  itemKey: string,
  day: number,
  context: InjuryContext,
  activeAreas: readonly InjuryArea[],
  addBackKeys: ReadonlySet<string>,
): ItemView {
  const strictest = strictestLevel(item, activeAreas);
  if (strictest === undefined) return item;

  // A stand-in applies only when every area at the strictest level has one (else the item is left out / kept pain-free).
  const areaWithStandIn = strictest.areas.every((area) => item.injury?.[area] !== undefined) ? strictest.areas[0] : undefined;
  const standInView = areaWithStandIn === undefined ? undefined : item.injury?.[areaWithStandIn];
  const isLeftOutLevel = strictest.level === "avoid" && standInView === undefined;

  const loggedCount = (exerciseId: string) => setsForItem(context.log, context.logDate, block.position, exerciseId, day).length;

  // "Add it back" outranks the lock: the added-back row is the original exercise.
  if (isLeftOutLevel && addBackKeys.has(itemKey)) return addBack(item, block);

  // A stand-in's own sets keep the stand-in, whatever the tags now say.
  const standInWithSets = activeAreas.find((area) => item.injury?.[area] !== undefined && loggedCount(item.injury[area]!.exercise.id) > 0);
  if (standInWithSets !== undefined) return standInRow(item, standInWithSets);

  // Sets under the original (or its no-equipment swap) keep the item as written.
  const hasOwnSets = loggedCount(item.exercise.id) > 0 || (item.noEquipment !== undefined && loggedCount(item.noEquipment.exercise.id) > 0);
  if (hasOwnSets && !(strictest.level === "caution" && standInView === undefined)) return item;

  if (standInView !== undefined && areaWithStandIn !== undefined) return standInRow(item, areaWithStandIn);
  if (isLeftOutLevel) return { ...item, noEquipment: undefined, leftOut: { area: strictest.areas[0]! } };

  // Caution without a stand-in: kept, pain-free only. Its no-equipment tick stays unless the swap is itself tagged for a flagged area.
  return keepPainFreeOnly(item, activeAreas);
}

/** The stand-in's view for `area`, marked with what it stands in for. Its no-equipment swap is gone (an injury wins); the original's `injury` views stay for the exercise sheet. */
function standInRow(item: ItemView, area: InjuryArea): ItemView {
  const standIn = item.injury![area]!;
  return { ...standIn, injuryStandInFor: { area, original: item.exercise }, injury: item.injury };
}

/**
 * A "caution" item with no stand-in: as written, marked painFreeOnly. Note
 * (a): when its no-equipment swap is itself tagged "avoid" for a flagged area
 * (Pallof press -> plank shoulder taps) the swap is dropped, hiding the tick;
 * a swap tagged "caution" stays, marked painFreeOnly too.
 */
function keepPainFreeOnly(item: ItemView, activeAreas: readonly InjuryArea[]): ItemView {
  const kept: ItemView = { ...item, painFreeOnly: true };
  if (item.noEquipment === undefined) return kept;

  const swapLevel = strictestLevel(item.noEquipment, activeAreas)?.level;
  if (swapLevel === "avoid") return { ...kept, noEquipment: undefined };
  return { ...kept, noEquipment: { ...item.noEquipment, painFreeOnly: true } };
}

/**
 * The original item at half the sets, for "Add it back": sets, EMOM minutes
 * and interval rounds halved with the deload rule (halve, round up; rounds
 * use the low end), a warm-up never halved. Marked painFreeOnly and
 * addedBack; its no-equipment swap is dropped. A deload week is halved once
 * more (the item is already at its deload size): 9 min -> 5 -> 3.
 */
function addBack(item: ItemView, block: BlockView): ItemView {
  const added: ItemView = { ...item, noEquipment: undefined, painFreeOnly: true, addedBack: true };
  if (block.type === "warmup") return added;

  return {
    ...added,
    sets: item.sets.slice(0, Math.ceil(item.sets.length / 2)),
    minutes: item.minutes === undefined ? undefined : Math.ceil(item.minutes / 2),
    rounds: item.rounds && { min: Math.ceil(item.rounds.min / 2), max: Math.ceil(item.rounds.min / 2) },
  };
}

/** Whole minutes a left-out item no longer takes: its EMOM minutes, or an interval item's timer estimate; set-based items add nothing (the header's figure is already rough). */
function estimatedItemMinutes(block: BlockView, item: ItemView): number {
  if (item.minutes !== undefined) return item.minutes;
  if (item.format === "interval") return estimatedBlockMinutes({ ...block, items: [item] });
  return 0;
}

/**
 * When the flags leave no non-warm-up item that is not left out (and at
 * least one was left out), swaps the session's blocks for the first flagged
 * area's own session from the file, built for the week like any block
 * (deload halving applies). The first area in `INJURY_AREAS` order that has a
 * session in the file wins; with none, the session is kept as it is. A
 * session where any of the day's own items already has a logged set is kept:
 * the person started it, and replacing it would orphan those sets.
 */
function replaceWithAreaFreeSession(session: Extract<SessionView, { kind: "training" }>, context: InjuryContext, activeAreas: readonly InjuryArea[]): SessionView {
  const mainItems = session.blocks.filter((block) => block.type !== "warmup").flatMap((block) => block.items);
  const leavesNothing = mainItems.length > 0 && mainItems.every((item) => item.leftOut !== undefined);
  if (!leavesNothing) return session;

  const hasLoggedSets = session.blocks.some((block) => block.items.some((item) => setsForItem(context.log, context.logDate, block.position, item.exercise.id, session.dayNumber).length > 0));
  if (hasLoggedSets) return session;

  const area = INJURY_AREAS.find((candidate) => activeAreas.includes(candidate) && context.program.injurySessions?.[candidate] !== undefined);
  if (area === undefined) return session;

  const areaSession = context.program.injurySessions![area]!;
  const blocks = buildBlocksForDate(context.program, context.settings, context.sessionDate, areaSession.blocks);
  if (blocks === undefined) return session;

  return {
    ...session,
    blocks,
    targetMinutes: estimatedSessionMinutes(blocks),
    areaFreeSession: { area, name: areaSession.name, insteadOf: session.focus },
  };
}

/**
 * A rough length of a session of set-based blocks, in whole minutes: 45s a
 * set (a warm-up item counts its block's rounds), plus the core block's rest
 * between pairs once per round. The shoulder-free session comes out at about
 * 12 minutes in a normal week, as the plan says.
 */
function estimatedSessionMinutes(blocks: readonly BlockView[]): number {
  let seconds = 0;

  for (const block of blocks) {
    const setCounts = block.items.map((item) => (item.sets.length > 0 ? item.sets.length : (block.rounds?.min ?? 1)));
    seconds += setCounts.reduce((total, count) => total + count, 0) * ESTIMATED_SECONDS_PER_SET;
    if (block.restSecBetweenPairs !== undefined) seconds += Math.max(0, ...setCounts) * block.restSecBetweenPairs.max;
  }

  return Math.round(seconds / 60);
}
