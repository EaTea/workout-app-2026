import { describe, expect, it } from "vitest";
import { createCuePlayer, cueForEvent, cueForEventBatch, shareAudioContext, cueForRemainingSecond, tonesForCue, type AudioContextLike } from "./cues";
import type { TimerSegment } from "./engine";

const segment: TimerSegment = { phase: "minute", durationSec: 60, round: 1, totalRounds: 5, label: "Go" };

/** A fake audio context that records each oscillator's pitch and start time. */
function fakeAudio(state = "running") {
  const started: Array<{ frequencyHz: number; at: number }> = [];
  let resumed = 0;
  const context: AudioContextLike = {
    currentTime: 10,
    state,
    destination: {},
    resume() { resumed += 1; },
    createOscillator() {
      const oscillator = {
        frequency: { value: 0 },
        connect() {},
        start(at: number) { started.push({ frequencyHz: oscillator.frequency.value, at }); },
        stop() {},
      };
      return oscillator;
    },
    createGain() { return { gain: { value: 0 }, connect() {} }; },
  };
  return { context, started, resumedCount: () => resumed };
}

describe("which cue fires when", () => {
  it("a new segment gets the start cue and the end gets the finish cue", () => {
    expect(cueForEvent({ kind: "segmentStarted", segment, segmentIndex: 0 })).toBe("segmentStart");
    expect(cueForEvent({ kind: "finished" })).toBe("finish");
  });

  it("work and rest segments get their own start cues", () => {
    const work: TimerSegment = { ...segment, phase: "work" };
    const rest: TimerSegment = { ...segment, phase: "rest" };

    expect(cueForEvent({ kind: "segmentStarted", segment: work, segmentIndex: 0 })).toBe("workStart");
    expect(cueForEvent({ kind: "segmentStarted", segment: rest, segmentIndex: 1 })).toBe("restStart");
  });

  it("the rest beep is lower than the work beep", () => {
    expect(tonesForCue("restStart")[0]?.frequencyHz).toBeLessThan(tonesForCue("workStart")[0]?.frequencyHz ?? 0);
  });

  it("a batch of events plays only the cue for the last one", () => {
    const work: TimerSegment = { ...segment, phase: "work" };
    const rest: TimerSegment = { ...segment, phase: "rest" };

    expect(cueForEventBatch([])).toBeUndefined();
    expect(cueForEventBatch([{ kind: "segmentStarted", segment: work, segmentIndex: 0 }])).toBe("workStart");
    expect(
      cueForEventBatch([
        { kind: "segmentStarted", segment: work, segmentIndex: 0 },
        { kind: "segmentStarted", segment: rest, segmentIndex: 1 },
      ]),
    ).toBe("restStart");
    expect(
      cueForEventBatch([{ kind: "segmentStarted", segment: rest, segmentIndex: 1 }, { kind: "finished" }]),
    ).toBe("finish");
  });

  it("ticks only at 3, 2 and 1 seconds remaining", () => {
    const ticks = [60, 30, 4, 3, 2, 1, 0].map(cueForRemainingSecond);
    expect(ticks).toEqual([undefined, undefined, undefined, "countdownTick", "countdownTick", "countdownTick", undefined]);
  });

  it("the finish cue is a longer double beep than the minute beep", () => {
    expect(tonesForCue("finish")).toHaveLength(2);
    expect(tonesForCue("finish")[0]?.durationSec).toBeGreaterThan(tonesForCue("segmentStart")[0]?.durationSec ?? 0);
  });
});

