import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { TrainingBreak } from "../break/model";
import type { Injury, InjuryChoices } from "../injury/model";
import type { WorkoutLog } from "../log/model";
import { buildSwappedSession } from "../noEquipment/session";
import type { TrainingSettings } from "../settings/model";
import { parseProgram } from "./parse";
import type { ItemView, SessionView } from "./schedule";

/*
 * "First session back" after a break (PLAN.md, Break 1 step 4), over the
 * shipped program: start 2 Nov 2026, max pull-ups 12, dips 15, a break from
 * 26 Nov to 3 Dec (7 days). 3 Dec is W4 D4 (lower body, no pull-ups), 4 Dec
 * W4 D5, 10 Dec W5 D4. Day 4's rows are: block 1 warm-up (hip thrust, hip
 * abduction), block 2 kettlebell swing, block 3 single-leg RDL, block 4 calf raise.
 */

const program = parseProgram(JSON.parse(readFileSync("public/program.json", "utf-8"))).program;
const sevenDayBreak: TrainingBreak = { from: "2026-11-26", to: "2026-12-03" };
const baseSettings: TrainingSettings = {
  startDate: "2026-11-02",
  maxReps: { pull_up: 12, dip: 15 },
  maxSavedOn: {},
  maxHistory: { pull_up: [{ savedOn: null, reps: 12 }], dip: [{ savedOn: null, reps: 15 }] },
  breaks: [sevenDayBreak],
};
const noLog: WorkoutLog = { sessions: {} };

type Training = Extract<SessionView, { kind: "training" }>;

/** Builds the session for `date` the way Today does, with the given breaks, injuries, log and choices. */
function sessionOn(
  date: string,
  options: { breaks?: TrainingBreak[]; injuries?: Injury[]; log?: WorkoutLog; choices?: InjuryChoices } = {},
): Training {
  const settings = { ...baseSettings, breaks: options.breaks ?? baseSettings.breaks };
  const built = buildSwappedSession(program, settings, options.log ?? noLog, new Map(), date, undefined, options.injuries ?? [], options.choices);
  if (built.session.kind !== "training") throw new Error("expected a training day");
  return built.session;
}

/** Every item of the session's non-warm-up blocks. */
function mainItems(session: Training): ItemView[] {
  return session.blocks.filter((block) => block.type !== "warmup").flatMap((block) => block.items);
}

/** The item of this exercise id. */
function itemOf(session: Training, exerciseId: string): ItemView {
  const found = session.blocks.flatMap((block) => block.items).find((item) => item.exercise.id === exerciseId);
  if (found === undefined) throw new Error(`no ${exerciseId}`);
  return found;
}

/** A log with one kettlebell swing set on `date` (Day 4's explosive block, position 2). */
function logSwing(date: string): WorkoutLog {
  const set = { exerciseId: "kettlebell_swing", blockPosition: 2, setNumber: 1, reps: 10, loggedAt: new Date(`${date}T10:00:00`), day: 4 };
  return { sessions: { [date]: { date, day: 4, sets: [set] } } } as unknown as WorkoutLog;
}

