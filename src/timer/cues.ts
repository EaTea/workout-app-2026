import type { TimerEvent, TimerState } from "./engine";

/**
 * Sound and vibration cues for timers.
 *
 *   timerView ──onEvents([segmentStarted | finished, ...])──▶ player.handleEvents ─┐
 *   timerView ──onSecondTick(remainingSec)─────────────────────▶ player.handleSecond ─┤
 *                                                                                      ▼
 *                                          cue name ──▶ beep tones (Web Audio) + vibration
 *
 * Browsers (iOS especially) only allow audio after a user gesture, so
 * `prime()` is called from every tap in the timer view. There is ONE
 * AudioContext for the whole app (browsers cap how many may be alive, and
 * beeps go silent past the cap), created lazily by the first prime() and
 * shared by every player; prime() also resumes it if the browser suspended
 * or interrupted it (iOS does after a call or a lock). Where Safari's
 * `navigator.audioSession` exists the page asks for "playback" so beeps
 * play through the silent switch; older iOS may still mute them. Everything
 * fails silently where unsupported. Vibration is not available on iOS Safari.
 *
 * Scheduling on the audio clock: a hidden or throttled page runs its 250ms
 * loop late, so tick-driven beeps would sound late. Instead, whenever a
 * timer starts, resumes or is skipped, `scheduleFrom(state)` queues every
 * FUTURE tone of the whole plan on the AudioContext timeline, at
 * `context.currentTime + seconds until it is due`:
 *
 *   now                         end of seg 1                end of seg 2
 *    |--- 3 2 1 ------------------|--- 3 2 1 ----------------|
 *    ^ scheduleFrom()          ticks (660Hz)  boundary tone (start cue of seg 2 / finish)
 *
 * The page's ticks still run for the display and vibration, but a cue whose
 * tone is already scheduled is not played again by `handleEvents` /
 * `handleSecond` (tracked by key: "start:<index>", "finish",
 * "tick:<index>:<second>"). Pause, Skip, a stepper change and close call
 * `cancelScheduled()`, which stops and disconnects every queued tone.
 *
 * The audio clock can stop while the wall clock keeps going (iOS suspends or
 * interrupts the context on lock, an app switch or a call). Tones queued
 * before that would all be late by the length of the gap, so the player
 * remembers an anchor (audio time, wall time) when it schedules and reports
 * `isScheduleStale()` when the context is no longer running or the two
 * clocks disagree by more than `MAX_CLOCK_DRIFT_SEC`. The timer view then
 * cancels, lets the catch-up play the latest cue through the tick path, and
 * schedules again. Nothing is recorded as scheduled while the context isn't
 * running, so the tick path plays the cues in the meantime.
 *
 * After the page sleeps one update can carry many events; only the cue for
 * the latest one is played (see `cueForEventBatch`) so Ed hears one beep,
 * not a burst.
 */

/**
 * The cues timers use. segmentStart is the EMOM minute beep; workStart and
 * restStart tell intervals apart by ear (high and long-buzz for work, lower
 * and double-tap for rest) so Ed needn't look at the screen.
 */
export type CueName = "segmentStart" | "workStart" | "restStart" | "countdownTick" | "finish";

/** One beep: pitch, when it starts relative to the cue, and how long it lasts. */
export interface Tone {
  frequencyHz: number;
  startOffsetSec: number;
  durationSec: number;
}

/** Seconds before a segment ends at which a tick sounds (3, 2, 1). */
const COUNTDOWN_TICK_SECONDS = [3, 2, 1];

/** How far (seconds) the audio clock may drift from the wall clock before the schedule is rebuilt. */
const MAX_CLOCK_DRIFT_SEC = 0.25;

/** The beeps for each cue: short high beep, soft tick, long double beep. */
const TONES: Record<CueName, Tone[]> = {
  segmentStart: [{ frequencyHz: 880, startOffsetSec: 0, durationSec: 0.15 }],
  workStart: [{ frequencyHz: 1175, startOffsetSec: 0, durationSec: 0.2 }],
  restStart: [{ frequencyHz: 523, startOffsetSec: 0, durationSec: 0.2 }],
  countdownTick: [{ frequencyHz: 660, startOffsetSec: 0, durationSec: 0.06 }],
  finish: [
    { frequencyHz: 1000, startOffsetSec: 0, durationSec: 0.25 },
    { frequencyHz: 1000, startOffsetSec: 0.35, durationSec: 0.25 },
  ],
};

/** Vibration patterns in ms; a cue without an entry does not vibrate. */
const VIBRATION: Partial<Record<CueName, number[]>> = {
  segmentStart: [150],
  workStart: [150],
  restStart: [80, 60, 80],
  finish: [300, 100, 300],
};

