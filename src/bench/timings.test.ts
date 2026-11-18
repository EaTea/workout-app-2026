import { describe, expect, it } from "vitest";
import { formatTimingRow, summarizeTimings } from "./timings";

describe("summarizeTimings", () => {
  it("takes the middle value for an odd count", () => {
    expect(summarizeTimings([300, 100, 200])).toEqual({ runs: 3, min: 100, median: 200, max: 300 });
  });

  it("averages the two middle values for an even count", () => {
    expect(summarizeTimings([40, 10, 30, 20])).toEqual({ runs: 4, min: 10, median: 25, max: 40 });
  });

  it("handles a single run", () => {
    expect(summarizeTimings([7])).toEqual({ runs: 1, min: 7, median: 7, max: 7 });
  });

  it("does not reorder the caller's list", () => {
    const input = [3, 1, 2];
    summarizeTimings(input);
    expect(input).toEqual([3, 1, 2]);
  });

  it("throws on an empty list", () => {
    expect(() => summarizeTimings([])).toThrow();
  });
});

describe("formatTimingRow", () => {
  it("prints label, set count with separators, median and spread", () => {
    const row = formatTimingRow("2 years", 14503, { runs: 11, min: 330, median: 380, max: 450 });
    expect(row).toBe("2 years  14,503 sets  median 380 ms  (min 330, max 450, 11 runs)");
  });

  it("rounds fractional milliseconds", () => {
    const row = formatTimingRow("empty", 0, { runs: 4, min: 10.4, median: 25.5, max: 40.6 });
    expect(row).toBe("empty  0 sets  median 26 ms  (min 10, max 41, 4 runs)");
  });
});
