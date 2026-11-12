import { describe, expect, it } from "vitest";
import type { ItemView } from "../program/schedule";
import { showMeHeaderText } from "./showMeButton";

/** An item shaped like Steady Strength's high wall sit: an interval of 3 rounds of 20 seconds. */
function wallSitItem(overrides: Partial<ItemView> = {}): ItemView {
  return {
    exercise: { id: "high_wall_sit", name: "High wall sit", category: "isometric", cues: [], evidence: { kind: "coachingPractice" }, progression: [], maxTested: false },
    format: "interval",
    sets: [],
    rounds: { min: 3, max: 3 },
    workSec: { min: 20, max: 20 },
    perSide: false,
    optional: false,
    ...overrides,
  };
}

describe("showMeHeaderText", () => {
  it("uses the exercise name and the same dose text as the row", () => {
    expect(showMeHeaderText(wallSitItem())).toEqual({ title: "High wall sit", dose: "3 × 20s" });
  });

  it("uses a rotated-in swap's own display name", () => {
    const rotated = wallSitItem({ rotatedIn: { displayName: "Swapped name", originalName: "High wall sit" } });
    expect(showMeHeaderText(rotated).title).toBe("Swapped name");
  });
});
