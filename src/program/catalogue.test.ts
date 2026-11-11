import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCatalogue } from "./catalogue";

/** Returns the message parseCatalogue throws for `json`, or fails the test if it doesn't throw. */
function errorMessageFor(json: unknown): string {
  try {
    parseCatalogue(json);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("expected parseCatalogue to throw");
}

describe("parseCatalogue", () => {
  it("reads the real public/programs.json: Explosive Endurance, loaded from program.json", () => {
    const catalogue = parseCatalogue(JSON.parse(readFileSync("public/programs.json", "utf-8")));

    expect(catalogue.entries).toEqual([{ programId: "explosive-endurance", programUrl: "./program.json" }]);
  });

  it("keeps the order of several entries", () => {
    const catalogue = parseCatalogue({
      programs: [
        { id: "explosive-endurance", file: "program.json" },
        { id: "steady-strength", file: "steady-strength.json" },
      ],
    });

    expect(catalogue.entries.map((entry) => entry.programId)).toEqual(["explosive-endurance", "steady-strength"]);
    expect(catalogue.entries[1]?.programUrl).toBe("./steady-strength.json");
  });

  it("rejects something that is not an object", () => {
    expect(errorMessageFor([])).toMatch(/^programs\.json: expected an object/);
    expect(errorMessageFor(null)).toMatch(/^programs\.json: expected an object/);
  });

  it("rejects a missing or non-list `programs`", () => {
    expect(errorMessageFor({})).toBe("programs: expected a list but found nothing (field is missing)");
    expect(errorMessageFor({ programs: "x" })).toMatch(/^programs: expected a list/);
  });

  it("rejects an empty `programs` list", () => {
    expect(errorMessageFor({ programs: [] })).toMatch(/^programs: the list is empty/);
  });

  it("rejects an entry that is not an object", () => {
    expect(errorMessageFor({ programs: ["program.json"] })).toMatch(/^programs\[0\]: expected an object/);
  });

  it("rejects an entry missing id or file, naming the path", () => {
    expect(errorMessageFor({ programs: [{ file: "program.json" }] })).toMatch(/^programs\[0\]\.id: expected text/);
    expect(errorMessageFor({ programs: [{ id: "a", file: "a.json" }, { id: "b" }] })).toMatch(/^programs\[1\]\.file: expected text/);
    expect(errorMessageFor({ programs: [{ id: "", file: "a.json" }] })).toMatch(/^programs\[0\]\.id: expected text/);
  });

  it.each(["Steady Strength", "UPPER", "under_score", "-leading", "trailing-", "double--hyphen", "a/b", "ünï"])(
    "rejects the bad id %j",
    (id) => {
      expect(errorMessageFor({ programs: [{ id, file: "a.json" }] })).toMatch(/^programs\[0\]\.id: .*lowercase letters, digits and hyphens/);
    },
  );

  it("rejects a duplicate id, naming both entries", () => {
    const message = errorMessageFor({
      programs: [
        { id: "same", file: "a.json" },
        { id: "other", file: "b.json" },
        { id: "same", file: "c.json" },
      ],
    });

    expect(message).toBe('programs[2].id: duplicate id "same" (already used by programs[0])');
  });

  it.each(["program", "program.txt", "sub/program.json", "../program.json", "/program.json", "a..b.json", ".json", "https://x.test/p.json", "a\\b.json"])(
    "rejects the bad file %j",
    (file) => {
      expect(errorMessageFor({ programs: [{ id: "a", file }] })).toMatch(/^programs\[0\]\.file: .*plain file name ending in \.json/);
    },
  );
});
