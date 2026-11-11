import { describe, expect, it } from "vitest";
import { previewFirstDayHref, todayHref } from "./overview";

describe("Overview links", () => {
  it("keeps the query string on the link to Today", () => {
    expect(todayHref("?date=2026-11-09")).toBe("?date=2026-11-09#/today");
    expect(todayHref("")).toBe("#/today");
  });

  it("previews the first day by setting the date query", () => {
    expect(previewFirstDayHref("", "2026-11-16")).toBe("?date=2026-11-16#/today");
  });

  it("replaces an existing date and keeps other query parameters", () => {
    expect(previewFirstDayHref("?date=2026-11-04&x=1", "2026-11-16")).toBe("?date=2026-11-16&x=1#/today");
  });
});
