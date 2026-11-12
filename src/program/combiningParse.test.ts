import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseProgram } from "./parse";

/**
 * Parsing and validating `combining.pairs` (rule 1 of the PR 23 design):
 * the shipped files, then each kind of rejected pair.
 */

/** Reads a shipped program file as untyped JSON, the way the app receives it. */
function readJson(fileName: string): any {
  return JSON.parse(readFileSync(`public/${fileName}`, "utf-8"));
}

/** Parses the real Explosive Endurance file after `mutate` changed its `combining` section. */
function parseWithPairs(pairs: unknown) {
  const json = readJson("program.json");
  json.combining = { pairs };
  return parseProgram(json);
}

describe("combining.pairs in the shipped programs", () => {
  it("Explosive Endurance allows Day 1+2, 2+3, 3+4 and 5+6 and has no warnings about them", () => {
    const { program, warnings } = parseProgram(readJson("program.json"));
    expect(program.combinePairs).toEqual([[1, 2], [2, 3], [3, 4], [5, 6]]);
    expect(warnings.filter((warning) => warning.path.startsWith("combining"))).toEqual([]);
  });

  it("Steady Strength has no combining section, so it has no pairs", () => {
    expect(parseProgram(readJson("steady-strength.json")).program.combinePairs).toEqual([]);
  });
});

describe("parseProgram combining validation", () => {
  it("treats an absent section as no pairs", () => {
    const json = readJson("program.json");
    delete json.combining;
    expect(parseProgram(json).program.combinePairs).toEqual([]);
  });

  it("accepts an empty pairs list", () => {
    expect(parseWithPairs([]).program.combinePairs).toEqual([]);
  });

  it.each([
    ["the rest day as the later day", [6, 7], "combining.pairs[0]", "day 7 is not a training day"],
    ["the rest day as the earlier day", [7, 1], "combining.pairs[0]", "day 7 is not a training day"],
    ["a day outside 1-6", [0, 1], "combining.pairs[0]", "day 0 is not a training day"],
    ["a day with no entry (9)", [8, 9], "combining.pairs[0]", "day 8 is not a training day"],
    ["the same day twice", [3, 3], "combining.pairs[0]", "cannot be combined with itself"],
    ["days that are not adjacent", [1, 3], "combining.pairs[0]", "not next to each other"],
    ["the higher day first", [2, 1], "combining.pairs[0]", "not next to each other"],
    ["a non-whole number", [1, 1.5], "combining.pairs[0]", "whole day numbers"],
    ["a text day", [1, "2"], "combining.pairs[0]", "whole day numbers"],
    ["three numbers", [1, 2, 3], "combining.pairs[0]", "expected a pair"],
    ["one number", [1], "combining.pairs[0]", "expected a pair"],
    ["a non-list entry", "1-2", "combining.pairs[0]", "expected a pair"],
  ])("ignores a pair with %s and warns", (_name, badPair, expectedPath, expectedText) => {
    const { program, warnings } = parseWithPairs([badPair]);
    expect(program.combinePairs).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.path).toBe(expectedPath);
    expect(warnings[0]!.message).toContain(expectedText);
  });

  it("keeps the good pairs when one is bad, and names the bad pair's index", () => {
    const { program, warnings } = parseWithPairs([[1, 2], [4, 6], [5, 6]]);
    expect(program.combinePairs).toEqual([[1, 2], [5, 6]]);
    expect(warnings.map((warning) => warning.path)).toEqual(["combining.pairs[1]"]);
  });

  it("keeps a repeated pair once", () => {
    expect(parseWithPairs([[1, 2], [1, 2]]).program.combinePairs).toEqual([[1, 2]]);
  });

  it("warns about an unknown field in the section, with a suggestion for a near miss", () => {
    const json = readJson("program.json");
    json.combining.pair = [[1, 2]];
    const { warnings } = parseProgram(json);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ path: "combining.pair", suggestion: "pairs" });
  });

  it("throws when the section is not an object or pairs is missing or not a list", () => {
    const withCombining = (value: unknown) => {
      const json = readJson("program.json");
      json.combining = value;
      return () => parseProgram(json);
    };
    expect(withCombining(5)).toThrow("combining: expected an object");
    expect(withCombining({})).toThrow("combining.pairs: field is missing");
    expect(withCombining({ pairs: "1-2" })).toThrow("combining.pairs: expected a list");
  });
});
