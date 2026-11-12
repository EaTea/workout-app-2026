import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseProgram } from "./parse";
import { applyRotationToBlocks, isRotatedWeek, itemDisplayName, performedAsName, rotatedName, rotationBlockStartWeek } from "./rotation";
import { buildSession } from "./schedule";

const program = parseProgram(JSON.parse(readFileSync("public/program.json", "utf-8"))).program;
const settings = { startDate: "2026-11-02", maxReps: { pull_up: 12, dip: 15 }, maxSavedOn: {}, maxHistory: {} };

describe("isRotatedWeek", () => {
  it("is false for weeks 1-4 and true for 5-8 with everyWeeks 4", () => {
    expect([1, 2, 3, 4].map((week) => isRotatedWeek(week, 4))).toEqual([false, false, false, false]);
    expect([5, 6, 7, 8].map((week) => isRotatedWeek(week, 4))).toEqual([true, true, true, true]);
  });

  it("alternates again for a later block and for other lengths", () => {
    expect(isRotatedWeek(9, 4)).toBe(false);
    expect(isRotatedWeek(3, 2)).toBe(true);
    expect(isRotatedWeek(2, 2)).toBe(false);
  });
});

describe("rotatedName", () => {
  it("returns the swap's in name, or undefined", () => {
    expect(rotatedName("ytwi", program.warmupRotation!)).toBe("Reverse fly");
    expect(rotatedName("lateral_raise", program.warmupRotation!)).toBeUndefined();
  });
});

describe("rotationBlockStartWeek", () => {
  /** Session for week `week`, day `day` of the 2 Nov start. */
  function session(week: number, day: number) {
    const offset = (week - 1) * 7 + (day - 1);
    const date = new Date(Date.UTC(2026, 10, 2 + offset)).toISOString().slice(0, 10);
    return buildSession(program, settings, date);
  }

  it("is the block's first week on every training day of weeks 5-8", () => {
    expect(rotationBlockStartWeek(program, session(5, 1))).toBe(5);
    expect(rotationBlockStartWeek(program, session(5, 2))).toBe(5);
    expect(rotationBlockStartWeek(program, session(6, 1))).toBe(5);
    expect(rotationBlockStartWeek(program, session(8, 3))).toBe(5);
  });

  it("is undefined in unrotated weeks, on rest days and when there is no training session", () => {
    expect(rotationBlockStartWeek(program, session(1, 1))).toBeUndefined();
    expect(rotationBlockStartWeek(program, session(4, 1))).toBeUndefined();
    expect(rotationBlockStartWeek(program, session(5, 7))).toBeUndefined();
    expect(rotationBlockStartWeek(program, { kind: "complete" })).toBeUndefined();
  });
});

describe("applyRotationToBlocks via buildSession", () => {
  /** The YTWI warm-up item on week `week` day 1, if present. */
  function ytwiItem(date: string) {
    const result = buildSession(program, settings, date);
    if (result.kind !== "training") throw new Error("expected training");
    return result.blocks.flatMap((block) => block.items).find((item) => item.exercise.id === "ytwi");
  }

  it("leaves weeks 1-4 as written", () => {
    const item = ytwiItem("2026-11-09");
    expect(item?.rotatedIn).toBeUndefined();
    expect(item && itemDisplayName(item)).toBe("YTWI raises");
  });

  it("swaps the name in week 5 but keeps the original exercise id", () => {
    const item = ytwiItem("2026-11-30");
    expect(item?.exercise.id).toBe("ytwi");
    expect(item?.rotatedIn).toEqual({ displayName: "Reverse fly", originalName: "YTWI raises" });
    expect(item && itemDisplayName(item)).toBe("Reverse fly");
  });

  it("drops the original's no-equipment swap from a rotated-in warm-up", () => {
    const result = buildSession(program, settings, "2026-11-30");
    if (result.kind !== "training") throw new Error("expected training");
    const pallof = result.blocks[0]!.items.find((item) => item.exercise.id === "pallof_press");

    // Week 5 rotates Ab raises in for the Pallof press, so plank shoulder taps no longer apply.
    expect(pallof?.rotatedIn?.displayName).toBe("Ab raises");
    expect(pallof?.noEquipment).toBeUndefined();
  });

  it("keeps the no-equipment swap on a warm-up that isn't rotated", () => {
    const result = buildSession(program, settings, "2026-11-09");
    if (result.kind !== "training") throw new Error("expected training");
    const pallof = result.blocks[0]!.items.find((item) => item.exercise.id === "pallof_press");

    expect(pallof?.noEquipment?.exercise.id).toBe("plank_shoulder_tap");
  });

  it("returns the same blocks in an unrotated week", () => {
    expect(applyRotationToBlocks([], 1, program.warmupRotation)).toEqual([]);
  });
});

describe("performedAsName", () => {
  it("is the rotated-in name for a warm-up in a swapped week", () => {
    expect(performedAsName(program, "ytwi", 5, "warmup")).toBe("Reverse fly");
  });

  it("is the library name otherwise, or the id when the exercise is gone", () => {
    expect(performedAsName(program, "ytwi", 2, "warmup")).toBe("YTWI raises");
    expect(performedAsName(program, "ytwi", 5, "emom")).toBe("YTWI raises");
    expect(performedAsName(program, "ytwi", undefined, "warmup")).toBe("YTWI raises");
    expect(performedAsName(program, "lateral_raise", 5, "warmup")).toBe(program.exercises["lateral_raise"]!.name);
    expect(performedAsName(program, "gone", 5, "warmup")).toBe("gone");
  });
});
