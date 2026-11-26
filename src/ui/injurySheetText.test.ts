import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseProgram } from "../program/parse";
import type { ItemView } from "../program/schedule";
import { buildSession } from "../program/schedule";
import { applyNoEquipmentChoices, noEquipmentItemKey } from "../program/noEquipment";
import { injuryStandInCues, injurySectionLine } from "./injurySheetText";

const program = parseProgram(JSON.parse(readFileSync("public/program.json", "utf-8"))).program;
const settings = { startDate: "2026-11-02", maxReps: { pull_up: 12, dip: 15 }, maxSavedOn: {}, maxHistory: {} };

/** The item for an exercise id anywhere in the session on `date`, or fails. */
function itemOn(date: string, exerciseId: string): ItemView {
  const session = buildSession(program, settings, date);
  if (session.kind !== "training") throw new Error("not a training day");
  const found = session.blocks.flatMap((block) => block.items).find((item) => item.exercise.id === exerciseId);
  if (!found) throw new Error(`no ${exerciseId} on ${date}`);
  return found;
}

/** The item for `exerciseId` on `date` with its "No equipment" tick switched on, as the sheet receives it on Today. */
function tickedItemOn(date: string, exerciseId: string): ItemView {
  const session = buildSession(program, settings, date);
  if (session.kind !== "training") throw new Error("not a training day");
  const block = session.blocks.find((candidate) => candidate.items.some((item) => item.exercise.id === exerciseId));
  if (!block) throw new Error(`no ${exerciseId} on ${date}`);

  const ticked = applyNoEquipmentChoices(session, new Set([noEquipmentItemKey(block.position, exerciseId)]));
  if (ticked.kind !== "training") throw new Error("not a training day");
  const found = ticked.blocks.flatMap((candidate) => candidate.items).find((item) => item.swappedFrom?.id === exerciseId);
  if (!found) throw new Error(`${exerciseId} was not swapped on ${date}`);
  return found;
}

describe("injurySectionLine on a row ticked No equipment (the injury wins: it words the original)", () => {
  it("ticked kettlebell swing (avoid) still says broad jumps replace it", () => {
    const item = tickedItemOn("2026-11-05", "kettlebell_swing");

    expect(item.exercise.id).not.toBe("kettlebell_swing");
    expect(injurySectionLine(item, true)).toMatch(/^Loads the shoulder\. While your shoulder is flagged, Broad jumps, hands on hips replaces it: 5 \/ min, 8 min/);
  });

  it("ticked back extension (caution) uses the 'sore shoulder' wording and the bodyweight stand-in", () => {
    const item = tickedItemOn("2026-11-02", "back_extension");

    expect(item.exercise.id).toBe("prone_back_extension");
    expect(injurySectionLine(item, true)).toMatch(/^Can load a sore shoulder\. While your shoulder is flagged, Back extension, arms crossed replaces it: 4 × 12–15/);
  });

  it("ticked hanging leg raise (avoid) names the lying leg raise with this week's dose", () => {
    const item = tickedItemOn("2026-11-02", "hanging_leg_raise");

    expect(injurySectionLine(item, true)).toMatch(/^Loads the shoulder\. While your shoulder is flagged, Lying leg raise replaces it: .*10–15/);
  });

  it("a ticked row's stand-in cues are still the stand-in's", () => {
    expect(injuryStandInCues(tickedItemOn("2026-11-05", "kettlebell_swing"))).toContain("Hands on the hips, no arm swing");
  });
});

describe("injuryStandInCues", () => {
  it("lists the shoulder stand-in's cues (Day 4 kettlebell swing)", () => {
    expect(injuryStandInCues(itemOn("2026-11-05", "kettlebell_swing"))).toContain("Hands on the hips, no arm swing");
  });

  it("is empty when the item has no stand-in (Day 1 pull-ups)", () => {
    expect(injuryStandInCues(itemOn("2026-11-02", "pull_up"))).toEqual([]);
  });
});

describe("injurySectionLine", () => {
  it("a stand-in with no level in the file is worded as avoid (the stricter reading)", () => {
    const item = itemOn("2026-11-05", "kettlebell_swing");
    const withoutLevel = { ...item, exercise: { ...item.exercise, loads: undefined } };

    expect(injurySectionLine(withoutLevel, true)).toMatch(/^Loads the shoulder\. While your shoulder is flagged, Broad jumps, hands on hips replaces it:/);
  });

  it("avoid with a stand-in names it and this week's dose (Day 4 kettlebell swing, W1)", () => {
    expect(injurySectionLine(itemOn("2026-11-05", "kettlebell_swing"), true)).toMatch(
      /^Loads the shoulder\. While your shoulder is flagged, Broad jumps, hands on hips replaces it: 5 \/ min, 8 min/,
    );
  });

  it("avoid without a stand-in says it is left out and can be added back at half sets (Day 1 pull-ups)", () => {
    expect(injurySectionLine(itemOn("2026-11-02", "pull_up"), true)).toBe(
      "Loads the shoulder. While your shoulder is flagged, it's left out, and you can add it back for a day at half the sets.",
    );
  });

  it("caution with a stand-in uses the 'sore shoulder' wording (Day 4 single-leg RDL)", () => {
    expect(injurySectionLine(itemOn("2026-11-05", "single_leg_rdl"), true)).toMatch(
      /^Can load a sore shoulder\. While your shoulder is flagged, .+ replaces it: 3 × 10–12/,
    );
  });

  it("caution without a stand-in stays in, pain-free only (Day 1 Pallof press)", () => {
    expect(injurySectionLine(itemOn("2026-11-02", "pallof_press"), true)).toBe(
      "Can load a sore shoulder. While your shoulder is flagged, it stays in, pain-free only.",
    );
  });

  it("is undefined for an untagged exercise (Cossack squat)", () => {
    expect(injurySectionLine(itemOn("2026-11-03", "cossack_squat"), true)).toBeUndefined();
  });

  it("is undefined for a tagged exercise while the shoulder is not flagged (note c)", () => {
    expect(injurySectionLine(itemOn("2026-11-02", "pull_up"), false)).toBeUndefined();
    expect(injurySectionLine(itemOn("2026-11-05", "kettlebell_swing"), false)).toBeUndefined();
  });
});
