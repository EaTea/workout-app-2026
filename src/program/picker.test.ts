import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { LoadedCatalogueEntry } from "./load";
import { buildProgramOverview } from "./overview";
import { parseProgram } from "./parse";
import { buildProgramPicker, programNamesById } from "./picker";

/** Loads a shipped program file the way the app does, as a catalogue entry. */
function loadedFromFile(programId: string, file: string): LoadedCatalogueEntry {
  const { program, warnings } = parseProgram(JSON.parse(readFileSync(`public/${file}`, "utf-8")));
  return { entry: { programId, programUrl: `./${file}` }, outcome: { kind: "loaded", program, warnings } };
}

const explosive = loadedFromFile("explosive-endurance", "program.json");
const steady = loadedFromFile("steady-strength", "steady-strength.json");
const brokenSteady: LoadedCatalogueEntry = {
  entry: steady.entry,
  outcome: { kind: "broken", error: "./steady-strength.json: days[1].focus: expected text" },
};

describe("buildProgramPicker", () => {
  it("makes one card per catalogue entry in catalogue order, from each program's own data", () => {
    const cards = buildProgramPicker([explosive, steady], undefined);

    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({ kind: "available", programId: "explosive-endurance", name: "Explosive Endurance Program", lengthWeeks: 8 });
    expect(cards[1]).toMatchObject({
      kind: "available",
      programId: "steady-strength",
      name: "Steady Strength",
      lengthWeeks: 8,
      trainingDaysPerWeek: 6,
      weeklyMinutes: 135,
    });
  });

  it("uses the same numbers as the Overview", () => {
    const card = buildProgramPicker([explosive], undefined)[0];
    const overview = buildProgramOverview(explosive.outcome.kind === "loaded" ? explosive.outcome.program : (undefined as never), {
      kind: "noStartDate",
    });

    expect(card).toMatchObject({
      goal: overview.goal,
      lengthWeeks: overview.lengthWeeks,
      trainingDaysPerWeek: overview.trainingDaysPerWeek,
      weeklyMinutes: overview.weeklyMinutes,
    });
  });

  it("marks only the active program as current", () => {
    const cards = buildProgramPicker([explosive, steady], "steady-strength");

    expect(cards.map((card) => card.isCurrent)).toEqual([false, true]);
  });

  it("marks nothing as current when the picker is the whole app", () => {
    expect(buildProgramPicker([explosive, steady], undefined).some((card) => card.isCurrent)).toBe(false);
  });

  it("turns a broken program into a broken card carrying its error, keeping the others", () => {
    const cards = buildProgramPicker([explosive, brokenSteady], "explosive-endurance");

    expect(cards[0]?.kind).toBe("available");
    expect(cards[1]).toEqual({
      kind: "broken",
      programId: "steady-strength",
      error: "./steady-strength.json: days[1].focus: expected text",
      isCurrent: false,
    });
  });

  it("can mark a broken program as current", () => {
    expect(buildProgramPicker([brokenSteady], "steady-strength")[0]).toMatchObject({ kind: "broken", isCurrent: true });
  });
});

describe("programNamesById", () => {
  it("maps loaded programs to their display names and leaves out broken ones", () => {
    expect(programNamesById([explosive, brokenSteady])).toEqual({ "explosive-endurance": "Explosive Endurance Program" });
    expect(programNamesById([explosive, steady])).toEqual({
      "explosive-endurance": "Explosive Endurance Program",
      "steady-strength": "Steady Strength",
    });
  });
});

describe("buildProgramPicker: safety note line", () => {
  it("gives Steady Strength's card its first safety note in full, and Explosive Endurance none", () => {
    const [explosiveCard, steadyCard] = buildProgramPicker([explosive, steady], undefined);

    expect(steadyCard).toMatchObject({ kind: "available" });
    if (steadyCard?.kind === "available") {
      expect(steadyCard.safetyNote).toMatch(/^This is not medical advice\. Check with your doctor or physiotherapist before starting/);
    }
    if (explosiveCard?.kind === "available") {
      expect(explosiveCard.safetyNote).toBeUndefined();
    }
  });
});
