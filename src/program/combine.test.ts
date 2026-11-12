import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { TrainingSettings } from "../settings/model";
import { ALTERNATING_EXPLOSIVE_MINUTES_SAVED, DROPPED_EXTRAS_MINUTES_SAVED, blockSlotsOf, combineSessions, type CombinedBlock, type CombinedSession } from "./combine";
import { parseProgram } from "./parse";
import { buildSession, type SessionView } from "./schedule";
import { applyNoEquipmentChoices } from "./noEquipment";

/**
 * Tests for the merge (rules 4 and 5 of the PR 23 design) against the worked
 * examples, using the shipped public/program.json and a 2 Nov 2026 start.
 *
 * Minutes: the plan's rule (sum, minus 3 when explosive alternates, minus 4
 * when optional items or a bag round are dropped) gives 73, 67, 70 and 85 for
 * Day 1+2, 2+3, 3+4 and 5+6, the figures the plan states.
 */

const program = parseProgram(JSON.parse(readFileSync("public/program.json", "utf-8"))).program;

const settings: TrainingSettings = {
  startDate: "2026-11-02",
  maxReps: { pull_up: 12, dip: 15 },
  maxSavedOn: {},
  maxHistory: { pull_up: [{ savedOn: null, reps: 12 }], dip: [{ savedOn: null, reps: 15 }] },
};

/** The session Today builds for a date. */
function sessionOn(date: string): SessionView {
  return buildSession(program, settings, date);
}

/** Combines the sessions of two dates. */
function combineDates(firstDate: string, secondDate: string): CombinedSession {
  return combineSessions(program, sessionOn(firstDate), sessionOn(secondDate));
}

/**
 * One line per block, e.g. "explosive|alternate|D1#2:med_ball_slam+D2#2:split_squat_jump":
 * type, arrangement, then each part's day, own-day block position and exercise ids.
 */
function outline(blocks: CombinedBlock[]): string[] {
  return blocks.map((block) => {
    const parts = block.parts.map((part) => `D${part.source.day}#${part.source.blockPosition}:${part.block.items.map((item) => item.exercise.id).join("&")}`);
    return `${block.type}|${block.arrangement}|${parts.join("+")}`;
  });
}

describe("combineSessions, Day 1 + Day 2 on 9 Nov (week 2)", () => {
  const combined = combineDates("2026-11-09", "2026-11-10");

  it("orders blocks by type with the earlier day first, alternating the explosive blocks", () => {
    expect(outline(combined.blocks)).toEqual([
      "warmup|single|D1#1:ytwi&pallof_press",
      "warmup|single|D2#1:cossack_squat&hip_abduction_adduction",
      "explosive|alternate|D1#2:med_ball_slam+D2#2:split_squat_jump",
      "mainStrength|single|D1#3:pull_up",
      "mainStrength|single|D2#3:zercher_bulgarian_split_squat",
      "miniDose|single|D1#4:dip",
      "miniDose|single|D2#4:single_leg_rdl",
      "core|single|D1#5:back_extension&hanging_leg_raise",
      "finisher|single|D1#6:heavy_bag",
    ]);
  });

  it("leaves out the side plank and caps the bag at 4 rounds", () => {
    const core = combined.blocks.find((block) => block.type === "core")!;
    expect(core.parts[0]!.block.items.map((item) => item.optional)).toEqual([false, false]);

    const bag = combined.blocks.find((block) => block.type === "finisher")!.parts[0]!.block.items[0]!;
    expect(bag.rounds).toEqual({ min: 4, max: 4 });
    expect(combined.droppedForTime).toEqual({ optionalItems: true, bagRounds: true });
  });

  it("adds the two days' minutes, less 3 for alternating and 4 for dropped extras", () => {
    expect(ALTERNATING_EXPLOSIVE_MINUTES_SAVED).toBe(3);
    expect(DROPPED_EXTRAS_MINUTES_SAVED).toBe(4);
    expect(combined.explosiveAlternates).toBe(true);
    expect(combined.targetMinutes).toBe(50 + 30 - 3 - 4);
  });

  it("names the days, focus, week and phase", () => {
    expect(combined).toMatchObject({ kind: "combined", week: 2, phase: "Base", isDeload: false, days: [1, 2], focus: "Upper: pull + Lower: knee" });
  });

  it("keeps both warm-ups in full", () => {
    const warmups = combined.blocks.filter((block) => block.type === "warmup");
    expect(warmups.map((block) => block.parts[0]!.block.items.length)).toEqual([2, 2]);
  });

  it("gives the same result whichever order the sessions are passed in", () => {
    expect(combineDates("2026-11-10", "2026-11-09")).toEqual(combined);
  });

  it("does not change the sessions it was given", () => {
    const day1 = sessionOn("2026-11-09");
    const before = JSON.stringify(day1);
    combineSessions(program, day1, sessionOn("2026-11-10"));
    expect(JSON.stringify(day1)).toBe(before);
  });
});

