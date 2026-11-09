import { describe, expect, it } from "vitest";
import { hasTodayChanged, persistSettings, resolveToday, SAVE_FAILED_MESSAGE } from "./app";

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

describe("persistSettings", () => {
  const settings = { startDate: "2026-11-02", maxReps: {}, maxSavedOn: {} };

  it("returns null when the write succeeds", () => {
    const storage = { setItem: () => undefined } as unknown as Storage;
    expect(persistSettings(settings, storage)).toBeNull();
  });

  it("returns an error message when storage throws", () => {
    const storage = {
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    } as unknown as Storage;
    expect(persistSettings(settings, storage)).toBe(SAVE_FAILED_MESSAGE);
  });
});

describe("hasTodayChanged", () => {
  it("is false on the same local day and true after midnight", () => {
    expect(hasTodayChanged("2026-11-09", "", new Date(2026, 10, 9, 23, 59))).toBe(false);
    expect(hasTodayChanged("2026-11-09", "", new Date(2026, 10, 10, 0, 0))).toBe(true);
  });

  it("never changes while a valid ?date= preview pins the date", () => {
    expect(hasTodayChanged("2026-12-25", "?date=2026-12-25", new Date(2026, 10, 10, 0, 1))).toBe(false);
  });

  it("follows the real date when the ?date= value is invalid", () => {
    expect(hasTodayChanged("2026-11-09", "?date=banana", new Date(2026, 10, 10, 0, 1))).toBe(true);
  });
});
