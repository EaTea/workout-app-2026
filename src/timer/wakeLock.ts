/**
 * Keeps the screen awake while a timer overlay is open, using the Screen Wake Lock
 * API. A phone propped up during a set would otherwise dim and lock mid-timer.
 *
 *   timerView ──setWanted(true/false)──▶ ScreenWakeLock ──request("screen")──▶ browser
 *   browser hides the page ──▶ drops the lock ("release" event on the sentinel)
 *   page visible again ──▶ ScreenWakeLock requests a new lock if still wanted
 *
 * Everything is best effort: no API (older browsers, iOS before 16.4), a
 * rejected request (low battery, page hidden) or a throwing release simply
 * means the screen may dim, never an error for the user.
 *
 * The browser pieces are passed in as `WakeLockEnvironment` so the logic can
 * be unit tested in Node with fakes, without a DOM.
 */

/** The part of a browser WakeLockSentinel this module uses. */
export interface WakeLockSentinelLike {
  release(): Promise<void>;
  /** Fires when the browser drops the lock on its own (e.g. the page was hidden). */
  addEventListener?(type: "release", listener: () => void): void;
}

/** The part of `navigator.wakeLock` this module uses. */
export interface WakeLockApiLike {
  request(type: "screen"): Promise<WakeLockSentinelLike>;
}

/** The part of `document` this module uses, to learn when the page becomes visible again. */
export interface VisibilitySourceLike {
  visibilityState: string;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

/** Browser objects the wake lock depends on; undefined means "not available here". */
export interface WakeLockEnvironment {
  wakeLock?: WakeLockApiLike;
  visibilitySource?: VisibilitySourceLike;
}

/** Handle returned by `createScreenWakeLock`; used by the timer overlay. */
export interface ScreenWakeLock {
  /** Says whether the screen should currently be kept awake. Cheap to call repeatedly with the same value. */
  setWanted(isWanted: boolean): void;
  /** Releases any lock and stops listening for visibility changes. Call once when the owner closes. */
  dispose(): void;
}

/** Reads the real browser objects; called by `createScreenWakeLock` when no environment is injected. */
function browserEnvironment(): WakeLockEnvironment {
  return {
    wakeLock: typeof navigator !== "undefined" ? (navigator as { wakeLock?: WakeLockApiLike }).wakeLock : undefined,
    visibilitySource: typeof document !== "undefined" ? document : undefined,
  };
}

/**
 * Creates a wake lock controller for one timer overlay. The overlay calls
 * `setWanted(true)` when it opens and `dispose()` when it closes;
 * this object takes care of requesting, releasing and re-requesting after the
 * browser drops the lock.
 */
export function createScreenWakeLock(environment: WakeLockEnvironment = browserEnvironment()): ScreenWakeLock {
  const { wakeLock: wakeLockApi, visibilitySource } = environment;

  let isWanted = false;
  /** The lock we currently hold, if any. */
  let heldSentinel: WakeLockSentinelLike | null = null;
  /** True between calling request() and its answer, so we never ask twice at once. */
  let isRequestPending = false;

  /** Asks the browser for a lock unless we already hold or are waiting for one. Failures are ignored. */
  function acquire(): void {
    if (!wakeLockApi || heldSentinel || isRequestPending) return;

    isRequestPending = true;
    let request: Promise<WakeLockSentinelLike>;
    try {
      request = wakeLockApi.request("screen");
    } catch {
      isRequestPending = false;
      return;
    }

    request.then(
      (sentinel) => {
        isRequestPending = false;

        // The request resolved after the lock was no longer wanted (e.g. the overlay closed):
        // give the lock straight back instead of leaking it.
        if (!isWanted) {
          sentinel.release().catch(() => undefined);
          return;
        }

        heldSentinel = sentinel;
        // The browser drops the lock when the page is hidden; forget it so
        // the next "visible" event can request a new one.
        sentinel.addEventListener?.("release", () => {
          if (heldSentinel === sentinel) heldSentinel = null;
        });
      },
      () => {
        // Refused (low battery, page not visible, policy): carry on without it.
        isRequestPending = false;
      },
    );
  }

  /** Gives back the lock we hold, if any. */
  function releaseHeldLock(): void {
    const sentinel = heldSentinel;
    heldSentinel = null;
    sentinel?.release().catch(() => undefined);
  }

  /** Re-requests the lock when the page comes back to the foreground while the overlay is still open. */
  function handleVisibilityChange(): void {
    if (isWanted && visibilitySource?.visibilityState === "visible") acquire();
  }

  visibilitySource?.addEventListener("visibilitychange", handleVisibilityChange);

  return {
    setWanted(newIsWanted: boolean): void {
      isWanted = newIsWanted;
      if (isWanted) acquire();
      else releaseHeldLock();
    },
    dispose(): void {
      isWanted = false;
      releaseHeldLock();
      visibilitySource?.removeEventListener("visibilitychange", handleVisibilityChange);
    },
  };
}
