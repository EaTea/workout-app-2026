import { describe, expect, it } from "vitest";
import { summaryLines } from "./importSection";

describe("summaryLines", () => {
  it("lists counts, the date range and the start date", () => {
    expect(summaryLines({ sessionCount: 2, setCount: 9, checkCount: 1, firstSessionDate: "2026-11-02", lastSessionDate: "2026-11-30", startDate: "2026-11-02" })).toEqual([
      "2 sessions", "9 sets", "1 weekly check", "Dates: 2026-11-02 to 2026-11-30", "Start date: 2026-11-02", "Injuries: none in the file (yours are kept)", "Breaks: none in the file (yours are kept)",
    ]);
  });

  it("uses singular words, one date for a single day, and says when there are no dates or start date", () => {
    expect(summaryLines({ sessionCount: 1, setCount: 1, checkCount: 0, firstSessionDate: "2026-11-02", lastSessionDate: "2026-11-02", startDate: null })).toEqual([
      "1 session", "1 set", "0 weekly checks", "Date: 2026-11-02", "Start date: not set", "Injuries: none in the file (yours are kept)", "Breaks: none in the file (yours are kept)",
    ]);
    expect(summaryLines({ sessionCount: 0, setCount: 0, checkCount: 0, startDate: null })[3]).toBe("No logged dates");
  });

  it("says when the file's injuries replace the stored ones", () => {
    const lines = summaryLines({ sessionCount: 0, setCount: 0, checkCount: 0, startDate: null, injuryCount: 2 });

    expect(lines[lines.length - 2]).toBe("Injuries: 2 (replace yours)");
  });

  it("says when the file's breaks replace the stored ones", () => {
    const lines = summaryLines({ sessionCount: 0, setCount: 0, checkCount: 0, startDate: null, breakCount: 1 });

    expect(lines[lines.length - 1]).toBe("Breaks: 1 (replace yours)");
  });

  it("starts with the local export date when the file has one", () => {
    const lines = summaryLines({ exportedAt: "2026-11-09T12:00:00.000Z", sessionCount: 0, setCount: 0, checkCount: 0, startDate: null });

    expect(lines[0]).toMatch(/^Exported 2026-11-(09|10)$/); // the local date depends on the machine's time zone
  });
});
