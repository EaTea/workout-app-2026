import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildSwappedSession } from "../noEquipment/session";
import { parseProgram } from "../program/parse";
import type { ItemView } from "../program/schedule";
import type { Injury } from "../injury/model";
import { addItBackButtonName, areaFreeHeading, firstTimeBackLine, leftOutBlockLine, leftOutLine, PAIN_FREE_ONLY_LINE, standInLine, wholeBlockLeftOutArea } from "./injuryRowText";

const program = parseProgram(JSON.parse(readFileSync("public/program.json", "utf-8"))).program;
const settings = { startDate: "2026-11-02", maxReps: { pull_up: 12, dip: 15 }, maxSavedOn: {}, maxHistory: {} };
const rightShoulder: Injury[] = [{ area: "shoulder", side: "right", from: "2026-11-01" }];

/** The injured session for `date`, as Today builds it. */
function injuredSession(date: string) {
  const { session } = buildSwappedSession(program, settings, { sessions: {} }, new Map(), date, new Set(), rightShoulder);
  if (session.kind !== "training") throw new Error("expected training");
  return session;
}

/** The item for `exerciseId` anywhere in the injured session on `date`. */
function itemOn(date: string, exerciseId: string): ItemView {
  const found = injuredSession(date).blocks.flatMap((block) => block.items).find((item) => item.exercise.id === exerciseId);
  if (found === undefined) throw new Error(`no ${exerciseId} on ${date}`);
  return found;
}

describe("the words of the injury rows", () => {
  it("says what is left out, for the area", () => {
    expect(leftOutLine("shoulder")).toBe("Left out for your shoulder");
    expect(leftOutBlockLine("Boxing", "shoulder")).toBe("Boxing left out for your shoulder");
  });

  it("names the add-back button with the visible text first", () => {
    expect(addItBackButtonName("Pull-ups")).toBe("Add it back, Pull-ups");
  });

  it("words the pain-free line", () => {
    expect(PAIN_FREE_ONLY_LINE).toBe("Pain-free only · stop if it hurts");
  });
});

describe("rows of a flagged 23 Nov (Day 1)", () => {
  it("the lying leg raise stand-in says it is instead of the hanging leg raise", () => {
    expect(standInLine(itemOn("2026-11-23", "lying_leg_raise"))).toBe("Instead of Hanging leg raise");
  });

  it("an item that is not a stand-in has no such line", () => {
    expect(standInLine(itemOn("2026-11-23", "pallof_press"))).toBeUndefined();
  });

  it("the boxing block is left out as a whole, but a block with a kept item is not", () => {
    const blocks = injuredSession("2026-11-23").blocks;
    const finisher = blocks.find((block) => block.optional !== undefined)!;

    expect(wholeBlockLeftOutArea(finisher.items)).toBe("shoulder");
    expect(wholeBlockLeftOutArea(blocks.find((block) => block.items.some((item) => item.leftOut) && block.items.some((item) => !item.leftOut))?.items ?? [])).toBeUndefined();
    expect(wholeBlockLeftOutArea([])).toBeUndefined();
  });
});

describe("areaFreeHeading", () => {
  it("heads 25 Nov as the shoulder-free session instead of Day 3", () => {
    expect(areaFreeHeading(injuredSession("2026-11-25"))).toBe("Shoulder-free session · instead of Day 3 (Upper: push)");
  });

  it("is undefined on a normal session", () => {
    expect(areaFreeHeading(injuredSession("2026-11-24"))).toBeUndefined();
  });
});

describe("First time back wording", () => {
  it("has the plan's lines, and a button name that starts with its visible text", async () => {
    const { FIRST_TIME_BACK_LINE, HALF_SETS_TODAY_LABEL, halfSetsTodayButtonName } = await import("./injuryRowText");

    expect(FIRST_TIME_BACK_LINE).toBe("First time back · pain-free only");
    expect(halfSetsTodayButtonName("Pull-ups")).toBe(`${HALF_SETS_TODAY_LABEL}, Pull-ups`);
    expect(halfSetsTodayButtonName("Pull-ups").startsWith("Half sets today")).toBe(true);
  });
});

describe("firstTimeBackLine", () => {
  it("words a break return as the first session back and an injury return as first time back", () => {
    expect(firstTimeBackLine({ reason: "break", halfSetsOffered: true })).toBe("First session back · pain-free only");
    expect(firstTimeBackLine({ reason: "injury", area: "shoulder", halfSetsOffered: true })).toBe("First time back · pain-free only");
  });
});
