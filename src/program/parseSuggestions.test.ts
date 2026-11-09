import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseProgram } from "./parse";

/** Parses a copy of the real program.json after `mutate` has added a field, returning the warnings. */
function warningsAfter(mutate: (json: any) => void) {
  const json = JSON.parse(readFileSync("public/program.json", "utf-8"));
  mutate(json);
  return parseProgram(json).warnings;
}

describe("unknown-field warnings suggest the field that was probably meant", () => {
  it("suggests weeklyIncrease for weeklyIncreese (one letter off)", () => {
    const warnings = warningsAfter((json) => (json.days[0].blocks[1].items[0].weeklyIncreese = "+1 rep"));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.suggestion).toBe("weeklyIncrease");
    expect(warnings[0]?.message).toBe('unknown field, ignored \u2014 did you mean "weeklyIncrease"?');
  });

  it("suggests restSec for restsec (different capitalisation)", () => {
    const warnings = warningsAfter((json) => (json.days[0].blocks[1].items[0].restsec = 30));
    expect(warnings[0]?.suggestion).toBe("restSec");
  });

  it("gives no suggestion for a field that is not close to any known one (notes)", () => {
    const warnings = warningsAfter((json) => (json.exercises.pull_up.notes = "x"));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.suggestion).toBeUndefined();
    expect(warnings[0]?.message).not.toContain("did you mean");
  });
});
