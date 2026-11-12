import type { DayNumber, Program } from "./model";
import type { BlockView, ItemView, SessionView } from "./schedule";

/**
 * Merging two days' sessions into one combined session (rules 4 and 5 of the
 * PR 23 design). Pure: no storage, no clock, no UI. Today (PR 25 step 4)
 * builds each day's session the way it always does (`buildSwappedSession`:
 * deload halving, power-endurance changes, max-rep targets and "No equipment"
 * swaps already applied), then hands the two to `combineSessions`.
 *
 *   day A's SessionView ─┐
 *                        ├─▶ combineSessions(program, ...) ─▶ CombinedSession ─▶ Today
 *   day B's SessionView ─┘      (sessionOrder, alternate        (blocks in order, each
 *                                explosive, drop extras)         remembering its own day
 *                                                                and block position)
 *
 * Every block keeps the day it came from and its 1-based position within
 * THAT day (`blockPosition`, as Today numbers a single day's blocks), because
 * logging (rule 7) saves each set with its own day and position, so "last
 * time", History and the exports keep working.
 *
 * Order, within `program.sessionOrder`'s block types and with the earlier day
 * first inside each type:
 *
 *   warm-up      day A, day B                 both in full (never cut)
 *   explosive    A ⇄ B  (one "alternate" block) when both are set-based;
 *                otherwise set-based first, an EMOM/interval block after it
 *   mainStrength day A, day B                 as written
 *   miniDose     day A, day B                 as written
 *   core         day A, day B                 optional items left out
 *   finisher     day A, day B                 bag rounds capped at their minimum
 */

/** The minutes saved when two set-based explosive blocks alternate (each one's rest is spent on the other). */
export const ALTERNATING_EXPLOSIVE_MINUTES_SAVED = 3;

/** The minutes saved when optional core items and/or extra bag rounds are dropped (counted once, however many were dropped). */
export const DROPPED_EXTRAS_MINUTES_SAVED = 4;

/** The training case of `SessionView`, which is what can be combined. */
export type TrainingSessionView = Extract<SessionView, { kind: "training" }>;

/** Where a block (or the items of an alternate block) came from. */
export interface CombinedBlockSource {
  /** The program day the block belongs to. */
  day: DayNumber;

  /** 1-based position of the block within its own day's blocks, as Today numbers a single day's session. */
  blockPosition: number;
}

/**
 * One day's block inside a combined block. `block` is the day's block as
 * built (after the rules below removed any optional items or capped bag
 * rounds), and `source` says where logging should file its sets.
 */
export interface CombinedBlockPart {
  source: CombinedBlockSource;
  block: BlockView;
}

/**
 * One block of the combined session.
 *  - "single": `parts` holds exactly one part, shown as written.
 *  - "alternate": `parts` holds one part per day (earlier day first), shown
 *    as one block where a set of one is followed by a set of the other, so
 *    each one's rest is spent on the other. Only explosive blocks alternate.
 */
export interface CombinedBlock {
  type: string;
  arrangement: "single" | "alternate";
  parts: CombinedBlockPart[];
}

/** What the combined session left out to save time (rule 4.4), for the header and tests. */
export interface DroppedForTime {
  /** True when at least one `optional: true` core/finisher item was removed. */
  optionalItems: boolean;

  /** True when at least one interval item's rounds were reduced to the bottom of their range. */
  bagRounds: boolean;
}

/** The merged session Today shows when two days are combined. Internal type: never stored. */
export interface CombinedSession {
  kind: "combined";
  week: number;
  phase: string;
  isDeload: boolean;

  /** The two days, earlier first. */
  days: readonly [DayNumber, DayNumber];

  /** "Upper: pull + Lower: knee": the two focuses, earlier day first. */
  focus: string;

  /** Rule 5: the two days' `targetMinutes` added up, less the savings below. An estimate, not a timing. */
  targetMinutes: number;

  /** True when the two explosive blocks became one alternate block (3 minutes saved). */
  explosiveAlternates: boolean;

  droppedForTime: DroppedForTime;

  blocks: CombinedBlock[];
}

