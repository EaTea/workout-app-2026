import { describe, expect, it } from "vitest";
import { rotationDismissedFromWire, rotationDismissedToWire } from "./rotationCard";

describe("rotation dismissal mapping", () => {
  it("round-trips a list of block first-weeks", () => {
    expect(rotationDismissedFromWire(rotationDismissedToWire([5]))).toEqual([5]);
    expect(rotationDismissedFromWire(rotationDismissedToWire([5, 13]))).toEqual([5, 13]);
  });

  it("still reads the older bare week number", () => {
    expect(rotationDismissedFromWire("5")).toEqual([5]);
  });

  it("ignores missing or corrupt stored text", () => {
    expect(rotationDismissedFromWire(null)).toEqual([]);
    expect(rotationDismissedFromWire("abc")).toEqual([]);
    expect(rotationDismissedFromWire("0")).toEqual([]);
    expect(rotationDismissedFromWire("5.5")).toEqual([]);
    expect(rotationDismissedFromWire('{"a":1}')).toEqual([]);
    expect(rotationDismissedFromWire('[5,"x",0,2.5,7]')).toEqual([5, 7]);
  });
});
