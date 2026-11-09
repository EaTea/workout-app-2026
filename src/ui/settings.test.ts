import { describe, expect, it } from "vitest";
import { stampMaxSavedDates, updateMaxHistory, validateSettingsForm } from "./settings";

describe("validateSettingsForm", () => {
  it("accepts a date and whole-number maxes, ignoring blanks", () => {
    expect(validateSettingsForm({ startDate: "2026-11-02", maxReps: { pull_up: "12", dip: " " } })).toEqual({
      ok: true,
      settings: { startDate: "2026-11-02", maxReps: { pull_up: 12 } },
    });
  });

  it("requires a start date and rejects impossible dates", () => {
    const missing = validateSettingsForm({ startDate: "", maxReps: {} });
    expect(missing.ok).toBe(false);
    const impossible = validateSettingsForm({ startDate: "2026-02-30", maxReps: {} });
    expect(impossible.ok).toBe(false);
  });

  it("rejects zero, negative, decimal and non-numeric maxes", () => {
    for (const bad of ["0", "-3", "2.5", "abc", "1e", "12.5", "1 2"]) {
      const result = validateSettingsForm({ startDate: "2026-11-02", maxReps: { dip: bad } });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.maxReps.dip).toBeDefined();
      }
    }
  });

  it("trims surrounding whitespace and treats blank as not tested", () => {
    const result = validateSettingsForm({ startDate: "2026-11-02", maxReps: { pull_up: " 12 ", dip: "" } });
    expect(result).toEqual({ ok: true, settings: { startDate: "2026-11-02", maxReps: { pull_up: 12 } } });
  });
});

describe("stampMaxSavedDates", () => {
  const previous = { maxSavedOn: { pull_up: "2026-11-02" } };
  const none = new Set<string>();

  it("stamps an edited max with today, even when the number is unchanged", () => {
    expect(stampMaxSavedDates(previous, { pull_up: 12, dip: 15 }, new Set(["pull_up"]), "2026-12-21")).toEqual({ pull_up: "2026-12-21" });
  });

  it("stamps an edited max whose number changed", () => {
    expect(stampMaxSavedDates(previous, { pull_up: 15 }, new Set(["pull_up"]), "2026-12-21")).toEqual({ pull_up: "2026-12-21" });
  });

  it("keeps the date of an untouched max", () => {
    expect(stampMaxSavedDates(previous, { pull_up: 12, dip: 15 }, new Set(["dip"]), "2026-12-21")).toEqual({
      pull_up: "2026-11-02",
      dip: "2026-12-21",
    });
  });

  it("stamps a newly entered (edited) max", () => {
    expect(stampMaxSavedDates({ maxSavedOn: {} }, { dip: 15 }, new Set(["dip"]), "2026-11-09")).toEqual({ dip: "2026-11-09" });
  });

  it("drops the date of a cleared max, even if it was edited", () => {
    expect(stampMaxSavedDates(previous, { dip: 15 }, new Set(["pull_up"]), "2026-12-21")).toEqual({});
  });

  it("stamps nothing when no max was edited (start-date-only save)", () => {
    expect(stampMaxSavedDates(previous, { pull_up: 12, dip: 15 }, none, "2026-12-21")).toEqual({ pull_up: "2026-11-02" });
  });

  it("leaves an untouched max without a date (v1 data) undated", () => {
    expect(stampMaxSavedDates(previous, { pull_up: 12, dip: 15 }, none, "2026-12-21")).not.toHaveProperty("dip");
  });
});

describe("updateMaxHistory", () => {
  const previous = {
    maxSavedOn: { pull_up: "2026-11-02" },
    maxHistory: { pull_up: [{ savedOn: "2026-11-02", reps: 12 }] },
  };

  it("appends an edited max dated today", () => {
    expect(updateMaxHistory(previous, { pull_up: 14 }, new Set(["pull_up"]), "2026-12-18")).toEqual({
      pull_up: [{ savedOn: "2026-11-02", reps: 12 }, { savedOn: "2026-12-18", reps: 14 }],
    });
  });

  it("replaces today's entry when saved twice on the same day", () => {
    expect(updateMaxHistory(previous, { pull_up: 14 }, new Set(["pull_up"]), "2026-11-02")).toEqual({
      pull_up: [{ savedOn: "2026-11-02", reps: 14 }],
    });
  });

  it("keeps an untouched max's history, and seeds one for a max with none (dated or unknown)", () => {
    const result = updateMaxHistory(
      { maxSavedOn: { dip: "2026-11-05" }, maxHistory: previous.maxHistory },
      { pull_up: 12, dip: 15, bench: 8 },
      new Set<string>(),
      "2026-12-18",
    );
    expect(result).toEqual({
      pull_up: [{ savedOn: "2026-11-02", reps: 12 }],
      dip: [{ savedOn: "2026-11-05", reps: 15 }],
      bench: [{ savedOn: null, reps: 8 }],
    });
  });

  it("keeps the history of a cleared max", () => {
    expect(updateMaxHistory(previous, {}, new Set(["pull_up"]), "2026-12-18")).toEqual(previous.maxHistory);
  });
});
