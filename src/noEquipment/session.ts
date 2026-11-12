import type { WorkoutLog } from "../log/model";
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
