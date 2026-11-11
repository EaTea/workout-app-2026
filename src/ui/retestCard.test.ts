import { describe, expect, it } from "vitest";
import { joinExerciseNames } from "./retestCard";

describe("joinExerciseNames", () => {
  it("lower-cases and joins names for the card's intro sentence", () => {
    expect(joinExerciseNames(["Pull-ups"])).toBe("pull-ups");
    expect(joinExerciseNames(["Pull-ups", "Dips"])).toBe("pull-ups and dips");
    expect(joinExerciseNames(["Pull-ups", "Dips", "Push-ups"])).toBe("pull-ups, dips and push-ups");
    expect(joinExerciseNames([])).toBe("");
  });
});