/**
 * Builds the combined session for two days of the same week. The two
 * sessions may be given in either order; the lower day number is treated as
 * the earlier day. Throws (a caller bug, since Today only offers allowed
 * pairs) when a session is not a training day, the weeks differ, or the days
 * are not one of `program.combinePairs`.
 */
export function combineSessions(program: Program, first: SessionView, second: SessionView): CombinedSession {
  const [earlier, later] = orderedTrainingSessions(program, first, second);

  const parts = collectBlockParts(earlier, later);
  // Alternate only when each day brings exactly one explosive block and both are set-based.
  const explosiveAlternates =
    parts.explosive.length === 2 && parts.explosive[0]!.source.day !== parts.explosive[1]!.source.day && parts.explosive.every((part) => isSetBased(part.block));

  const dropped: DroppedForTime = { optionalItems: false, bagRounds: false };
  const blocks: CombinedBlock[] = [];

  for (const blockType of orderedBlockTypes(program, parts.byType)) {
    const partsOfType = parts.byType.get(blockType) ?? [];

    if (blockType === EXPLOSIVE_TYPE) {
      blocks.push(...arrangeExplosive(partsOfType, explosiveAlternates));
      continue;
    }

    for (const part of partsOfType) {
      const trimmedBlock = isTrimmedType(blockType) ? dropExtras(part.block, dropped) : part.block;
      if (trimmedBlock.items.length === 0) continue; // every item was optional: nothing left to show

      blocks.push({ type: blockType, arrangement: "single", parts: [{ source: part.source, block: trimmedBlock }] });
    }
  }

  const droppedAny = dropped.optionalItems || dropped.bagRounds;
  const targetMinutes =
    earlier.targetMinutes +
    later.targetMinutes -
    (explosiveAlternates ? ALTERNATING_EXPLOSIVE_MINUTES_SAVED : 0) -
    (droppedAny ? DROPPED_EXTRAS_MINUTES_SAVED : 0);

  return {
    kind: "combined",
    week: earlier.week,
    phase: earlier.phase,
    isDeload: earlier.isDeload,
    days: [earlier.dayNumber, later.dayNumber],
    focus: `${earlier.focus} + ${later.focus}`,
    targetMinutes,
    explosiveAlternates,
    droppedForTime: dropped,
    blocks,
  };
}

/**
 * Every block of a training session or a combined session as a flat list of
 * (source day, source block position, block), in the order Today shows them.
 * A normal session's blocks come from its one day, numbered from 1; a
 * combined session's come from its parts (an alternate block gives one entry
 * per day). This is the one view that "what has been logged / what is left"
 * (`sessionProgress.ts`) and the log screen's lookup of an item use, so they
 * treat both kinds of session the same and always key sets by the row's own
 * day and block position.
 */
export function blockSlotsOf(session: TrainingSessionView | CombinedSession): CombinedBlockPart[] {
  if (session.kind === "combined") {
    return session.blocks.flatMap((combinedBlock) => combinedBlock.parts);
  }

  return session.blocks.map((block) => ({ source: { day: session.dayNumber, blockPosition: block.position }, block }));
}

// ---------------------------------------------------------------------------
// Steps of combineSessions
// ---------------------------------------------------------------------------

/** The block type that may alternate. */
const EXPLOSIVE_TYPE = "explosive";

/** Block types where optional items are left out and interval rounds are capped (rule 4.4). */
const TRIMMED_TYPES: readonly string[] = ["core", "finisher"];

/** True for the block types `dropExtras` applies to. */
function isTrimmedType(blockType: string): boolean {
  return TRIMMED_TYPES.includes(blockType);
}

/** A block of one day that is waiting to be placed, with where it came from. */
interface SourcedBlock {
  source: CombinedBlockSource;
  block: BlockView;
}

/** The blocks of both days grouped by type (earlier day first within a type), plus the explosive ones on their own. */
interface CollectedBlocks {
  byType: Map<string, SourcedBlock[]>;
  explosive: SourcedBlock[];
}

/**
 * Checks the inputs of `combineSessions` and returns the two training
 * sessions, lower day number first. Throws a readable Error when they cannot
 * be combined; Today never calls it for a pair it did not offer.
 */