/** Which cue an engine event should trigger: finish, or a start cue matching the new segment's phase. */
export function cueForEvent(event: TimerEvent): CueName {
  if (event.kind === "finished") return "finish";
  if (event.segment.phase === "work") return "workStart";
  if (event.segment.phase === "rest") return "restStart";
  return "segmentStart";
}

/**
 * Which single cue to play for a batch of events from one engine update: the
 * cue for the LAST event, or undefined for an empty batch. After the page was
 * hidden, one update can jump several segments; replaying every start cue
 * would be a noisy burst about things that already happened. Used by
 * `CuePlayer.handleEvents` (the path taken for cues that are not already
 * scheduled on the audio clock, e.g. when the audio context isn't running). (Countdown ticks for jumped-over seconds never
 * play either: ticks are only reported for the second currently displayed.)
 */
export function cueForEventBatch(events: TimerEvent[]): CueName | undefined {
  const lastEvent = events[events.length - 1];
  return lastEvent ? cueForEvent(lastEvent) : undefined;
}

/** Which cue (if any) a newly displayed remaining-seconds value should trigger: ticks at 3, 2 and 1. */
export function cueForRemainingSecond(remainingSec: number): CueName | undefined {
  return COUNTDOWN_TICK_SECONDS.includes(remainingSec) ? "countdownTick" : undefined;
}

/** The beeps a cue plays. Exposed so tests can check the sound design without audio. */
export function tonesForCue(cue: CueName): Tone[] {
  return TONES[cue];
}

/** One tone-producing cue due `atSec` seconds after the schedule was made, with a key for de-duplication. */
export interface ScheduledCue {
  atSec: number;
  cue: CueName;
  /** "start:<segmentIndex>", "finish" or "tick:<segmentIndex>:<secondsRemaining>". */
  key: string;
}

/** The de-duplication key for the cue an engine event triggers; matches the keys in `buildCueTimeline`. */
export function keyForEvent(event: TimerEvent): string {
  return event.kind === "finished" ? "finish" : `start:${event.segmentIndex}`;
}

/**
 * Lists every tone still to come for a running timer, in time order, with
 * times in seconds from the state's last update. For the current segment
 * that is its 3-2-1 ticks still ahead; for every segment, the tick trio
 * (if the segment is long enough to show them) and the tone for what
 * follows it (next segment's start cue, or finish after the last). The
 * current segment's own start cue is not included: it already sounded.
 * Pure; used by `CuePlayer.scheduleFrom` and by tests.
 */
export function buildCueTimeline(state: TimerState): ScheduledCue[] {
  const { segments } = state.plan;
  const cues: ScheduledCue[] = [];
  let segmentStartSec = 0;

  for (let index = state.segmentIndex; index < segments.length; index += 1) {
    const segment = segments[index];
    if (!segment) break;

    const isCurrent = index === state.segmentIndex;
    const segmentEndSec = isCurrent ? Math.max(0, segment.durationSec - state.elapsedMs / 1000) : segmentStartSec + segment.durationSec;

    for (const secondsLeft of COUNTDOWN_TICK_SECONDS) {
      const atSec = segmentEndSec - secondsLeft;
      // In the current segment a tick due exactly now already played (e.g. paused on a whole
      // second), so it is excluded; in later segments the start of the segment is still ahead.
      const isStillAhead = isCurrent ? atSec > segmentStartSec : atSec >= segmentStartSec;
      if (isStillAhead) {
        cues.push({ atSec, cue: "countdownTick", key: `tick:${index}:${secondsLeft}` });
      }
    }

    const nextSegment = segments[index + 1];
    const event: TimerEvent = nextSegment
      ? { kind: "segmentStarted", segment: nextSegment, segmentIndex: index + 1 }
      : { kind: "finished" };
    cues.push({ atSec: segmentEndSec, cue: cueForEvent(event), key: keyForEvent(event) });

    segmentStartSec = segmentEndSec;
  }
  return cues;
}

/** The slice of the Web Audio API the player uses, so tests can fake it. */
export interface AudioContextLike {
  currentTime: number;
  state: string;
  destination: unknown;
  resume(): Promise<void> | void;
  /** Optional: real contexts fire "statechange" when iOS suspends or interrupts them. */
  addEventListener?(type: "statechange", listener: () => void): void;
  removeEventListener?(type: "statechange", listener: () => void): void;
  createOscillator(): {
    frequency: { value: number };
    connect(destination: unknown): void;
    start(when: number): void;
    stop(when: number): void;
    disconnect(): void;
  };
  createGain(): { gain: { value: number }; connect(destination: unknown): void; disconnect(): void };
}

/** Things the player needs from the browser; defaults are the real ones. */
export interface CuePlayerDependencies {
  createAudioContext?: () => AudioContextLike | undefined;
  vibrate?: (pattern: number[]) => boolean;
  /** Wall clock in ms; defaults to Date.now. Tests freeze or move it to simulate drift. */
  now?: () => number;
}

