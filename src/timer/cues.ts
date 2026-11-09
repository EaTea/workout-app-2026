import type { TimerEvent } from "./engine";

/**
 * Sound and vibration cues for timers.
 *
 *   timerView ──onEvent(segmentStarted | finished)──▶ player.handleEvent ─┐
 *   timerView ──onSecondTick(remainingSec)──────────▶ player.handleSecond ─┤
 *                                                                          ▼
 *                              cue name ──▶ beep tones (Web Audio) + vibration
 *
 * Browsers (iOS especially) only allow audio after a user gesture, so
 * `prime()` must be called from the Start tap; it creates the one shared
 * AudioContext. Everything fails silently where unsupported. On iPhone the
 * ringer/silent switch mutes Web Audio, so beeps may be inaudible; the
 * vibration is not available on iOS Safari at all.
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
  /** Creates (or resumes) the audio context. Call from a user gesture such as the Start tap. */
  prime(): void;
  /** Plays the cue for an engine event. */
  handleEvent(event: TimerEvent): void;
  /** Plays a tick if this remaining-seconds value is one of the last three. */
  handleSecond(remainingSec: number): void;
}

/** Makes a real AudioContext where the browser has one (older Safari names it webkitAudioContext). */
function createBrowserAudioContext(): AudioContextLike | undefined {
  const scope = window as unknown as { AudioContext?: new () => AudioContextLike; webkitAudioContext?: new () => AudioContextLike };
  const AudioContextClass = scope.AudioContext ?? scope.webkitAudioContext;
  return AudioContextClass ? new AudioContextClass() : undefined;
}

/** Vibrates through navigator.vibrate when it exists; false otherwise. */
function vibrateWithBrowser(pattern: number[]): boolean {
  return typeof navigator.vibrate === "function" ? navigator.vibrate(pattern) : false;
}

/**
 * Creates the player used by one timer run. The audio context is created
 * lazily in `prime()` and shared by every cue afterwards.
 */
export function createCuePlayer(dependencies: CuePlayerDependencies = {}): CuePlayer {
  const createAudioContext = dependencies.createAudioContext ?? createBrowserAudioContext;
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
        if (audio && audio.state === "suspended") void audio.resume();
      } catch {
        audio = undefined;
      }
    },
    handleEvent(event) {
      play(cueForEvent(event));
    },
    handleSecond(remainingSec) {
      const cue = cueForRemainingSecond(remainingSec);
      if (cue) play(cue);
    },
  };
}
