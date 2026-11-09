import { describe, expect, it } from "vitest";
import { validateSettingsForm } from "./settings";

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
    for (const bad of ["0", "-3", "2.5", "abc"]) {
      const result = validateSettingsForm({ startDate: "2026-11-02", maxReps: { dip: bad } });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.maxReps.dip).toBeDefined();
      }
    }
  });
});
