import { describe, expect, it } from "vitest";
import {
  createTimerPlan, createTimerState, describeTimer, formatClock, pauseTimer, resumeTimer, skipSegment,
  startTimer, tickTimer, type TimerSegment, type TimerState,
} from "./engine";

/** A segment with defaults; tests override what they care about. */
function segment(overrides: Partial<TimerSegment> = {}): TimerSegment {
  return { phase: "work", durationSec: 10, round: 1, totalRounds: 2, label: "Go", ...overrides };
}

/** Work 10s, rest 5s, work 10s: 25 seconds in three segments. */
function threeSegmentState(): TimerState {
  return createTimerState(createTimerPlan("Test", [
    segment({ round: 1 }),
    segment({ phase: "rest", durationSec: 5, round: 1 }),
    segment({ round: 2 }),
  ]));
}

const T0 = 1_000_000;

describe("createTimerPlan", () => {
  it("rejects an empty plan", () => {
    expect(() => createTimerPlan("x", [])).toThrow();
  });

  it("rejects zero, negative and non-finite durations", () => {
    for (const durationSec of [0, -5, Number.NaN, Infinity]) {
      expect(() => createTimerPlan("x", [segment({ durationSec })])).toThrow();
    }
  });
});

describe("start and tick", () => {
  it("starts ready and emits segmentStarted for the first segment", () => {
    const ready = threeSegmentState();
    expect(ready.status).toBe("ready");

    const { state, events } = startTimer(ready, T0);
    expect(state.status).toBe("running");
    expect(events).toEqual([{ kind: "segmentStarted", segment: ready.plan.segments[0], segmentIndex: 0 }]);
  });

  it("does not advance before start", () => {
    const ready = threeSegmentState();
    expect(tickTimer(ready, T0 + 99_000).state).toBe(ready);
  });

  it("counts down within a segment without events", () => {
    const started = startTimer(threeSegmentState(), T0).state;
    const { state, events } = tickTimer(started, T0 + 3_200);
    expect(events).toEqual([]);
    expect(describeTimer(state).remainingSec).toBe(7);
  });

  it("moves to the next segment at the boundary", () => {
    const started = startTimer(threeSegmentState(), T0).state;
    const { state, events } = tickTimer(started, T0 + 10_000);
    expect(state.segmentIndex).toBe(1);
    expect(events.map((event) => event.kind)).toEqual(["segmentStarted"]);
    expect(describeTimer(state).remainingSec).toBe(5);
  });

  it("catches up across several segments in one tick, in order, keeping the leftover", () => {
    const started = startTimer(threeSegmentState(), T0).state;
    // 12s in: first segment done, 2s into the rest.
    const partway = tickTimer(started, T0 + 12_000);
    expect(partway.state.segmentIndex).toBe(1);
    expect(describeTimer(partway.state).remainingSec).toBe(3);

    // 3 minutes later (phone asleep): every remaining segment starts, then it finishes.
    const longSleep = tickTimer(started, T0 + 180_000);
    expect(longSleep.events.map((event) => event.kind)).toEqual(["segmentStarted", "segmentStarted", "finished"]);
    expect(longSleep.state.status).toBe("finished");
  });

  it("finishes exactly at the end and ignores later ticks", () => {
    const started = startTimer(threeSegmentState(), T0).state;
    const finished = tickTimer(started, T0 + 25_000);
    expect(finished.events.at(-1)).toEqual({ kind: "finished" });
    expect(describeTimer(finished.state).remainingSec).toBe(0);
    expect(describeTimer(finished.state).overallProgress).toBe(1);
    expect(tickTimer(finished.state, T0 + 99_000).events).toEqual([]);
  });

  it("ignores a clock that goes backwards", () => {
    const started = startTimer(threeSegmentState(), T0).state;
    const { state } = tickTimer(started, T0 - 5_000);
    expect(describeTimer(state).remainingSec).toBe(10);
  });
});

describe("pause and resume", () => {
  it("does not advance while paused and does not count paused time", () => {
    const started = startTimer(threeSegmentState(), T0).state;
    const paused = pauseTimer(started, T0 + 4_000).state;
    expect(paused.status).toBe("paused");

    const stillPaused = tickTimer(paused, T0 + 60_000).state;
    expect(describeTimer(stillPaused).remainingSec).toBe(6);

    const resumed = resumeTimer(stillPaused, T0 + 60_000).state;
    expect(resumed.status).toBe("running");
    expect(describeTimer(tickTimer(resumed, T0 + 62_000).state).remainingSec).toBe(4);
  });

  it("pausing after the plan has already elapsed reports the finish instead", () => {
    const started = startTimer(threeSegmentState(), T0).state;
    const { state, events } = pauseTimer(started, T0 + 90_000);
    expect(state.status).toBe("finished");
    expect(events.at(-1)).toEqual({ kind: "finished" });
  });

  it("resume is ignored unless paused", () => {
    const started = startTimer(threeSegmentState(), T0).state;
    expect(resumeTimer(started, T0 + 1_000).state).toBe(started);
  });
});

describe("skipSegment", () => {
  it("jumps to the next segment with a segmentStarted event", () => {
    const started = startTimer(threeSegmentState(), T0).state;
    const { state, events } = skipSegment(started, T0 + 2_000);
    expect(state.segmentIndex).toBe(1);
    expect(state.status).toBe("running");
    expect(events.map((event) => event.kind)).toEqual(["segmentStarted"]);
    expect(describeTimer(state).remainingSec).toBe(5);
  });

  it("keeps a paused timer paused", () => {
    const started = startTimer(threeSegmentState(), T0).state;
    const paused = pauseTimer(started, T0 + 1_000).state;
    const { state } = skipSegment(paused, T0 + 2_000);
    expect(state.status).toBe("paused");
    expect(state.segmentIndex).toBe(1);
  });

  it("finishes the timer when skipping the last segment", () => {
    let state = startTimer(threeSegmentState(), T0).state;
    state = skipSegment(state, T0).state;
    state = skipSegment(state, T0).state;
    const { state: finished, events } = skipSegment(state, T0);
    expect(finished.status).toBe("finished");
    expect(events).toEqual([{ kind: "finished" }]);
  });

  it("does nothing before start", () => {
    const ready = threeSegmentState();
    expect(skipSegment(ready, T0).state).toBe(ready);
  });
});

describe("describeTimer", () => {
  it("reports round, remaining (ceil) and progress", () => {
    const started = startTimer(threeSegmentState(), T0).state;
    const view = describeTimer(tickTimer(started, T0 + 12_500).state);
    expect(view.segment.phase).toBe("rest");
    expect(view.round).toBe(1);
    expect(view.totalRounds).toBe(2);
    expect(view.remainingSec).toBe(3); // 2.5s left rounds up
    expect(view.segmentProgress).toBeCloseTo(0.5);
    expect(view.overallProgress).toBeCloseTo(12.5 / 25);
  });
});

describe("formatClock", () => {
  it("formats m:ss", () => {
    expect(formatClock(65)).toBe("1:05");
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(9)).toBe("0:09");
    expect(formatClock(600)).toBe("10:00");
  });

  it("clamps negatives and drops fractions", () => {
    expect(formatClock(-3)).toBe("0:00");
    expect(formatClock(59.9)).toBe("0:59");
  });
});