describe("First session back after a break", () => {
  it("marks every main-block item on 3 Dec (W4 D4, the first day back) as a break return", () => {
    const session = sessionOn("2026-12-03");
    const items = mainItems(session);

    expect(session.week).toBe(4);
    expect(session.dayNumber).toBe(4);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) expect(item.firstTimeBack?.reason).toBe("break");
  });

  it("does not mark warm-up items", () => {
    const warmup = sessionOn("2026-12-03").blocks.find((block) => block.type === "warmup")!;

    for (const item of warmup.items) expect(item.firstTimeBack).toBeUndefined();
  });

  it("offers Half sets today only where halving changes something (not a one-set row)", () => {
    const session = sessionOn("2026-12-03");

    expect(itemOf(session, "kettlebell_swing").firstTimeBack?.halfSetsOffered).toBe(true);
    expect(itemOf(session, "single_leg_calf_raise").firstTimeBack?.halfSetsOffered).toBe(false);
  });

  it("marks nothing after a 3-day break", () => {
    const shortBreak: TrainingBreak = { from: "2026-11-30", to: "2026-12-03" };

    for (const item of mainItems(sessionOn("2026-12-03", { breaks: [shortBreak] }))) expect(item.firstTimeBack).toBeUndefined();
  });

  it("marks a break of exactly 7 days but not one of 6", () => {
    const sixDays: TrainingBreak = { from: "2026-11-27", to: "2026-12-03" };

    // A shorter break shifts the schedule, so compare whole sessions rather than one exercise.
    for (const item of mainItems(sessionOn("2026-12-03", { breaks: [sixDays] }))) expect(item.firstTimeBack).toBeUndefined();
    for (const item of mainItems(sessionOn("2026-12-03"))) expect(item.firstTimeBack).toBeDefined();
  });

  it("marks nothing on 18 Dec, more than 14 days after the break ended; still marks 16 Dec", () => {
    for (const item of mainItems(sessionOn("2026-12-18"))) expect(item.firstTimeBack).toBeUndefined();
    expect(mainItems(sessionOn("2026-12-16")).some((item) => item.firstTimeBack?.reason === "break")).toBe(true);
  });

  it("marks nothing before the break has ended", () => {
    for (const item of mainItems(sessionOn("2026-11-25"))) expect(item.firstTimeBack).toBeUndefined();
  });

  it("stops marking an exercise once it was trained: a swing logged on 3 Dec is unmarked on 10 Dec (W5 D4), the RDL and calf raise are still marked", () => {
    const session = sessionOn("2026-12-10", { log: logSwing("2026-12-03") });

    expect(session.week).toBe(5);
    expect(session.dayNumber).toBe(4);
    expect(itemOf(session, "kettlebell_swing").firstTimeBack).toBeUndefined();
    expect(itemOf(session, "single_leg_rdl").firstTimeBack?.reason).toBe("break");
    expect(itemOf(session, "single_leg_calf_raise").firstTimeBack?.reason).toBe("break");
  });

  it("keeps the mark on 10 Dec when nothing was trained since the break", () => {
    expect(itemOf(sessionOn("2026-12-10"), "kettlebell_swing").firstTimeBack?.reason).toBe("break");
  });

  it("does not end the mark with sets logged on the shown date itself, and stops offering the half-sets button", () => {
    const item = itemOf(sessionOn("2026-12-03", { log: logSwing("2026-12-03") }), "kettlebell_swing");

    expect(item.firstTimeBack).toEqual({ reason: "break", halfSetsOffered: false });
  });

  it("does not count sets logged before the break started", () => {
    const item = itemOf(sessionOn("2026-12-03", { log: logSwing("2026-11-25") }), "kettlebell_swing");

    expect(item.firstTimeBack?.reason).toBe("break");
  });

  it("halves a row with the stored Half sets today choice, as for an injury", () => {
    const choices: InjuryChoices = new Map([["2026-12-03", new Map([["2:kettlebell_swing", "halfSets" as const]])]]);
    const plain = sessionOn("2026-12-03");
    const halved = sessionOn("2026-12-03", { choices });
    const before = itemOf(plain, "kettlebell_swing");
    const after = itemOf(halved, "kettlebell_swing");

    expect(after.halvedForReturn).toBe(true);
    expect(after.firstTimeBack?.reason).toBe("break");
    // The swing is an EMOM: halving cuts its minutes.
    expect(after.minutes).toBe(Math.ceil(before.minutes! / 2));
    expect(after.minutes).toBeLessThan(before.minutes!);
    expect(itemOf(halved, "single_leg_rdl").halvedForReturn).toBeUndefined();
  });

  it("with two breaks, the earlier long one still counts when a short break ended after it", () => {
    const earlier: TrainingBreak = { from: "2026-11-10", to: "2026-11-24" }; // 14 days, ended 24 Nov
    const later: TrainingBreak = { from: "2026-11-30", to: "2026-12-03" }; // 3 days, ended last
    const session = sessionOn("2026-12-03", { breaks: [earlier, later] });

    expect(mainItems(session).every((item) => item.firstTimeBack?.reason === "break")).toBe(true);
  });

  it("uses sets since the newest long break when two long breaks are in the window", () => {
    const first: TrainingBreak = { from: "2026-11-05", to: "2026-11-15" };
    const second: TrainingBreak = { from: "2026-11-26", to: "2026-12-03" };
    const firstItem = mainItems(sessionOn("2026-12-03", { breaks: [first, second] }))[0]!;
    // The first row's exercise was trained on 20 Nov, between the breaks: that does not count for the second break.
    const set = { exerciseId: firstItem.exercise.id, blockPosition: 2, setNumber: 1, reps: 5, loggedAt: new Date("2026-11-20T10:00:00"), day: 1 };
    const log = { sessions: { "2026-11-20": { date: "2026-11-20", day: 1, sets: [set] } } } as unknown as WorkoutLog;

    expect(mainItems(sessionOn("2026-12-03", { breaks: [first, second], log }))[0]?.firstTimeBack?.reason).toBe("break");
  });

  it("keeps the injury marker, with its wording, when a row returns from both an injury and a break", () => {
    // Shoulder cleared on 3 Dec as well: W4 D4 has no shoulder-avoid rows, so use Day 1 of week 5 (7 Dec) instead.
    const shoulder: Injury = { area: "shoulder", side: "right", from: "2026-11-22", to: "2026-12-03" };
    const session = sessionOn("2026-12-07", { injuries: [shoulder] });
    const reasons = new Set(mainItems(session).map((item) => item.firstTimeBack?.reason));

    expect(session.dayNumber).toBe(1);
    expect(reasons.has("injury")).toBe(true);
    expect(reasons.has("break")).toBe(true);
    expect(itemOf(session, "pull_up").firstTimeBack).toMatchObject({ reason: "injury", area: "shoulder" });
  });
});