describe("createCuePlayer", () => {
  it("plays nothing audible before prime, but still vibrates", () => {
    const audio = fakeAudio();
    const vibrations: number[][] = [];
    const player = createCuePlayer({ createAudioContext: () => audio.context, vibrate: (pattern) => (vibrations.push(pattern), true) });

    player.handleEvents([{ kind: "segmentStarted", segment, segmentIndex: 0 }]);

    expect(audio.started).toEqual([]);
    expect(vibrations).toEqual([[150]]);
  });

  it("after prime: beeps and vibration per cue, ticks without vibration", () => {
    const audio = fakeAudio();
    const vibrations: number[][] = [];
    const player = createCuePlayer({ createAudioContext: () => audio.context, vibrate: (pattern) => (vibrations.push(pattern), true) });
    player.prime();

    player.handleEvents([{ kind: "segmentStarted", segment, segmentIndex: 0 }]);
    player.handleSecond(3);
    player.handleSecond(30);
    player.handleEvents([{ kind: "finished" }]);

    expect(audio.started.map((tone) => tone.frequencyHz)).toEqual([880, 660, 1000, 1000]);
    expect(audio.started[3]?.at).toBeCloseTo(10.35);
    expect(vibrations).toEqual([[150], [300, 100, 300]]);
  });

  it("work start vibrates [150] and rest start vibrates [80, 60, 80]", () => {
    const audio = fakeAudio();
    const vibrations: number[][] = [];
    const player = createCuePlayer({ createAudioContext: () => audio.context, vibrate: (pattern) => (vibrations.push(pattern), true) });
    player.prime();

    player.handleEvents([{ kind: "segmentStarted", segment: { ...segment, phase: "work" }, segmentIndex: 0 }]);
    player.handleEvents([{ kind: "segmentStarted", segment: { ...segment, phase: "rest" }, segmentIndex: 1 }]);

    expect(vibrations).toEqual([[150], [80, 60, 80]]);
    expect(audio.started.map((tone) => tone.frequencyHz)).toEqual([1175, 523]);
  });

  it("creates one context and resumes a suspended one", () => {
    const audio = fakeAudio("suspended");
    let created = 0;
    const player = createCuePlayer({ createAudioContext: () => (created += 1, audio.context) });

    player.prime();
    player.prime();

    expect(created).toBe(1);
    expect(audio.resumedCount()).toBe(2);
  });

  it("an interrupted context is resumed too", () => {
    const audio = fakeAudio("interrupted");
    const player = createCuePlayer({ createAudioContext: () => audio.context });

    player.prime();

    expect(audio.resumedCount()).toBe(1);
  });

  it("a catch-up batch beeps and vibrates once, for the latest event only", () => {
    const audio = fakeAudio();
    const vibrations: number[][] = [];
    const player = createCuePlayer({ createAudioContext: () => audio.context, vibrate: (pattern) => (vibrations.push(pattern), true) });
    player.prime();

    player.handleEvents([
      { kind: "segmentStarted", segment: { ...segment, phase: "work" }, segmentIndex: 2 },
      { kind: "segmentStarted", segment: { ...segment, phase: "rest" }, segmentIndex: 3 },
    ]);

    expect(audio.started.map((tone) => tone.frequencyHz)).toEqual([523]);
    expect(vibrations).toEqual([[80, 60, 80]]);
  });

  it("two players built on one shared context getter create a single context", () => {
    const audio = fakeAudio();
    let created = 0;
    const getShared = shareAudioContext(() => (created += 1, audio.context));
    const firstPlayer = createCuePlayer({ createAudioContext: getShared });
    const secondPlayer = createCuePlayer({ createAudioContext: getShared });

    firstPlayer.prime();
    secondPlayer.prime();
    secondPlayer.handleEvents([{ kind: "finished" }]);

    expect(created).toBe(1);
    expect(audio.started).toHaveLength(2);
  });

  it("remembers that no context is available instead of retrying", () => {
    let attempts = 0;
    const getShared = shareAudioContext(() => (attempts += 1, undefined));

    getShared();
    getShared();

    expect(attempts).toBe(1);
  });

  it("fails silently when audio and vibration are unsupported or throw", () => {
    const player = createCuePlayer({
      createAudioContext: () => { throw new Error("no audio"); },
      vibrate: () => { throw new Error("no vibrate"); },
    });

    expect(() => {
      player.prime();
      player.handleEvents([{ kind: "finished" }]);
      player.handleSecond(1);
    }).not.toThrow();
  });
});
