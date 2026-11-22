import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseProgram } from "../program/parse";
import type { ItemView } from "../program/schedule";
import { buildSession } from "../program/schedule";
import { injurySectionLine } from "./injurySheetText";

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

describe("injurySectionLine", () => {
  it("avoid with a stand-in names it and this week's dose (Day 4 kettlebell swing, W1)", () => {
    expect(injurySectionLine(itemOn("2026-11-05", "kettlebell_swing"))).toMatch(
      /^Loads the shoulder\. While your shoulder is flagged, Broad jumps, hands on hips replaces it: 5 \/ min, 8 min/,
    );
  });

  it("avoid without a stand-in says it is left out and can be added back at half sets (Day 1 pull-ups)", () => {
    expect(injurySectionLine(itemOn("2026-11-02", "pull_up"))).toBe(
      "Loads the shoulder. While your shoulder is flagged, it's left out, and you can add it back for a day at half the sets.",
    );
  });

  it("caution with a stand-in uses the 'sore shoulder' wording (Day 4 single-leg RDL)", () => {
    expect(injurySectionLine(itemOn("2026-11-05", "single_leg_rdl"))).toMatch(
      /^Can load a sore shoulder\. While your shoulder is flagged, .+ replaces it: 3 × 10–12/,
    );
  });

  it("caution without a stand-in stays in, pain-free only (Day 1 Pallof press)", () => {
    expect(injurySectionLine(itemOn("2026-11-02", "pallof_press"))).toBe(
      "Can load a sore shoulder. While your shoulder is flagged, it stays in, pain-free only.",
    );
  });

  it("is undefined for an untagged exercise (Cossack squat)", () => {
    expect(injurySectionLine(itemOn("2026-11-03", "cossack_squat"))).toBeUndefined();
  });
});
