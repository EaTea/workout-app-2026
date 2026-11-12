import { describe, expect, it } from "vitest";
import { combinedNoteText, offerButtonLabel } from "./combineCards";

describe("combine card texts", () => {
  it("labels the two kinds of offer", () => {
    expect(offerButtonLabel({ kind: "addNext", day: 2, date: "2026-11-10", combine: { hostDay: 1, addedDay: 2, addedDate: "2026-11-10" } })).toBe("Short on time? Add Day 2 to today");
    expect(offerButtonLabel({ kind: "addMissed", day: 3, date: "2026-11-11", combine: { hostDay: 4, addedDay: 3, addedDate: "2026-11-11" } })).toBe("Add missed Day 3 to today");
  });

  it("words the day plan note with the other day and its date", () => {
    expect(combinedNoteText(2, "2026-11-10")).toBe("Combined with Day 2 on 10 Nov");
  });
});
