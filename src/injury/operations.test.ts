import { describe, expect, it } from "vitest";
import type { Injury } from "./model";
import { wasAreaInjuredRecently } from "./operations";

const open: Injury = { area: "shoulder", side: "right", from: "2026-11-22" };
const cleared: Injury = { area: "shoulder", side: "right", from: "2026-11-01", to: "2026-11-10" };

describe("wasAreaInjuredRecently", () => {
  it("is true while the flag is open, and false before it started", () => {
    expect(wasAreaInjuredRecently([open], "shoulder", "2026-11-22")).toBe(true);
    expect(wasAreaInjuredRecently([open], "shoulder", "2027-03-01")).toBe(true);
    expect(wasAreaInjuredRecently([open], "shoulder", "2026-11-21")).toBe(false);
  });

  it("counts a flag cleared up to 28 days before the date, and not 29", () => {
    expect(wasAreaInjuredRecently([cleared], "shoulder", "2026-11-09")).toBe(true); // still active
    expect(wasAreaInjuredRecently([cleared], "shoulder", "2026-12-08")).toBe(true); // cleared exactly 28 days earlier
    expect(wasAreaInjuredRecently([cleared], "shoulder", "2026-12-09")).toBe(false);
  });

  it("ignores a flag cleared the day it was set (never active)", () => {
    expect(wasAreaInjuredRecently([{ ...open, to: "2026-11-22" }], "shoulder", "2026-11-25")).toBe(false);
  });

  it("is false with no injuries", () => {
    expect(wasAreaInjuredRecently([], "shoulder", "2026-11-25")).toBe(false);
  });
});
