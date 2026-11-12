import type { Combine, CombinesByDate } from "../combine/model";
import type { WorkoutLog } from "../log/model";
import { combineSessions, type CombinedSession } from "../program/combine";
import { activeCombineOn } from "../program/combineOffers";
import { applyNoEquipmentChoices } from "../program/noEquipment";
import type { Program } from "../program/model";
import { buildSession, type SessionView } from "../program/schedule";
import type { TrainingSettings } from "../settings/model";
import { noEquipmentChoices } from "./choices";
import type { NoEquipmentTicks } from "./model";
import { ticksForDate } from "./storage";

/** A date's session with its "No equipment" choices applied, plus which choices logged sets have locked. */
export interface SwappedSession {
  /** The session to show and count: swapped items carry the swap's exercise and dose. */
  session: SessionView;

  /** Item keys (`noEquipmentItemKey`) whose choice is fixed by logged sets; their tick is disabled. */
  locked: ReadonlySet<string>;
}

/**
 * Builds the session for `date` the way every screen that shows or counts
 * sets must: buildSession, then decide swapped/locked items from the log and
 * the ticks, then apply the swaps.
 *
 *   buildSession ─▶ noEquipmentChoices(log, ticks of date) ─▶ applyNoEquipmentChoices ─▶ Today,
 *                                      └─ locked ───────────────────────────────────▶   log screen,
 *                                                                                       wake lock
 *
 * Used by Today, the log screen and app.ts's wake-lock check, so they agree
 * on which exercise id an item's sets belong to. The day plan and overview
 * deliberately keep using the plain `buildSession`. Throws what `buildSession`
 * throws (a program gap on the date).
 */
export function buildSwappedSession(
  program: Program,
  settings: TrainingSettings,
  log: WorkoutLog,
  ticks: NoEquipmentTicks,
  date: string,
): SwappedSession {
  const unswappedSession = buildSession(program, settings, date);
  const choices = noEquipmentChoices(unswappedSession, log, date, ticksForDate(ticks, date));

  return {
    session: applyNoEquipmentChoices(unswappedSession, choices.swapped),
    locked: choices.locked,
  };
}

/** A combined date's session with its "No equipment" choices applied, plus which choices logged sets have locked. */
export interface SwappedCombinedSession {
  /** The merged session to show and count. */
  session: CombinedSession;

  /** Day-qualified item keys (`noEquipmentItemKey` with the day) whose choice is fixed by logged sets. */
  locked: ReadonlySet<string>;
}

/**
 * The combined counterpart of `buildSwappedSession`: builds each of the two
 * days' sessions the way Today always does (`buildSession` for its own date,
 * so deload halving, power-endurance changes, max-rep targets and the rest
 * are already applied), applies each day's "No equipment" choices, then merges
 * them (`combineSessions`).
 *
 *   buildSession(host date)  ─▶ choices ─▶ swaps ─┐
 *                                                 ├─▶ combineSessions ─▶ CombinedSession
 *   buildSession(added date) ─▶ choices ─▶ swaps ─┘
 *
 * Both days' sets live on the HOST date (each carrying its own `day`), so
 * the log is always read for `hostDate`; the tick keys are day-qualified
 * ("2.3:single_leg_rdl") because both days have a block 3. Throws what
 * `buildSession` or `combineSessions` throws; callers go through
 * `buildSwappedSessionFor`, which only combines a still-valid combine.
 */
export function buildSwappedCombinedSession(
  program: Program,
  settings: TrainingSettings,
  log: WorkoutLog,
  ticks: NoEquipmentTicks,
  hostDate: string,
  combine: Combine,
): SwappedCombinedSession {
  const locked = new Set<string>();
  const ticksOfHostDate = ticksForDate(ticks, hostDate);

  /** One day's plain session for `dateOfDay`, with its swaps applied and its locked keys collected. */
  function swappedDay(dateOfDay: string): SessionView {
    const unswapped = buildSession(program, settings, dateOfDay);
    const choices = noEquipmentChoices(unswapped, log, hostDate, ticksOfHostDate, true);
    for (const key of choices.locked) locked.add(key);
    return applyNoEquipmentChoices(unswapped, choices.swapped, true);
  }

  const hostSession = swappedDay(hostDate);
  const addedSession = swappedDay(combine.addedDate);

  return { session: combineSessions(program, hostSession, addedSession), locked };
}

/** What a date shows: a normal session or, when two days were combined on it, the merged one. */
export interface SessionForDate {
  session: SessionView | CombinedSession;

  /** Item keys fixed by logged sets (day-qualified when `session` is combined). */
  locked: ReadonlySet<string>;
}

/**
 * Builds whatever session `date` shows: the combined session when a still
 * valid combine is stored for the date (`activeCombineOn`), else the normal
 * swapped session. Used by Today, the log screen and app.ts's wake-lock
 * check, so all three agree on which rows exist and which day each belongs to.
 * A stale combine (e.g. the start date moved) is ignored, never an error.
 */
export function buildSwappedSessionFor(
  program: Program,
  settings: TrainingSettings,
  log: WorkoutLog,
  ticks: NoEquipmentTicks,
  combines: CombinesByDate,
  date: string,
): SessionForDate {
  const combine = activeCombineOn(program, settings.startDate, date, combines);
  if (combine !== undefined) return buildSwappedCombinedSession(program, settings, log, ticks, date, combine);

  return buildSwappedSession(program, settings, log, ticks, date);
}
