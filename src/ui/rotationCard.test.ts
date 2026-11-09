import { describe, expect, it } from "vitest";
import { rotationDismissedFromWire, rotationDismissedToWire } from "./rotationCard";

describe("rotation dismissal mapping", () => {
  it("round-trips a week number", () => {
    expect(rotationDismissedFromWire(rotationDismissedToWire(5))).toBe(5);
  });

  it("ignores missing or corrupt stored text", () => {
    expect(rotationDismissedFromWire(null)).toBeUndefined();
    expect(rotationDismissedFromWire("abc")).toBeUndefined();
    expect(rotationDismissedFromWire("0")).toBeUndefined();
    expect(rotationDismissedFromWire("5.5")).toBeUndefined();
  });
});
