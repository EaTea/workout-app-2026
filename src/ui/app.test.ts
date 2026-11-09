import { describe, expect, it } from "vitest";
import { resolveToday } from "./app";

describe("resolveToday", () => {
  const now = new Date(2026, 10, 9, 12, 0);

  it("uses the local date when there is no override", () => {
    expect(resolveToday("", now)).toBe("2026-11-09");
  });

  it("uses a valid ?date= override", () => {
    expect(resolveToday("?date=2026-12-25", now)).toBe("2026-12-25");
  });

  it("ignores an invalid override", () => {
    expect(resolveToday("?date=banana", now)).toBe("2026-11-09");
    expect(resolveToday("?date=2026-02-30", now)).toBe("2026-11-09");
  });
});