/** What the timer screen calls. */
export interface CuePlayer {
  /** Creates the shared audio context if needed and resumes it if suspended/interrupted. Call from every user tap. */
  prime(): void;
  /**
   * Plays the one cue for the latest of the events from a single engine update
   * (and vibrates for it only). The tone is suppressed when it is already
   * scheduled on the audio clock; vibration always happens.
   */
  handleEvents(events: TimerEvent[]): void;
  /** Plays a tick if this remaining-seconds value is one of the last three, unless its tone is already scheduled. */
  handleSecond(remainingSec: number): void;
  /**
   * Replaces anything scheduled with every future tone of the running `state`'s
   * plan, on the audio clock (see the header). Call when a timer starts,
   * resumes or is skipped, after the state is updated.
   */
  scheduleFrom(state: TimerState): void;
  /** Stops and disconnects every scheduled tone and forgets them. Call on pause, Skip, stepper change and close. */
  cancelScheduled(): void;
  /**
   * True when a schedule was wanted but can't be trusted: the context stopped
   * running, never accepted the schedule, or its clock drifted from the wall
   * clock. The timer view then cancels, catches up and calls `scheduleFrom`
   * again. Always false without audio or when nothing is scheduled.
   */
  isScheduleStale(): boolean;
  /** Calls `listener` when the audio context changes state (iOS suspend/interrupt/resume); returns an unsubscribe function. */
  onAudioStateChange(listener: () => void): () => void;
}

/**
 * Asks Safari 16.4+ to treat the page's audio as "playback" so it ignores the
 * silent switch. Feature-detected and best effort: other browsers lack
 * `navigator.audioSession`, and any error is ignored.
 */
function requestPlaybackAudioSession(): void {
  try {
    const audioSession = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
    if (audioSession) audioSession.type = "playback";
  } catch {
    // Not supported: beeps may be muted by the silent switch, nothing else.
  }
}

/** Makes a real AudioContext where the browser has one (older Safari names it webkitAudioContext). */
function createBrowserAudioContext(): AudioContextLike | undefined {
  requestPlaybackAudioSession();
  const scope = window as unknown as { AudioContext?: new () => AudioContextLike; webkitAudioContext?: new () => AudioContextLike };
  const AudioContextClass = scope.AudioContext ?? scope.webkitAudioContext;
  return AudioContextClass ? new AudioContextClass() : undefined;
}

/** Vibrates through navigator.vibrate when it exists; false otherwise. */
function vibrateWithBrowser(pattern: number[]): boolean {
  return typeof navigator.vibrate === "function" ? navigator.vibrate(pattern) : false;
}

/**
 * Wraps a context factory so it runs at most once and every caller gets the
 * same context (including "no context available", so an unsupported browser
 * is not retried on every tap). Errors from the factory are not cached.
 * Used for the app-wide context below; exported so tests can check sharing.
 */
export function shareAudioContext(create: () => AudioContextLike | undefined): () => AudioContextLike | undefined {
  let hasCreated = false;
  let shared: AudioContextLike | undefined;

  return () => {
    if (!hasCreated) {
      shared = create();
      hasCreated = true;
    }
    return shared;
  };
}

/** The app-wide context: every timer's player uses this unless a test injects its own factory. */
const getAppAudioContext = shareAudioContext(createBrowserAudioContext);

/**
 * Creates the player used by one timer run. The audio context comes from
 * the app-wide shared getter (created on the first `prime()`, i.e. the first
 * user tap) so opening many timers never creates more than one context.
 * Called by the Start buttons on Today, once per opened timer.
 */
