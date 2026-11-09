import { describe, expect, it } from "vitest";
import { summaryLines } from "./importSection";

describe("summaryLines", () => {
  it("lists counts, the date range and the start date", () => {
    expect(summaryLines({ sessionCount: 2, setCount: 9, checkCount: 1, firstSessionDate: "2026-11-02", lastSessionDate: "2026-11-30", startDate: "2026-11-02" })).toEqual([
      "2 sessions", "9 sets", "1 weekly check", "Dates: 2026-11-02 to 2026-11-30", "Start date: 2026-11-02",
    ]);
  });

  it("uses singular words, one date for a single day, and says when there are no dates or start date", () => {
    expect(summaryLines({ sessionCount: 1, setCount: 1, checkCount: 0, firstSessionDate: "2026-11-02", lastSessionDate: "2026-11-02", startDate: null })).toEqual([
      "1 session", "1 set", "0 weekly checks", "Date: 2026-11-02", "Start date: not set",
    ]);
    expect(summaryLines({ sessionCount: 0, setCount: 0, checkCount: 0, startDate: null })[3]).toBe("No logged dates");
  });
});
