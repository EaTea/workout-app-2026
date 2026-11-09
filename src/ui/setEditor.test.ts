import { describe, expect, it } from "vitest";
import { steppedValue, type StepperNumberRules } from "./setEditor";

const plainRules: StepperNumberRules = { round: Math.round };

describe("steppedValue", () => {
  it("steps a number up and down, flooring at the minimum", () => {
    expect(steppedValue(5, 1, 0, 1, false, plainRules)).toBe(6);
    expect(steppedValue(5, -1, 0, 1, false, plainRules)).toBe(4);
    expect(steppedValue(0, -1, 0, 1, false, plainRules)).toBe(0);
  });

  it("caps stepping up at rules.maximum", () => {
    const capped: StepperNumberRules = { round: Math.round, maximum: 100 };
    expect(steppedValue(99, 1, 0, 1, false, capped)).toBe(100);
    expect(steppedValue(100, 1, 0, 1, false, capped)).toBe(100);
    expect(steppedValue(100, -1, 0, 1, false, capped)).toBe(99);
  });

  it("has no cap when maximum is absent", () => {
    expect(steppedValue(1000, 1, 0, 1, false, plainRules)).toBe(1001);
  });

  it("lets a stepper with zeroMeansNone step down to blank", () => {
    expect(steppedValue(1, -1, 0, 1, true, plainRules)).toBeUndefined();
  });

  it("starts a blank stepper at the minimum on +, and leaves it blank on −, without a starting value", () => {
    expect(steppedValue(undefined, 1, 1, 1, false, plainRules)).toBe(1);
    expect(steppedValue(undefined, -1, 1, 1, false, plainRules)).toBeUndefined();
  });

  it("starts a blank stepper at the starting value on either button, within the limits", () => {
    const withStart: StepperNumberRules = { round: Math.round, maximum: 100, startingValue: 12 };
    expect(steppedValue(undefined, 1, 0, 1, false, withStart)).toBe(12);
    expect(steppedValue(undefined, -1, 0, 1, false, withStart)).toBe(12);
    expect(steppedValue(undefined, 1, 0, 1, false, { ...withStart, startingValue: 500 })).toBe(100);
  });
});