describe("combineSessions, Day 2 + Day 3 on 11 Nov", () => {
  const combined = combineDates("2026-11-10", "2026-11-11");

  it("alternates the leg jumps with the wall throws (week 2 is even) and keeps the crab core", () => {
    expect(outline(combined.blocks)).toEqual([
      "warmup|single|D2#1:cossack_squat&hip_abduction_adduction",
      "warmup|single|D3#1:pallof_press&lateral_raise&plate_halo",
      "explosive|alternate|D2#2:split_squat_jump+D3#2:rotational_wall_throw",
      "mainStrength|single|D2#3:zercher_bulgarian_split_squat",
      "mainStrength|single|D3#3:dip",
      "miniDose|single|D2#4:single_leg_rdl",
      "miniDose|single|D3#4:overhead_press",
      "core|single|D3#5:crab_knee_to_elbow&crab_base_switch_sprawl",
    ]);
  });

  it("saves only the alternating minutes: nothing optional or bag in either day", () => {
    expect(combined.droppedForTime).toEqual({ optionalItems: false, bagRounds: false });
    expect(combined.targetMinutes).toBe(30 + 40 - 3);
  });
});

describe("combineSessions, Day 3 + Day 4 on 12 Nov (Day 4 catching up Day 3)", () => {
  const combined = combineDates("2026-11-11", "2026-11-12");

  it("puts the wall throws (week 2 is even) first and the kettlebell swing EMOM as its own block after them", () => {
    expect(outline(combined.blocks).filter((line) => line.startsWith("explosive"))).toEqual([
      "explosive|single|D3#2:rotational_wall_throw",
      "explosive|single|D4#2:kettlebell_swing",
    ]);
    expect(combined.explosiveAlternates).toBe(false);
  });

  it("keeps Day 3's crab core and takes only the two days' minutes", () => {
    expect(outline(combined.blocks).filter((line) => line.startsWith("core"))).toEqual(["core|single|D3#5:crab_knee_to_elbow&crab_base_switch_sprawl"]);
    expect(combined.targetMinutes).toBe(40 + 30);
  });
});

describe("combineSessions, Day 5 + Day 6 on 14 Nov", () => {
  const combined = combineDates("2026-11-13", "2026-11-14");

  it("keeps Day 5's core (hollow hold out) and bag, then Day 6's wall sit", () => {
    const outlines = outline(combined.blocks);
    expect(outlines.filter((line) => /^(core|finisher)/.test(line))).toEqual([
      "core|single|D5#5:hanging_leg_raise&back_extension",
      "finisher|single|D5#6:heavy_bag",
      "finisher|single|D6#5:wall_sit",
    ]);
  });

  it("caps the bag at 4 rounds but leaves the wall sit's fixed 5 rounds alone", () => {
    const finishers = combined.blocks.filter((block) => block.type === "finisher").map((block) => block.parts[0]!.block.items[0]!);
    expect(finishers.map((item) => item.rounds)).toEqual([{ min: 4, max: 4 }, { min: 5, max: 5 }]);
  });

  it("alternates the explosive blocks and drops extras", () => {
    expect(combined.explosiveAlternates).toBe(true);
    expect(combined.targetMinutes).toBe(50 + 42 - 3 - 4);
  });
});

