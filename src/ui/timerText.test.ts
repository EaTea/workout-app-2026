import { describe, expect, it } from "vitest";
import { phaseWordFor, roundCounterText, skipButtonAccessibleName, skipButtonText } from "./timerText";

describe("timer overlay text", () => {
  it("names the gear-up phase GEAR UP, and finished is always DONE", () => {
    expect(phaseWordFor("gearUp", false)).toBe("GEAR UP");
    expect(phaseWordFor("work", false)).toBe("WORK");
    expect(phaseWordFor("rest", false)).toBe("REST");
    expect(phaseWordFor("minute", false)).toBe("");
    expect(phaseWordFor("gearUp", true)).toBe("DONE");
  });

  it("does not count the gear-up as a round", () => {
    expect(roundCounterText("gearUp", 1, 5)).toBe("Round 1 starts after the countdown");
    expect(roundCounterText("work", 1, 5)).toBe("Round 1 of 5");
  });

  it("the Skip button reads Ready during the gear-up and goes back to Skip", () => {
    for (const status of ["running", "paused"] as const) {
      expect(skipButtonText("gearUp", status)).toBe("Ready ›");
      expect(skipButtonAccessibleName("gearUp", status)).toBe("Ready, start round 1");
    }
    expect(skipButtonText("rest", "running")).toBe("Skip ›");
    expect(skipButtonAccessibleName("rest", "running")).toBeUndefined();
  });

  it("before Start the gear-up Skip button is still the plain Skip", () => {
    expect(skipButtonText("gearUp", "ready")).toBe("Skip ›");
    expect(skipButtonAccessibleName("gearUp", "ready")).toBeUndefined();
  });
});
