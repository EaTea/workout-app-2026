import { describe, expect, it } from "vitest";
import type { TrainingBreak } from "./model";
import { breakOn, endBreak } from "./operations";
import { breaksFromWire, breaksToWire } from "./wire";

describe("breaks wire mapping", () => {
  it("round-trips breaks, leaving an absent note out of the JSON", () => {
    const breaks: TrainingBreak[] = [
      { from: "2026-10-01", to: "2026-10-04" },
      { from: "2026-11-26", to: "2026-12-03", note: "Physio: rest the neck" },
    ];

    const wire = breaksToWire(breaks);

    expect(wire).toEqual({
      version: 1,
      breaks: [
        { from: "2026-10-01", to: "2026-10-04" },
        { from: "2026-11-26", to: "2026-12-03", note: "Physio: rest the neck" },
      ],
    });
    expect(breaksFromWire(JSON.parse(JSON.stringify(wire)))).toEqual(breaks);
  });

  it.each([
    ["null", null],
    ["a string", "x"],
    ["an array", []],
    ["a wrong version", { version: 2, breaks: [{ from: "2026-11-26", to: "2026-12-03" }] }],
    ["a missing version", { breaks: [] }],
    ["breaks not a list", { version: 1, breaks: {} }],
  ])("loads nothing for %s", (_name, wire) => {
    expect(breaksFromWire(wire)).toEqual([]);
  });

  it("skips bad entries and keeps good ones", () => {
    const wire = {
      version: 1,
      breaks: [
        null,
        "x",
        { from: "2026-02-30", to: "2026-03-05" },
        { from: "2026-03-01", to: "2026-03-35" },
        { from: "2026-03-01" },
        { from: 5, to: "2026-03-05" },
        { from: "2026-03-05", to: "2026-03-05" },
        { from: "2026-03-05", to: "2026-03-01" },
        { from: "2026-03-01", to: "2026-03-05", note: 42 },
        { from: "2026-04-01", to: "2026-04-03" },
      ],
    };

    expect(breaksFromWire(wire)).toEqual([{ from: "2026-04-01", to: "2026-04-03" }]);
  });

  it("trims notes and drops empty or whitespace-only ones", () => {
    const wire = {
      version: 1,
      breaks: [
        { from: "2026-03-01", to: "2026-03-05", note: "  rest  " },
        { from: "2026-04-01", to: "2026-04-05", note: "   " },
        { from: "2026-05-01", to: "2026-05-05", note: "" },
      ],
    };

    expect(breaksFromWire(wire)).toEqual([
      { from: "2026-03-01", to: "2026-03-05", note: "rest" },
      { from: "2026-04-01", to: "2026-04-05" },
      { from: "2026-05-01", to: "2026-05-05" },
    ]);
  });

  it("returns breaks sorted by from", () => {
    const wire = {
      version: 1,
      breaks: [
        { from: "2026-06-01", to: "2026-06-03" },
        { from: "2026-01-01", to: "2026-01-03" },
      ],
    };

    expect(breaksFromWire(wire).map((trainingBreak) => trainingBreak.from)).toEqual(["2026-01-01", "2026-06-01"]);
  });

  it("merges overlapping entries into one, keeping the first entry's note, and leaves touching ones apart", () => {
    const wire = {
      version: 1,
      breaks: [
        { from: "2026-11-24", to: "2026-12-03", note: "second" },
        { from: "2026-11-20", to: "2026-12-05", note: "first" },
        { from: "2026-12-05", to: "2026-12-08" },
      ],
    };

    expect(breaksFromWire(wire)).toEqual([
      { from: "2026-11-20", to: "2026-12-05", note: "first" },
      { from: "2026-12-05", to: "2026-12-08" },
    ]);
  });

  it("lets endBreak end a long imported stretch: [1 Jan-31 Dec, 20 Nov-5 Dec, 24 Nov-3 Dec] ended on 26 Nov is not a break on 26 Nov", () => {
    const loaded = breaksFromWire({
      version: 1,
      breaks: [
        { from: "2026-01-01", to: "2026-12-31" },
        { from: "2026-11-20", to: "2026-12-05" },
        { from: "2026-11-24", to: "2026-12-03" },
      ],
    });
    const ended = endBreak(loaded, "2026-11-26");

    expect(loaded).toEqual([{ from: "2026-01-01", to: "2026-12-31" }]);
    expect(breakOn(ended, "2026-11-26")).toBeUndefined();
    expect(breakOn(ended, "2026-11-25")).toBeDefined();
  });
});
