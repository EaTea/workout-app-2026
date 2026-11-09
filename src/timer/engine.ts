/**
 * Pure timer state machine shared by every timer in the app (EMOM, heavy-bag
 * intervals, rest between sets). No DOM, no setTimeout: callers pass the
 * current wall-clock time (`now`, in ms) to every function, so the engine can
 * be unit-tested with a fake clock and stays correct when the phone sleeps
 * (a later `tick` simply catches up through every segment that has elapsed).
 *
 *            start            pause              resume
 *   ready ─────────▶ running ───────▶ paused ───────────▶ running
 *                      │  ▲              │
 *                      │  └── tick: next segment starts (event segmentStarted)
 *                      │
 *       last segment ends (tick) or skipped
 *                      ▼
 *                   finished  (event finished)
 *
 *   skip: jumps to the next segment from running or paused (keeps that
 *   status); skipping the last segment finishes the timer.
 *
 * Callers: ui/timerView.ts drives it from a 250ms loop and renders from the
 * state; later steps listen to the returned events to beep and vibrate.
 */

/** What the user should be doing during a segment. */
export type SegmentPhase = "work" | "rest" | "minute";

/** One stretch of a timer: e.g. "30s work, round 2 of 5". */
export interface TimerSegment {
  phase: SegmentPhase;
  durationSec: number;
  round: number;
  totalRounds: number;
  label: string;
}

/** A validated, non-empty list of segments plus a title. Build with `createTimerPlan`. */
export interface TimerPlan {
  title: string;
  segments: TimerSegment[];
}

/** ready = created but not started; the other three are the running lifecycle. */
export type TimerStatus = "ready" | "running" | "paused" | "finished";

/** Complete engine state. Treated as immutable: every function returns a new one. */
export interface TimerState {
  plan: TimerPlan;
  status: TimerStatus;
  segmentIndex: number;
  /** Milliseconds spent in the current segment (excludes paused time). */
  elapsedMs: number;
  /** `now` of the last update while running; null otherwise. */
  lastUpdateAt: number | null;
}

/** Something that happened during a transition, in order, for sound/vibration. */
export type TimerEvent =
  | { kind: "segmentStarted"; segment: TimerSegment; segmentIndex: number }
  | { kind: "finished" };

/** A new state plus the events that occurred to get there. */
export interface TimerUpdate {
  state: TimerState;
  events: TimerEvent[];
}

/** Everything the UI needs to draw one frame, derived from a state. */
export interface TimerView {
  segment: TimerSegment;
  segmentIndex: number;
  /** Whole seconds left in the segment, rounded up (0:01 shows until it ends). */
  remainingSec: number;
  round: number;
  totalRounds: number;
  /** 0..1 through the current segment. */
  segmentProgress: number;
  /** 0..1 through the whole plan. */
  overallProgress: number;
  status: TimerStatus;
}

/**
 * Validates and builds a plan. Rejects an empty list and any segment whose
 * duration is zero, negative or not a finite number, because such a segment
 * would either never end or end instantly and skip its beep.
 */
export function createTimerPlan(title: string, segments: TimerSegment[]): TimerPlan {
  if (segments.length === 0) {
    throw new Error("A timer plan needs at least one segment");
  }
  segments.forEach((segment, index) => {
    if (!Number.isFinite(segment.durationSec) || segment.durationSec <= 0) {
      throw new Error(`Segment ${index + 1} ("${segment.label}") must have a duration above zero`);
    }
  });
  return { title, segments: segments.map((segment) => ({ ...segment })) };
}

/** Creates the not-yet-started state for a plan. */
export function createTimerState(plan: TimerPlan): TimerState {
  return { plan, status: "ready", segmentIndex: 0, elapsedMs: 0, lastUpdateAt: null };
}

/** Starts a ready timer; emits segmentStarted for the first segment. Other statuses are returned unchanged. */
export function startTimer(state: TimerState, now: number): TimerUpdate {
  if (state.status !== "ready") return { state, events: [] };
  const started: TimerState = { ...state, status: "running", lastUpdateAt: now };
  return { state: started, events: [segmentStartedEvent(started)] };
}

/**
 * Advances a running timer to `now`, moving through as many segments as the
 * elapsed time covers (one tick after a 3 minute sleep may cross several).
 * Events come back in the order they happened. Not running: no change.
 */
