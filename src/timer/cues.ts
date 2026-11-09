import type { TimerEvent } from "./engine";

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
 * `CuePlayer.handleEvents`. (Countdown ticks for jumped-over seconds never
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

/** The slice of the Web Audio API the player uses, so tests can fake it. */
export interface AudioContextLike {
  currentTime: number;
  state: string;
  destination: unknown;
  resume(): Promise<void> | void;
  createOscillator(): {
    frequency: { value: number };
    connect(destination: unknown): void;
    start(when: number): void;
    stop(when: number): void;
  };
  createGain(): { gain: { value: number }; connect(destination: unknown): void };
}

/** Things the player needs from the browser; defaults are the real ones. */
export interface CuePlayerDependencies {
  createAudioContext?: () => AudioContextLike | undefined;
  vibrate?: (pattern: number[]) => boolean;
}

/** What the timer screen calls. */
export interface CuePlayer {
  /** Creates the shared audio context if needed and resumes it if suspended/interrupted. Call from every user tap. */
  prime(): void;
  /** Plays the one cue for the latest of the events from a single engine update (and vibrates for it only). */
  handleEvents(events: TimerEvent[]): void;
  /** Plays a tick if this remaining-seconds value is one of the last three. */
  handleSecond(remainingSec: number): void;
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

  /** Plays one beep on the shared context, scheduled `startOffsetSec` from now. */
  function playTone(context: AudioContextLike, tone: Tone): void {
    const oscillator = context.createOscillator();
    const volume = context.createGain();
    oscillator.frequency.value = tone.frequencyHz;
    volume.gain.value = 0.3;
    oscillator.connect(volume);
    volume.connect(context.destination);

    const startAt = context.currentTime + tone.startOffsetSec;
    oscillator.start(startAt);
    oscillator.stop(startAt + tone.durationSec);
  }

  /** Beeps and vibrates for a cue; any browser failure is swallowed so a timer never breaks over sound. */
  function play(cue: CueName): void {
    try {
      if (audio) {
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

  return {
    prime() {
      try {
        audio ??= createAudioContext();
        // iOS reports "interrupted" after a call or lock; both need a resume() from a tap.
        if (audio && (audio.state === "suspended" || audio.state === "interrupted")) {
          void Promise.resolve(audio.resume()).catch(() => undefined);
        }
      } catch {
        audio = undefined;
      }
    },
    handleEvents(events) {
      const cue = cueForEventBatch(events);
      if (cue) play(cue);
    },
    handleSecond(remainingSec) {
      const cue = cueForRemainingSecond(remainingSec);
      if (cue) play(cue);
    },
  };
}
