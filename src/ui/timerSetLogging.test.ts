import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseProgram } from "../program/parse";
import { buildSession, type BlockView, type ItemView } from "../program/schedule";
import type { TrainingSettings } from "../settings/model";
import type { WorkoutLog } from "../log/model";
import { setsForItem } from "../log/operations";
import { logSet } from "../log/operations";
import { buildEmomRoundAction, type TimerSetLoggingSource } from "./timerSetLogging";

const program = parseProgram(JSON.parse(readFileSync("public/program.json", "utf-8"))).program;
const settings: TrainingSettings = { startDate: "2026-11-02", maxReps: { pull_up: 12, dip: 15 }, maxSavedOn: {}, maxHistory: {} };

/** The EMOM pull-up item and its block on a date, as Today sees them. */
function pullUpEmom(date: string, overrides: Partial<TrainingSettings> = {}): { item: ItemView; block: BlockView; blockPosition: number } {
  const session = buildSession(program, { ...settings, ...overrides }, date);
  if (session.kind !== "training") throw new Error(`expected training on ${date}`);
  for (const block of session.blocks) {
    const item = block.items.find((candidate) => candidate.exercise.id === "pull_up" && candidate.format === "emom");
    if (item) return { item, block, blockPosition: block.position };
  }
  throw new Error(`no pull-up EMOM on ${date}`);
}

/**
 * A fake of app.ts's log source: holds one log, applies each change to it
 * the way the real change path does, and counts the saves.
 */
function fakeSource(initialLog: WorkoutLog, canLog = true): TimerSetLoggingSource & { saves: number; refreshes: number; log: WorkoutLog } {
  const source = {
    log: initialLog,
    saves: 0,
    refreshes: 0,
    canLog,
    refresh() {
      source.refreshes += 1;
    },
    currentLog() {
      return source.log;
    },
    changeLog(operation: (freshLog: WorkoutLog) => WorkoutLog) {
      source.log = operation(source.log);
      source.saves += 1;
      return { log: source.log, error: null };
    },
  };
  return source;
}

const DATE = "2026-11-02";
const BASE_CONTEXT = { programWeek: 1, day: 1 };

describe("buildEmomRoundAction", () => {
  it("offers 'Log set N' for each open minute and saves the set on tap", () => {
    const { item, block, blockPosition } = pullUpEmom(DATE);
    const source = fakeSource({ sessions: {} });
    const action = buildEmomRoundAction({ program, item, block, date: DATE, blockPosition, dayNumber: 1, isCombined: false, sessionContext: BASE_CONTEXT, source });

    expect(action.describe(1)).toEqual({ label: "Log set 1", disabled: false });

    action.onTap(1);

    expect(source.saves).toBe(1);
    const saved = setsForItem(source.log, DATE, blockPosition, "pull_up", 1);
    expect(saved).toHaveLength(1);
    expect(saved[0]?.setNumber).toBe(1);
    // Pre-filled from the plan's target: 4 reps on week 1, the same as the log screen would start at.
    expect(saved[0]?.reps).toBe(4);
  });

  it("shows a logged minute as done and does not save it twice", () => {
    const { item, block, blockPosition } = pullUpEmom(DATE);
    const source = fakeSource({ sessions: {} });
    const action = buildEmomRoundAction({ program, item, block, date: DATE, blockPosition, dayNumber: 1, isCombined: false, sessionContext: BASE_CONTEXT, source });

    action.onTap(2);
    action.onTap(2);

    expect(action.describe(2)).toEqual({ label: "Logged set 2", disabled: true });
    expect(source.saves).toBe(1);
  });

  it("does not log a minute past the item's sets", () => {
    const { item, block, blockPosition } = pullUpEmom(DATE);
    const source = fakeSource({ sessions: {} });
    const action = buildEmomRoundAction({ program, item, block, date: DATE, blockPosition, dayNumber: 1, isCombined: false, sessionContext: BASE_CONTEXT, source });

    expect(action.describe(99)).toEqual({ label: "No set for this minute", disabled: true });
    action.onTap(99);
    expect(source.saves).toBe(0);
  });

  it("is disabled on a future preview", () => {
    const { item, block, blockPosition } = pullUpEmom(DATE);
    const source = fakeSource({ sessions: {} }, false);
    const action = buildEmomRoundAction({ program, item, block, date: DATE, blockPosition, dayNumber: 1, isCombined: false, sessionContext: BASE_CONTEXT, source });

    expect(action.describe(1)).toEqual({ label: "Can't log here", disabled: true });
    action.onTap(1);
    expect(source.saves).toBe(0);
  });

  it("saves under the combined host day and names the set's own day", () => {
    const { item, block, blockPosition } = pullUpEmom(DATE);
    const source = fakeSource({ sessions: {} });
    const action = buildEmomRoundAction({
      program, item, block, date: DATE, blockPosition, dayNumber: 2, isCombined: true,
      sessionContext: { programWeek: 1, day: 1 }, source,
    });

    action.onTap(3);

    const savedSession = source.log.sessions[DATE];
    expect(savedSession?.day).toBe(1);
    expect(savedSession?.sets[0]?.day).toBe(2);
  });

  it("is consistent with the log screen's logSet shape: the set appears under the same exercise and block", () => {
    const { item, block, blockPosition } = pullUpEmom(DATE);
    const source = fakeSource(logSet({ sessions: {} }, DATE, { exerciseId: "pull_up", blockPosition, setNumber: 1, reps: 4, loggedAt: new Date() }, BASE_CONTEXT));
    const action = buildEmomRoundAction({ program, item, block, date: DATE, blockPosition, dayNumber: 1, isCombined: false, sessionContext: BASE_CONTEXT, source });

    // Minute 1 was logged on the log screen; the timer sees that and offers minute 2.
    expect(action.describe(1).disabled).toBe(true);
    expect(action.describe(2)).toEqual({ label: "Log set 2", disabled: false });
  });
});