export function tickTimer(state: TimerState, now: number): TimerUpdate {
  if (state.status !== "running" || state.lastUpdateAt === null) return { state, events: [] };

  // A clock that went backwards must not rewind the timer.
  const passedMs = Math.max(0, now - state.lastUpdateAt);
  let current: TimerState = { ...state, elapsedMs: state.elapsedMs + passedMs, lastUpdateAt: now };
  const events: TimerEvent[] = [];

  while (current.status === "running" && current.elapsedMs >= segmentDurationMs(current)) {
    const leftoverMs = current.elapsedMs - segmentDurationMs(current);
    const advanced = moveToNextSegment(current, leftoverMs);
    events.push(...advanced.events);
    current = advanced.state;
  }
  return { state: current, events };
}

/** Pauses a running timer (first catching up to `now`, which may finish it). Time stops counting. */
export function pauseTimer(state: TimerState, now: number): TimerUpdate {
  const caughtUp = tickTimer(state, now);
  if (caughtUp.state.status !== "running") return caughtUp;
  return { state: { ...caughtUp.state, status: "paused", lastUpdateAt: null }, events: caughtUp.events };
}

/** Resumes a paused timer; the time spent paused is not counted. */
export function resumeTimer(state: TimerState, now: number): TimerUpdate {
  if (state.status !== "paused") return { state, events: [] };
  return { state: { ...state, status: "running", lastUpdateAt: now }, events: [] };
}

/**
 * Jumps to the start of the next segment (or finishes, on the last one).
 * Works while running or paused and keeps that status. Ignored before start
 * and after finish.
 */
export function skipSegment(state: TimerState, now: number): TimerUpdate {
  const caughtUp = tickTimer(state, now);
  if (caughtUp.state.status !== "running" && caughtUp.state.status !== "paused") return caughtUp;

  const skipped = moveToNextSegment(caughtUp.state, 0);
  return { state: skipped.state, events: [...caughtUp.events, ...skipped.events] };
}

/** Derives everything a screen needs from a state. Finished timers show the last segment at 0. */
export function describeTimer(state: TimerState): TimerView {
  const { segments } = state.plan;
  const segment = segments[state.segmentIndex] as TimerSegment;
  const finished = state.status === "finished";
  const elapsedMs = finished ? segmentDurationMs(state) : state.elapsedMs;
  const remainingMs = Math.max(0, segmentDurationMs(state) - elapsedMs);

  const totalMs = segments.reduce((sum, each) => sum + each.durationSec * 1000, 0);
  const completedBeforeMs = segments
    .slice(0, state.segmentIndex)
    .reduce((sum, each) => sum + each.durationSec * 1000, 0);

  return {
    segment,
    segmentIndex: state.segmentIndex,
    remainingSec: Math.ceil(remainingMs / 1000),
    round: segment.round,
    totalRounds: segment.totalRounds,
    segmentProgress: elapsedMs / segmentDurationMs(state),
    overallProgress: Math.min(1, (completedBeforeMs + elapsedMs) / totalMs),
    status: state.status,
  };
}

/** Formats whole seconds as m:ss, e.g. 65 -> "1:05", 0 -> "0:00", 600 -> "10:00". */
export function formatClock(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** Length of the current segment in ms. */
function segmentDurationMs(state: TimerState): number {
  const segment = state.plan.segments[state.segmentIndex] as TimerSegment;
  return segment.durationSec * 1000;
}

/** The segmentStarted event for whichever segment the state is currently on. */
function segmentStartedEvent(state: TimerState): TimerEvent {
  return {
    kind: "segmentStarted",
    segment: state.plan.segments[state.segmentIndex] as TimerSegment,
    segmentIndex: state.segmentIndex,
  };
}

/** Shared by tick and skip: enters the next segment carrying `elapsedMs` over, or finishes after the last. */
function moveToNextSegment(state: TimerState, carriedElapsedMs: number): TimerUpdate {
  const isLastSegment = state.segmentIndex >= state.plan.segments.length - 1;
  if (isLastSegment) {
    const finished: TimerState = { ...state, status: "finished", elapsedMs: segmentDurationMs(state), lastUpdateAt: null };
    return { state: finished, events: [{ kind: "finished" }] };
  }
  const next: TimerState = { ...state, segmentIndex: state.segmentIndex + 1, elapsedMs: carriedElapsedMs };
  return { state: next, events: [segmentStartedEvent(next)] };
}
