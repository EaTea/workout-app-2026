import { describe, expect, it } from "vitest";
import { breakNoteLines, interleaveBreaks } from "./historyBreaks";

const weekBreak = { from: "2026-11-26", to: "2026-12-03", note: "Physio: rest the neck" };

/** Shortens expectations: "card <date>" and "break <from>". */
function labels(entries: ReturnType<typeof interleaveBreaks>): string[] {
  return entries.map((entry) => (entry.kind === "session" ? `card ${entry.date}` : `break ${entry.trainingBreak.from}`));
}

describe("interleaveBreaks", () => {
  it("puts a break between the cards before and after it", () => {
    const entries = interleaveBreaks(["2026-12-07", "2026-11-25"], [weekBreak], false);

    expect(labels(entries)).toEqual(["card 2026-12-07", "break 2026-11-26", "card 2026-11-25"]);
  });

  it("puts a break newer than every card first, and one older than every card last", () => {
    const older = { from: "2026-10-01", to: "2026-10-04" };
    const entries = interleaveBreaks(["2026-11-25"], [older, weekBreak], false);

    expect(labels(entries)).toEqual(["break 2026-11-26", "card 2026-11-25", "break 2026-10-01"]);
  });

  it("puts a break before a card of its own first day", () => {
    const entries = interleaveBreaks(["2026-11-26"], [weekBreak], false);

    expect(labels(entries)).toEqual(["break 2026-11-26", "card 2026-11-26"]);
  });

  it("leaves out breaks older than the oldest shown card while older weeks are hidden", () => {
    const older = { from: "2026-10-01", to: "2026-10-04" };
    const entries = interleaveBreaks(["2026-11-25"], [older, weekBreak], true);

    expect(labels(entries)).toEqual(["break 2026-11-26", "card 2026-11-25"]);
  });

  it("lists every break when there are no cards", () => {
    expect(labels(interleaveBreaks([], [weekBreak], false))).toEqual(["break 2026-11-26"]);
    expect(labels(interleaveBreaks([], [weekBreak], true))).toEqual(["break 2026-11-26"]);
  });
});

describe("breakNoteLines", () => {
  it("gives the title and the note", () => {
    expect(breakNoteLines(weekBreak)).toEqual(["On a break · 26 Nov to 2 Dec", "Physio: rest the neck"]);
  });

  it("gives no note line when there is no note", () => {
    expect(breakNoteLines({ from: "2026-11-26", to: "2026-12-03" })[1]).toBeUndefined();
  });
});
