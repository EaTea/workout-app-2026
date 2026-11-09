import { describe, expect, it } from "vitest";
import { KILOGRAM_STEP, MAXIMUM_KILOGRAMS, parseKilogramInput, roundToOneDecimal } from "./kilograms";

describe("parseKilogramInput", () => {
  it("accepts whole numbers and one decimal", () => {
    expect(parseKilogramInput("22")).toEqual({ isValid: true, kilograms: 22 });
    expect(parseKilogramInput("22.5")).toEqual({ isValid: true, kilograms: 22.5 });
    expect(parseKilogramInput(" 7.5 ")).toEqual({ isValid: true, kilograms: 7.5 });
  });

  it("accepts a decimal comma", () => {
    expect(parseKilogramInput("22,5")).toEqual({ isValid: true, kilograms: 22.5 });
  });

  it("accepts the limits, 0 (no load) and 500", () => {
    expect(parseKilogramInput("0")).toEqual({ isValid: true, kilograms: 0 });
    expect(parseKilogramInput(String(MAXIMUM_KILOGRAMS))).toEqual({ isValid: true, kilograms: 500 });
  });

  it("rejects anything else", () => {
    for (const text of ["", "  ", "abc", "-5", "22.55", "22.", ".5", "500.5", "501", "1e2", "2 2"]) {
      expect(parseKilogramInput(text).isValid, text).toBe(false);
    }
  });
});

describe("kilogram steps", () => {
  it("steps in 2.5 kg", () => {
    expect(KILOGRAM_STEP).toBe(2.5);
  });

  it("rounds away floating-point noise", () => {
    expect(roundToOneDecimal(22.3 + 2.5 + 0.1 - 0.1)).toBe(24.8);
    expect(roundToOneDecimal(0.1 + 0.2)).toBe(0.3);
  });
});
