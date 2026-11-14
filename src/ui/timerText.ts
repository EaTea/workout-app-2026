import type { SegmentPhase, TimerStatus } from "../timer/engine";

/**
 * Small pure helpers that choose the words the timer overlay (timerView.ts)
 * shows, so the choices can be unit tested without a DOM. The gear-up break
 * before round 1 of an interval timer reads differently from the rounds:
 *
 *   phase     big word   round line                        Skip button
 *   gearUp    GEAR UP    Round 1 starts after the countdown  Ready ›
 *   work      WORK       Round 2 of 5                        Skip ›
 *   rest      REST       Round 2 of 5                        Skip ›
 */

/** The big word for a phase; "" for the EMOM minute style, which draws a ring instead. A finished timer says DONE. */
export function phaseWordFor(phase: SegmentPhase, isFinished: boolean): string {
  if (isFinished) return "DONE";
  if (phase === "gearUp") return "GEAR UP";
  if (phase === "work") return "WORK";
  if (phase === "rest") return "REST";
  return "";
}

/** The round line under the clock: gear-up is not a round, so it announces round 1 instead of counting. */
export function roundCounterText(phase: SegmentPhase, round: number, totalRounds: number): string {
  if (phase === "gearUp") return "Round 1 starts after the countdown";
  return `Round ${round} of ${totalRounds}`;
}

/**
 * True while the Skip button acts as "Ready": the timer is running or paused
 * in the gear-up. Before Start the gear-up is the current segment too, but
 * the button is disabled then and stays the normal Skip.
 */
function isReadyButton(phase: SegmentPhase, status: TimerStatus): boolean {
  return phase === "gearUp" && (status === "running" || status === "paused");
}

/** The Skip button's visible text: "Ready ›" during a started gear-up (it starts round 1), otherwise "Skip ›". */
export function skipButtonText(phase: SegmentPhase, status: TimerStatus): string {
  return isReadyButton(phase, status) ? "Ready ›" : "Skip ›";
}

/** The Skip button's accessible name when it differs from its text: only for the started gear-up; otherwise undefined (the text is the name). */
export function skipButtonAccessibleName(phase: SegmentPhase, status: TimerStatus): string | undefined {
  return isReadyButton(phase, status) ? "Ready, start round 1" : undefined;
}
