import { describe, expect, it } from "vitest";
import { createScreenWakeLock, type VisibilitySourceLike, type WakeLockSentinelLike } from "./wakeLock";

/** Lets pending promise callbacks run. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** A fake navigator.wakeLock that records requests and lets a test control when/if they resolve. */
function fakeWakeLock(mode: "immediate" | "manual" | "reject" = "immediate") {
  const sentinels: Array<WakeLockSentinelLike & { released: boolean; dropByBrowser(): void }> = [];
  const pendingResolvers: Array<() => void> = [];
  let requestCount = 0;

  /**
   * Builds a fake WakeLockSentinel and records it in `sentinels`, so tests can
   * check whether the controller released it. `dropByBrowser()` simulates the
   * browser revoking the lock (e.g. the page was hidden), firing "release".
   */
  function makeSentinel() {
    const releaseListeners: Array<() => void> = [];
    const sentinel = {
      released: false,
      release: async () => { sentinel.released = true; },
      addEventListener: (_type: "release", listener: () => void) => { releaseListeners.push(listener); },
      dropByBrowser: () => { sentinel.released = true; releaseListeners.forEach((listener) => listener()); },
    };
    sentinels.push(sentinel);
    return sentinel;
  }

  return {
    sentinels,
    get requestCount() { return requestCount; },
    resolvePending: () => pendingResolvers.shift()?.(),
    api: {
      request: (_type: "screen") => {
        requestCount += 1;
        if (mode === "reject") return Promise.reject(new Error("NotAllowedError"));
        if (mode === "manual") {
          return new Promise<WakeLockSentinelLike>((resolve) => pendingResolvers.push(() => resolve(makeSentinel())));
        }
        return Promise.resolve(makeSentinel());
      },
    },
  };
}

/** A fake document whose visibility a test can flip. */
function fakeVisibility() {
  const listeners = new Set<() => void>();
  const source: VisibilitySourceLike = {
    visibilityState: "visible",
    addEventListener: (_type, listener) => { listeners.add(listener); },
    removeEventListener: (_type, listener) => { listeners.delete(listener); },
  };
  return {
    source,
    listenerCount: () => listeners.size,
    setState(state: "visible" | "hidden") {
      source.visibilityState = state;
      listeners.forEach((listener) => listener());
    },
  };
}

describe("createScreenWakeLock", () => {
  it("requests a screen lock when wanted, and only once for repeated calls", async () => {
    const fake = fakeWakeLock();
    const lock = createScreenWakeLock({ wakeLock: fake.api, visibilitySource: fakeVisibility().source });

    lock.setWanted(true);
    lock.setWanted(true);
    await flush();
    lock.setWanted(true);

    expect(fake.requestCount).toBe(1);
    expect(fake.sentinels[0]?.released).toBe(false);
  });

  it("releases the lock when no longer wanted (pause or finish), and requests again on resume", async () => {
    const fake = fakeWakeLock();
    const lock = createScreenWakeLock({ wakeLock: fake.api, visibilitySource: fakeVisibility().source });

    lock.setWanted(true);
    await flush();
    lock.setWanted(false);
    expect(fake.sentinels[0]?.released).toBe(true);

    lock.setWanted(true);
    await flush();
    expect(fake.requestCount).toBe(2);
    expect(fake.sentinels[1]?.released).toBe(false);
  });

  it("releases the lock on dispose and stops listening for visibility changes", async () => {
    const fake = fakeWakeLock();
    const visibility = fakeVisibility();
    const lock = createScreenWakeLock({ wakeLock: fake.api, visibilitySource: visibility.source });

    lock.setWanted(true);
    await flush();
    lock.dispose();

    expect(fake.sentinels[0]?.released).toBe(true);
    expect(visibility.listenerCount()).toBe(0);
  });

  it("requests a new lock when the page becomes visible again after the browser dropped it", async () => {
    const fake = fakeWakeLock();
    const visibility = fakeVisibility();
    const lock = createScreenWakeLock({ wakeLock: fake.api, visibilitySource: visibility.source });

    lock.setWanted(true);
    await flush();

    visibility.setState("hidden");
    fake.sentinels[0]?.dropByBrowser();
    expect(fake.requestCount).toBe(1);

    visibility.setState("visible");
    await flush();
    expect(fake.requestCount).toBe(2);
  });

  it("does not request on visible when it is not wanted", async () => {
    const fake = fakeWakeLock();
    const visibility = fakeVisibility();
    const lock = createScreenWakeLock({ wakeLock: fake.api, visibilitySource: visibility.source });

    lock.setWanted(true);
    await flush();
    lock.setWanted(false);
    visibility.setState("visible");
    await flush();

    expect(fake.requestCount).toBe(1);
  });

  it("releases at once a request that resolves after the lock was no longer wanted", async () => {
    const fake = fakeWakeLock("manual");
    const lock = createScreenWakeLock({ wakeLock: fake.api, visibilitySource: fakeVisibility().source });

    lock.setWanted(true);
    lock.setWanted(false);
    fake.resolvePending();
    await flush();

    expect(fake.sentinels).toHaveLength(1);
    expect(fake.sentinels[0]?.released).toBe(true);
  });

  it("keeps a late-resolving lock if wanted again in the meantime, without a second request", async () => {
    const fake = fakeWakeLock("manual");
    const lock = createScreenWakeLock({ wakeLock: fake.api, visibilitySource: fakeVisibility().source });

    lock.setWanted(true);
    lock.setWanted(false);
    lock.setWanted(true);
    fake.resolvePending();
    await flush();

    expect(fake.requestCount).toBe(1);
    expect(fake.sentinels[0]?.released).toBe(false);
  });

  it("does nothing, without throwing, when the API is unsupported", () => {
    const lock = createScreenWakeLock({});
    expect(() => {
      lock.setWanted(true);
      lock.setWanted(false);
      lock.dispose();
    }).not.toThrow();
  });

  it("ignores a rejected request and may try again later", async () => {
    const fake = fakeWakeLock("reject");
    const lock = createScreenWakeLock({ wakeLock: fake.api, visibilitySource: fakeVisibility().source });

    lock.setWanted(true);
    await flush();
    lock.setWanted(true);
    await flush();

    expect(fake.requestCount).toBe(2);
  });
});