export function createCuePlayer(dependencies: CuePlayerDependencies = {}): CuePlayer {
  const createAudioContext = dependencies.createAudioContext ?? getAppAudioContext;
  const vibrate = dependencies.vibrate ?? vibrateWithBrowser;
  let audio: AudioContextLike | undefined;

  /** A tone queued on the audio clock, kept so it can be cancelled. */
  interface QueuedTone {
    stop(): void;
  }
  let queuedTones: QueuedTone[] = [];
  /** Keys (see `ScheduledCue.key`) of cues whose tone is already queued; the tick path must not replay them. */
  let scheduledKeys = new Set<string>();
  /** Segment the timer is in, learned from events and `scheduleFrom`; qualifies countdown tick keys. */
  let currentSegmentIndex: number | undefined;
  /** Audio and wall time at the moment the schedule was queued; undefined when nothing is queued. */
  let anchor: { audioTimeSec: number; wallTimeMs: number } | undefined;
  /** True from a `scheduleFrom` of a running timer until the next cancel: the view expects tones to be queued. */
  let isScheduleWanted = false;
  const readWallClock = dependencies.now ?? Date.now;
  const stateChangeListeners = new Set<() => void>();
  /** Fires every `onAudioStateChange` listener; attached to the context when it is created. */
  const notifyStateChange = (): void => {
    for (const listener of [...stateChangeListeners]) listener();
  };

  /**
   * Queues one beep on the shared context, `delaySec` from now, and returns
   * a handle that silences and disconnects it (used by `cancelScheduled`).
   */
  function playTone(context: AudioContextLike, tone: Tone, delaySec = 0): QueuedTone {
    const oscillator = context.createOscillator();
    const volume = context.createGain();
    oscillator.frequency.value = tone.frequencyHz;
    volume.gain.value = 0.3;
    oscillator.connect(volume);
    volume.connect(context.destination);

    const startAt = context.currentTime + delaySec + tone.startOffsetSec;
    oscillator.start(startAt);
    oscillator.stop(startAt + tone.durationSec);

    return {
      stop() {
        // Disconnect first: it silences the tone even if stop() then throws.
        // Separate blocks so one failure doesn't leave the other undone.
        try {
          oscillator.disconnect();
        } catch {
          // Already disconnected.
        }
        try {
          volume.disconnect();
        } catch {
          // Already disconnected.
        }
        try {
          oscillator.stop(0);
        } catch {
          // Already ended or never started: nothing left to stop.
        }
      },
    };
  }

  /**
   * Vibrates for a cue and, unless its tone was already scheduled on the
   * audio clock (`isAlreadyScheduled`), beeps now. Browser failures are
   * swallowed so a timer never breaks over sound.
   */
  function play(cue: CueName, isAlreadyScheduled = false): void {
    try {
      if (audio && !isAlreadyScheduled) {
        for (const tone of TONES[cue]) playTone(audio, tone);
      }
    } catch {
      // Audio is a nicety: ignore failures.
    }
    try {
      const pattern = VIBRATION[cue];
      if (pattern) vibrate(pattern);
    } catch {
      // Vibration is a nicety too.
    }
  }

  /** Silences everything queued and forgets it, so the tick path takes over again. */
  function cancelScheduled(): void {
    for (const queued of queuedTones) queued.stop();
    queuedTones = [];
    scheduledKeys = new Set();
    anchor = undefined;
    isScheduleWanted = false;
  }

  return {
    prime() {
      try {
        if (!audio) {
          audio = createAudioContext();
          audio?.addEventListener?.("statechange", notifyStateChange);
        }
        // iOS reports "interrupted" after a call or lock; both need a resume() from a tap.
        if (audio && (audio.state === "suspended" || audio.state === "interrupted")) {
          void Promise.resolve(audio.resume()).catch(() => undefined);
        }
      } catch {
        audio = undefined;
      }
    },
    handleEvents(events) {
      const lastEvent = events[events.length - 1];
      const cue = cueForEventBatch(events);
      if (!lastEvent || !cue) return;

      currentSegmentIndex = lastEvent.kind === "segmentStarted" ? lastEvent.segmentIndex : undefined;
      play(cue, scheduledKeys.has(keyForEvent(lastEvent)));
    },
    handleSecond(remainingSec) {
      const cue = cueForRemainingSecond(remainingSec);
      if (cue) play(cue, scheduledKeys.has(`tick:${currentSegmentIndex}:${remainingSec}`));
    },
    scheduleFrom(state) {
      cancelScheduled();
      currentSegmentIndex = state.segmentIndex;
      if (!audio || state.status !== "running") return;

      isScheduleWanted = true;
      // A context that isn't running would hold the tones back and then play them late:
      // queue nothing and leave the cues to the tick path until it runs again.
      if (audio.state !== "running") return;

      try {
        anchor = { audioTimeSec: audio.currentTime, wallTimeMs: readWallClock() };
        for (const scheduled of buildCueTimeline(state)) {
          for (const tone of TONES[scheduled.cue]) queuedTones.push(playTone(audio, tone, scheduled.atSec));
          scheduledKeys.add(scheduled.key);
        }
      } catch {
        // Audio failed part-way: drop what was queued so the tick path beeps instead.
        cancelScheduled();
      }
    },
    cancelScheduled,
    isScheduleStale() {
      if (!audio || !isScheduleWanted) return false;
      if (audio.state !== "running" || !anchor) return true;

      const audioElapsedSec = audio.currentTime - anchor.audioTimeSec;
      const wallElapsedSec = (readWallClock() - anchor.wallTimeMs) / 1000;
      return Math.abs(wallElapsedSec - audioElapsedSec) > MAX_CLOCK_DRIFT_SEC;
    },
    onAudioStateChange(listener) {
      stateChangeListeners.add(listener);
      return () => stateChangeListeners.delete(listener);
    },
  };
}
