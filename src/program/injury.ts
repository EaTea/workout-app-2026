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
 * of a combined session). When anything is left out or added back,
 * `targetMinutes` is re-estimated from the rows that are left
 * (`estimatedSessionMinutes`, an added-back row at its halved dose), the same
 * estimator the area-free session uses. Non-training sessions are returned as
 * they are. Pure; the input is not mutated.
 *
 * Logged sets lock a row whatever is flagged, so clearing the flag does not
 * rewrite a session already trained: with no area flagged (`activeAreas`
 * empty) an item with sets logged under its stand-in's id still shows the
 * stand-in, and an area-free session with logged sets stays the area-free
 * session; otherwise the session is returned as it is.
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
  if (session.kind !== "training") return session;

  const keyDay = qualifyKeysWithDay ? session.dayNumber : undefined;
  let anItemChanged = false;
  let aRowIsLeftOutOrAddedBack = false;

  const blocks = session.blocks.map((block) => ({
    ...block,
    items: block.items.map((item) => {
      const itemKey = noEquipmentItemKey(block.position, item.exercise.id, keyDay);
      const changed = applyInjuriesToItem(item, block, itemKey, session.dayNumber, context, activeAreas, addBackKeys);
      if (changed !== item) anItemChanged = true;
      if (changed.leftOut !== undefined || changed.addedBack === true) aRowIsLeftOutOrAddedBack = true;
      return changed;
    }),
  }));

  // Nothing flagged and no logged stand-in to keep: the session is exactly as built.
  const flaggedSession = anItemChanged ? { ...session, blocks } : session;

  // The header's minutes: the file's figure is for the whole day, so re-estimate from what is really left.
  const withMinutes = aRowIsLeftOutOrAddedBack ? { ...flaggedSession, targetMinutes: estimatedSessionMinutes(blocks) } : flaggedSession;

  return replaceWithAreaFreeSession(withMinutes, context, activeAreas);
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
  const loggedCount = (exerciseId: string) => setsForItem(context.log, context.logDate, block.position, exerciseId, day).length;
  const strictest = strictestLevel(item, activeAreas);

  // Logged sets lock the row whatever the flag says (so clearing the flag keeps a stand-in that was trained);
  // an untagged or no-longer-flagged item with no stand-in sets stays as written.
  if (strictest === undefined) {
    const trainedStandInArea = INJURY_AREAS.find((area) => item.injury?.[area] !== undefined && loggedCount(item.injury[area]!.exercise.id) > 0);
    return trainedStandInArea === undefined ? item : standInRow(item, trainedStandInArea);
  }

  // A stand-in applies only when every area at the strictest level has one (else the item is left out / kept pain-free).
  const areaWithStandIn = strictest.areas.every((area) => item.injury?.[area] !== undefined) ? strictest.areas[0] : undefined;
  const standInView = areaWithStandIn === undefined ? undefined : item.injury?.[areaWithStandIn];
  const isLeftOutLevel = strictest.level === "avoid" && standInView === undefined;

  // "Add it back" outranks the lock: the added-back row is the original exercise.
  if (isLeftOutLevel && addBackKeys.has(itemKey)) return addBack(item, block);

  // A stand-in's own sets keep the stand-in, whatever the tags now say.
  const standInWithSets = INJURY_AREAS.find((area) => item.injury?.[area] !== undefined && loggedCount(item.injury[area]!.exercise.id) > 0);
  if (standInWithSets !== undefined) return standInRow(item, standInWithSets);

  // Sets under the original (or its no-equipment swap) keep the item as written.
  const hasOwnSets = loggedCount(item.exercise.id) > 0 || (item.noEquipment !== undefined && loggedCount(item.noEquipment.exercise.id) > 0);
  if (hasOwnSets && !(strictest.level === "caution" && standInView === undefined)) return item;

  if (standInView !== undefined && areaWithStandIn !== undefined) return standInRow(item, areaWithStandIn);
  if (isLeftOutLevel) return { ...item, noEquipment: undefined, leftOut: { area: strictest.areas[0]! } };

  // Caution without a stand-in: kept, pain-free only. Its no-equipment tick stays unless the swap is itself tagged for a flagged area.
  return keepPainFreeOnly(item, activeAreas);
}

