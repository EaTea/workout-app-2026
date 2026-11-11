import { describe, expect, it } from "vitest";
import { chooseDeliveryMethod, exportFileName, isIosPlatform, isShareCancellation } from "./download";

describe("chooseDeliveryMethod", () => {
  it("shares only on iOS when files can be shared", () => {
    expect(chooseDeliveryMethod({ isIos: true, canShareFiles: true })).toBe("share");
    expect(chooseDeliveryMethod({ isIos: true, canShareFiles: false })).toBe("download");
    expect(chooseDeliveryMethod({ isIos: false, canShareFiles: true })).toBe("download");
    expect(chooseDeliveryMethod({ isIos: false, canShareFiles: false })).toBe("download");
  });
});

describe("isIosPlatform", () => {
  it("recognises iPhone, and iPadOS posing as a Mac, but not desktop or Android", () => {
    expect(isIosPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", "iPhone", 5)).toBe(true);
    expect(isIosPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "MacIntel", 5)).toBe(true);
    expect(isIosPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "MacIntel", 0)).toBe(false);
    expect(isIosPlatform("Mozilla/5.0 (Linux; Android 14)", "Linux armv8l", 5)).toBe(false);
  });
});

describe("exportFileName", () => {
  it("uses the local date and the extension", () => {
    expect(exportFileName("explosive-endurance", "csv", new Date(2026, 10, 9, 23, 59))).toBe("explosive-endurance-2026-11-09.csv");
    expect(exportFileName("explosive-endurance", "json", new Date(2026, 0, 5, 0, 1))).toBe("explosive-endurance-2026-01-05.json");
  });

  it("starts with the program id", () => {
    expect(exportFileName("steady-strength", "json", new Date(2026, 0, 5, 0, 1))).toBe("steady-strength-2026-01-05.json");
  });
});

describe("isShareCancellation", () => {
  it("is true only for an AbortError", () => {
    expect(isShareCancellation(new DOMException("cancelled", "AbortError"))).toBe(true);
    expect(isShareCancellation(new DOMException("nope", "NotAllowedError"))).toBe(false);
    expect(isShareCancellation(new Error("AbortError"))).toBe(false);
  });
});
