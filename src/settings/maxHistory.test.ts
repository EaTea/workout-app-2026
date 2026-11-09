import { describe, expect, it } from "vitest";
import { maxInEffectOn, recordMax, sortedHistory, withLatestMax } from "./maxHistory";

describe("sortedHistory", () => {
  it("puts unknown-date entries first, then dated ones oldest first", () => {
    expect(
      sortedHistory([
        { savedOn: "2026-12-18", reps: 14 },
        { savedOn: null, reps: 10 },
        { savedOn: "2026-11-02", reps: 12 },
      ]),
    ).toEqual([
      { savedOn: null, reps: 10 },
      { savedOn: "2026-11-02", reps: 12 },
      { savedOn: "2026-12-18", reps: 14 },
    ]);
  });
});

describe("recordMax", () => {
  it("appends a new day's entry and leaves the input alone", () => {
    const history = [{ savedOn: "2026-11-02", reps: 12 }];
    expect(recordMax(history, 14, "2026-12-18")).toEqual([
      { savedOn: "2026-11-02", reps: 12 },
      { savedOn: "2026-12-18", reps: 14 },
    ]);
    expect(history).toHaveLength(1);
  });

  it("replaces an entry already dated that day", () => {
    const history = [{ savedOn: "2026-11-02", reps: 12 }, { savedOn: "2026-12-18", reps: 14 }];
    expect(recordMax(history, 13, "2026-12-18")).toEqual([
      { savedOn: "2026-11-02", reps: 12 },
      { savedOn: "2026-12-18", reps: 13 },
    ]);
  });
});

describe("maxInEffectOn", () => {
  const history = [{ savedOn: "2026-11-02", reps: 12 }, { savedOn: "2026-12-18", reps: 14 }];

  it("uses the latest entry dated on or before the day", () => {
    expect(maxInEffectOn(history, "2026-12-14")).toBe(12);
    expect(maxInEffectOn(history, "2026-12-18")).toBe(14);
    expect(maxInEffectOn(history, "2027-01-01")).toBe(14);
  });

  it("falls back to the earliest entry before the first one", () => {
    expect(maxInEffectOn(history, "2026-10-01")).toBe(12);
  });

  it("treats an unknown-date entry as earlier than any day", () => {
    expect(maxInEffectOn([{ savedOn: null, reps: 9 }], "2020-01-01")).toBe(9);
  });

  it("is undefined for an empty history", () => {
    expect(maxInEffectOn([], "2026-12-14")).toBeUndefined();
  });
});

describe("withLatestMax", () => {
  const history = [
    { savedOn: "2026-11-02", reps: 12 },
    { savedOn: "2026-12-18", reps: 14 },
  ];

  it("leaves a history that already ends in the max unchanged", () => {
    expect(withLatestMax(history, 14, "2026-12-18")).toEqual(history);
  });

  it("appends a newer dated max and replaces a same-day correction", () => {
    expect(withLatestMax(history, 15, "2026-12-21")).toEqual([...history, { savedOn: "2026-12-21", reps: 15 }]);
    expect(withLatestMax(history, 13, "2026-12-18")).toEqual([history[0], { savedOn: "2026-12-18", reps: 13 }]);
  });

  it("puts an undated max first, never last, and is a no-op the second time", () => {
    const once = withLatestMax(history, 16, null);
    expect(once).toEqual([{ savedOn: null, reps: 16 }, ...history]);
    expect(withLatestMax(once, 16, null)).toEqual(once);
  });

  it("starts a history for an exercise with none and does not modify its input", () => {
    expect(withLatestMax([], 12, null)).toEqual([{ savedOn: null, reps: 12 }]);
    const frozen = Object.freeze([...history]);
    expect(() => withLatestMax(frozen, 16, null)).not.toThrow();
  });
});