describe("combineSessions in the deload week 4 (23 Nov, Day 1 + Day 2)", () => {
  const dayOne = sessionOn("2026-11-23");
  const dayTwo = sessionOn("2026-11-24");
  const combined = combineSessions(program, dayOne, dayTwo);

  it("halves each day's sets before merging", () => {
    const slams = combined.blocks.find((block) => block.type === "explosive")!.parts[0]!.block.items[0]!;
    const jumps = combined.blocks.find((block) => block.type === "explosive")!.parts[1]!.block.items[0]!;
    expect(slams.sets).toHaveLength(3); // 6 sets halved
    expect(jumps.sets).toHaveLength(3); // 5 sets halved, rounded up
    expect(combined.isDeload).toBe(true);
    expect(combined.phase).toBe("Deload");
  });

  it("keeps the warm-ups in full", () => {
    const warmups = combined.blocks.filter((block) => block.type === "warmup");
    expect(warmups.map((block) => block.parts[0]!.block.items.length)).toEqual([2, 2]);
  });

  it("has the bag at the deload's already-halved 2 rounds, which the cap leaves as they are", () => {
    const bag = combined.blocks.find((block) => block.type === "finisher")!.parts[0]!.block.items[0]!;
    expect(bag.rounds).toEqual({ min: 2, max: 2 });
    expect(combined.droppedForTime).toEqual({ optionalItems: true, bagRounds: false });
    expect(combined.targetMinutes).toBe(50 + 30 - 3 - 4);
  });
});

describe("combineSessions, more cases", () => {
  it("applies to sessions that already carry No equipment swaps", () => {
    const day2 = sessionOn("2026-11-10");
    const swapped = applyNoEquipmentChoices(day2, new Set(["4:single_leg_rdl"]));
    const combined = combineSessions(program, sessionOn("2026-11-09"), swapped);

    const mini = combined.blocks.filter((block) => block.type === "miniDose")[1]!;
    expect(mini.parts[0]!.source).toEqual({ day: 2, blockPosition: 4 });
    expect(mini.parts[0]!.block.items[0]!.swappedFrom?.id).toBe("single_leg_rdl");
  });

  it("records every block's position within its own day", () => {
    const combined = combineDates("2026-11-09", "2026-11-10");
    const positions = combined.blocks.flatMap((block) => block.parts.map((part) => [part.source.day, part.source.blockPosition]));
    expect(positions.filter(([day]) => day === 1).map(([, position]) => position)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(positions.filter(([day]) => day === 2).map(([, position]) => position)).toEqual([1, 2, 3, 4]);
  });

  it("refuses a pair that is not allowed (Day 4 + Day 5)", () => {
    expect(() => combineDates("2026-11-12", "2026-11-13")).toThrow("not an allowed pair");
  });

  it("refuses two days of different weeks", () => {
    expect(() => combineDates("2026-11-14", "2026-11-16")).toThrow("different weeks");
  });

  it("refuses a rest day", () => {
    expect(() => combineDates("2026-11-14", "2026-11-15")).toThrow("Only two training days");
  });

  it("drops a core block left with no items and counts that as dropped", () => {
    const day1 = sessionOn("2026-11-09");
    if (day1.kind !== "training") throw new Error("expected training");
    const onlyOptional: SessionView = {
      ...day1,
      blocks: day1.blocks.map((block) => (block.type === "core" ? { ...block, items: block.items.filter((item) => item.optional) } : block)),
    };

    const combined = combineSessions(program, onlyOptional, sessionOn("2026-11-10"));

    expect(combined.blocks.some((block) => block.type === "core")).toBe(false);
    expect(combined.droppedForTime.optionalItems).toBe(true);
  });
});

describe("blockSlotsOf", () => {
  it("lists a normal session's blocks with its own day, numbered from 1", () => {
    const session = sessionOn("2026-11-09");
    if (session.kind !== "training") throw new Error("expected a training day");

    expect(blockSlotsOf(session).map((slot) => `D${slot.source.day}#${slot.source.blockPosition}:${slot.block.type}`)).toEqual([
      "D1#1:warmup", "D1#2:explosive", "D1#3:mainStrength", "D1#4:miniDose", "D1#5:core", "D1#6:finisher",
    ]);
  });

  it("lists a combined session's rows in screen order, an alternate block giving one row per day", () => {
    const slots = blockSlotsOf(combineDates("2026-11-09", "2026-11-10"));

    expect(slots.map((slot) => `D${slot.source.day}#${slot.source.blockPosition}`)).toEqual([
      "D1#1", "D2#1", "D1#2", "D2#2", "D1#3", "D2#3", "D1#4", "D2#4", "D1#5", "D1#6",
    ]);
  });
});
