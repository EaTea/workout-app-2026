import { describe, expect, it } from "vitest";
import { shouldApplyWaitingUpdate } from "./register.ts";

describe("shouldApplyWaitingUpdate", () => {
  const freshLaunch = { hasWaitingWorker: true, millisecondsSincePageStart: 300, alreadyReloadedForUpdate: false };

  it("applies an update left waiting by an earlier visit at a fresh launch", () => {
    expect(shouldApplyWaitingUpdate(freshLaunch)).toBe(true);
  });

  it("does nothing when no update is waiting", () => {
    expect(shouldApplyWaitingUpdate({ ...freshLaunch, hasWaitingWorker: false })).toBe(false);
  });

  it("leaves the update for the next launch once the session is under way", () => {
    expect(shouldApplyWaitingUpdate({ ...freshLaunch, millisecondsSincePageStart: 60_000 })).toBe(false);
  });

  it("never reloads twice in a row", () => {
    expect(shouldApplyWaitingUpdate({ ...freshLaunch, alreadyReloadedForUpdate: true })).toBe(false);
  });
});