function orderedTrainingSessions(program: Program, first: SessionView, second: SessionView): [TrainingSessionView, TrainingSessionView] {
  if (first.kind !== "training" || second.kind !== "training") {
    throw new Error("Only two training days can be combined");
  }
  if (first.week !== second.week) {
    throw new Error(`Days of different weeks cannot be combined (week ${first.week} and week ${second.week})`);
  }

  const [earlier, later] = first.dayNumber <= second.dayNumber ? [first, second] : [second, first];
  const isAllowedPair = program.combinePairs.some(([earlierDay, laterDay]) => earlierDay === earlier.dayNumber && laterDay === later.dayNumber);
  if (!isAllowedPair) {
    throw new Error(`Day ${earlier.dayNumber} and day ${later.dayNumber} are not an allowed pair`);
  }

  return [earlier, later];
}

/**
 * Walks both days' blocks and files each under its type, recording its
 * 1-based position within its own day. The earlier day is walked first, so
 * within a type the earlier day's block comes first.
 */
function collectBlockParts(earlier: TrainingSessionView, later: TrainingSessionView): CollectedBlocks {
  const byType = new Map<string, SourcedBlock[]>();
  const explosive: SourcedBlock[] = [];

  for (const session of [earlier, later]) {
    session.blocks.forEach((block) => {
      const sourced: SourcedBlock = { source: { day: session.dayNumber, blockPosition: block.position }, block };
      byType.set(block.type, [...(byType.get(block.type) ?? []), sourced]);
      if (block.type === EXPLOSIVE_TYPE) explosive.push(sourced);
    });
  }

  return { byType, explosive };
}

/**
 * The block types present, in `program.sessionOrder`; any type the order does
 * not mention follows, in the order first met, so no block is ever lost.
 */
function orderedBlockTypes(program: Program, byType: Map<string, SourcedBlock[]>): string[] {
  const knownTypes = program.sessionOrder.filter((blockType) => byType.has(blockType));
  const otherTypes = [...byType.keys()].filter((blockType) => !program.sessionOrder.includes(blockType));
  return [...knownTypes, ...otherTypes];
}

/**
 * True for an explosive block that can alternate with another: every item is
 * plain straight sets. An EMOM (kettlebell swings) or an interval runs on a
 * clock, so a set of another exercise cannot be slotted into it.
 */
function isSetBased(block: BlockView): boolean {
  return block.items.every((item) => item.format === "straight sets");
}

/**
 * Lays out the explosive blocks (rule 4.2):
 *  - both set-based: one "alternate" block holding both days' parts;
 *  - otherwise: separate blocks, set-based ones first and clock-driven ones
 *    (EMOM, interval) after them, each group in day order.
 */
function arrangeExplosive(explosiveParts: SourcedBlock[], alternates: boolean): CombinedBlock[] {
  if (alternates) {
    return [{ type: EXPLOSIVE_TYPE, arrangement: "alternate", parts: explosiveParts }];
  }

  const setBasedFirst = [...explosiveParts.filter((part) => isSetBased(part.block)), ...explosiveParts.filter((part) => !isSetBased(part.block))];
  return setBasedFirst.map((part) => ({ type: EXPLOSIVE_TYPE, arrangement: "single" as const, parts: [part] }));
}

/**
 * Applies rule 4.4 to one core or finisher block: removes items with
 * `optional: true` and caps interval items' rounds at the bottom of their
 * range. Sets the flags in `dropped` when it really removed or reduced
 * something (a fixed 5-round wall sit is not "dropped"). Returns a new block;
 * the input is not changed.
 */
function dropExtras(block: BlockView, dropped: DroppedForTime): BlockView {
  const keptItems: ItemView[] = [];

  for (const item of block.items) {
    if (item.optional) {
      dropped.optionalItems = true;
      continue;
    }

    keptItems.push(capIntervalRounds(item, dropped));
  }

  return { ...block, items: keptItems };
}

/** An interval item with its rounds range cut to its minimum (4-5 becomes 4); any other item, or a fixed range, is returned as is. */
function capIntervalRounds(item: ItemView, dropped: DroppedForTime): ItemView {
  if (item.format !== "interval" || item.rounds === undefined || item.rounds.max <= item.rounds.min) {
    return item;
  }

  dropped.bagRounds = true;
  return { ...item, rounds: { min: item.rounds.min, max: item.rounds.min } };
}
