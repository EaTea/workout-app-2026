import { describe, expect, it } from "vitest";
import { buildCueTimeline, createCuePlayer, cueForEvent, cueForEventBatch, shareAudioContext, cueForRemainingSecond, tonesForCue, type AudioContextLike } from "./cues";
import { createTimerPlan, createTimerState, pauseTimer, resumeTimer, startTimer, type TimerSegment } from "./engine";

const segment: TimerSegment = { phase: "minute", durationSec: 60, round: 1, totalRounds: 5, label: "Go" };

/** A fake audio context that records each oscillator's pitch and start time. */
function fakeAudio(state = "running") {
  const started: Array<{ frequencyHz: number; at: number; stoppedAt?: number; disconnected: boolean }> = [];
  let resumed = 0;
  const context: AudioContextLike = {
    currentTime: 10,
    state,
    destination: {},
    resume() { resumed += 1; },
    createOscillator() {
      let record: (typeof started)[number] | undefined;
      const oscillator = {
        frequency: { value: 0 },
        connect() {},
        start(at: number) { record = { frequencyHz: oscillator.frequency.value, at, disconnected: false }; started.push(record); },
        stop(at: number) { if (record) record.stoppedAt = at; },
        disconnect() { if (record) record.disconnected = true; },
      };
      return oscillator;
    },
    createGain() { return { gain: { value: 0 }, connect() {}, disconnect() {} }; },
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

/** A work 10s / rest 5s / work 10s plan, started at time 0 (so `elapsedMs` is 0 and the state is running). */
function runningPlanState() {
  const work: TimerSegment = { phase: "work", durationSec: 10, round: 1, totalRounds: 2, label: "Work" };
  const rest: TimerSegment = { phase: "rest", durationSec: 5, round: 1, totalRounds: 2, label: "Rest" };
  const plan = createTimerPlan("Test", [work, rest, { ...work, round: 2 }]);
  return startTimer(createTimerState(plan), 0).state;
}

describe("scheduling on the audio clock", () => {
  it("the timeline lists ticks and boundary tones with their due times", () => {
    const timeline = buildCueTimeline(runningPlanState()).map((entry) => [entry.atSec, entry.cue, entry.key]);

    expect(timeline).toEqual([
      [7, "countdownTick", "tick:0:3"], [8, "countdownTick", "tick:0:2"], [9, "countdownTick", "tick:0:1"],
      [10, "restStart", "start:1"],
      [12, "countdownTick", "tick:1:3"], [13, "countdownTick", "tick:1:2"], [14, "countdownTick", "tick:1:1"],
      [15, "workStart", "start:2"],
      [22, "countdownTick", "tick:2:3"], [23, "countdownTick", "tick:2:2"], [24, "countdownTick", "tick:2:1"],
      [25, "finish", "finish"],
    ]);
  });

  it("segments shorter than three seconds get only the ticks that fit", () => {
    const quick: TimerSegment = { ...segment, durationSec: 2 };
    const state = startTimer(createTimerState(createTimerPlan("Quick", [quick])), 0).state;

    expect(buildCueTimeline(state).map((entry) => entry.key)).toEqual(["tick:0:2", "tick:0:1", "finish"]);
  });

  it("scheduleFrom queues tones at currentTime plus the time remaining", () => {
    const audio = fakeAudio();
    const player = createCuePlayer({ createAudioContext: () => audio.context });
    player.prime();

    player.scheduleFrom(runningPlanState());

    // currentTime is 10 in the fake; the first tick is 7s into the segment, the rest beep at 10s.
    expect(audio.started[0]).toMatchObject({ frequencyHz: 660, at: 17 });
    expect(audio.started.find((tone) => tone.frequencyHz === 523)?.at).toBe(20);
    const finishTones = audio.started.filter((tone) => tone.frequencyHz === 1000).map((tone) => tone.at);
    expect(finishTones[0]).toBeCloseTo(35);
    expect(finishTones[1]).toBeCloseTo(35.35);
  });

  it("the tick path does not replay a scheduled tone but still vibrates", () => {
    const audio = fakeAudio();
    const vibrations: number[][] = [];
    const player = createCuePlayer({ createAudioContext: () => audio.context, vibrate: (pattern) => (vibrations.push(pattern), true) });
    player.prime();
    const state = runningPlanState();
    player.handleEvents([{ kind: "segmentStarted", segment: state.plan.segments[0] as TimerSegment, segmentIndex: 0 }]);
    player.scheduleFrom(state);
    const toneCount = audio.started.length;

    player.handleSecond(3);
    player.handleEvents([{ kind: "segmentStarted", segment: state.plan.segments[1] as TimerSegment, segmentIndex: 1 }]);
    player.handleEvents([{ kind: "finished" }]);

    expect(audio.started).toHaveLength(toneCount + 0);
    expect(vibrations).toEqual([[150], [80, 60, 80], [300, 100, 300]]);
  });

  it("cancelScheduled stops and disconnects every tone and hands cues back to the tick path", () => {
    const audio = fakeAudio();
    const player = createCuePlayer({ createAudioContext: () => audio.context });
    player.prime();
    const state = runningPlanState();
    player.scheduleFrom(state);
    const scheduledCount = audio.started.length;

    player.cancelScheduled();
    expect(audio.started.every((tone) => tone.stoppedAt === 0 && tone.disconnected)).toBe(true);

    player.handleSecond(3);
    expect(audio.started).toHaveLength(scheduledCount + 1);
  });

  it("resume after pause reschedules from the time left, not from the start", () => {
    const audio = fakeAudio();
    const player = createCuePlayer({ createAudioContext: () => audio.context });
    player.prime();
    const running = runningPlanState();
    player.scheduleFrom(running);

    const paused = pauseTimer(running, 8000).state;
    player.cancelScheduled();
    audio.started.length = 0;
    player.scheduleFrom(paused);
    expect(audio.started).toEqual([]);

    player.scheduleFrom(resumeTimer(paused, 50_000).state);

    // 2s left in the first segment: the 3 tick is in the past, ticks 2 and 1 are due now and at +1s.
    expect(audio.started.slice(0, 3).map((tone) => [tone.frequencyHz, tone.at])).toEqual([[660, 10], [660, 11], [523, 12]]);
  });

  it("scheduling again does not stack tones: the old ones are cancelled first", () => {
    const audio = fakeAudio();
    const player = createCuePlayer({ createAudioContext: () => audio.context });
    player.prime();
    const state = runningPlanState();

    player.scheduleFrom(state);
    const firstBatch = audio.started.length;
    player.scheduleFrom(state);

    expect(audio.started.slice(0, firstBatch).every((tone) => tone.disconnected)).toBe(true);
  });

  it("does nothing audible before prime and never throws when audio fails", () => {
    const silent = createCuePlayer({ createAudioContext: () => undefined });
    silent.prime();
    expect(() => silent.scheduleFrom(runningPlanState())).not.toThrow();

    const broken = fakeAudio();
    broken.context.createOscillator = () => { throw new Error("boom"); };
    const player = createCuePlayer({ createAudioContext: () => broken.context });
    player.prime();
    expect(() => player.scheduleFrom(runningPlanState())).not.toThrow();
    expect(() => player.cancelScheduled()).not.toThrow();
  });
});
