import { describe, expect, it } from "vitest";
import { maxInEffectOn, recordMax, sortedHistory } from "./maxHistory";

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