/**
 * The stand-in's view for `area`, marked with what it stands in for. Its no-equipment swap is gone (an injury wins); the original's `injury` views stay for the exercise sheet.
 * On a rotated warm-up week the row is worded "Instead of <the rotated name>" (Reverse fly,
 * not YTWI raises): the name the person would have seen, with the original's id kept.
 */
function standInRow(item: ItemView, area: InjuryArea): ItemView {
  const standIn = item.injury![area]!;
  const shownOriginal = item.rotatedIn === undefined ? item.exercise : { ...item.exercise, name: item.rotatedIn.displayName };

  return { ...standIn, injuryStandInFor: { area, original: shownOriginal }, injury: item.injury };
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

/**
 * Swaps the session's blocks for an area's own session from the file, built
 * for the week like any block (deload halving applies), when
 *  - the flags leave no non-warm-up item that is not left out (and at least
 *    one was left out): the first flagged area (in `INJURY_AREAS` order) that
 *    has a session in the file wins; or
 *  - the area-free session already has a logged set on the date (its items'
 *    ids, in its own block positions): it stays, flagged or not, so clearing
 *    the flag does not orphan what was trained.
 * A day where any of the day's own items already has a logged set is kept
 * as it is: the person started it, and replacing it would orphan those sets.
 * With no session for the area in the file the session is kept as it is.
 */
function replaceWithAreaFreeSession(session: Extract<SessionView, { kind: "training" }>, context: InjuryContext, activeAreas: readonly InjuryArea[]): SessionView {
  const hasLoggedSets = session.blocks.some((block) => block.items.some((item) => setsForItem(context.log, context.logDate, block.position, item.exercise.id, session.dayNumber).length > 0));
  if (hasLoggedSets) return session;

  const mainItems = session.blocks.filter((block) => block.type !== "warmup").flatMap((block) => block.items);
  const leavesNothing = mainItems.length > 0 && mainItems.every((item) => item.leftOut !== undefined);

  for (const area of INJURY_AREAS) {
    const areaSession = context.program.injurySessions?.[area];
    if (areaSession === undefined) continue;

    const blocks = buildBlocksForDate(context.program, context.settings, context.sessionDate, areaSession.blocks);
    if (blocks === undefined) continue;

    const wouldReplace = leavesNothing && activeAreas.includes(area);
    const alreadyTrained = blocks.some((block) => block.items.some((item) => setsForItem(context.log, context.logDate, block.position, item.exercise.id, session.dayNumber).length > 0));
    if (!wouldReplace && !alreadyTrained) continue;

    return {
      ...session,
      blocks,
      targetMinutes: estimatedSessionMinutes(blocks),
      areaFreeSession: { area, name: areaSession.name, insteadOf: session.focus },
    };
  }

  return session;
}

/**
 * A rough length of a session's blocks, in whole minutes, from the rows that
 * are left (a left-out row adds nothing; an added-back row counts at its
 * halved dose, as it is in the view). Used for a day with anything left out
 * or added back and for the area-free session, so the two agree. An EMOM
 * item counts its minutes, an interval item its timer's length
 * (`estimatedBlockMinutes`), any other item 45s a set (a warm-up item counts
 * its block's rounds), plus the core block's rest between pairs once per round.
 * The shoulder-free session comes out at about 12 minutes in a normal week, as the plan says.
 */
export function estimatedSessionMinutes(blocks: readonly BlockView[]): number {
  let seconds = 0;

  for (const block of blocks) {
    const itemsLeft = block.items.filter((item) => item.leftOut === undefined);
    const setCounts: number[] = [];

    for (const item of itemsLeft) {
      if (item.minutes !== undefined) seconds += item.minutes * 60;
      else if (item.format === "interval") seconds += estimatedBlockMinutes({ ...block, items: [item] }) * 60;
      else {
        const count = item.sets.length > 0 ? item.sets.length : (block.rounds?.min ?? 1);
        setCounts.push(count);
        seconds += count * ESTIMATED_SECONDS_PER_SET;
      }
    }

    if (block.restSecBetweenPairs !== undefined && setCounts.length > 0) seconds += Math.max(...setCounts) * block.restSecBetweenPairs.max;
  }

  return Math.round(seconds / 60);
}
