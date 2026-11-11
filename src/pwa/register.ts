/**
 * Registers the service worker that makes the app installable and usable
 * offline, and applies a downloaded update at launch. Called once from
 * main.ts at startup.
 *
 *   launch -> register() -> registration.waiting?
 *                              no  -> clear the reload guard, done
 *                              yes -> still a fresh launch? (shouldApplyWaitingUpdate)
 *                                       no  -> leave it waiting for the next launch
 *                                       yes -> post SKIP_WAITING; on controllerchange
 *                                              reload once
 */

/** How long after the page started a waiting update still counts as "at launch". */
const FRESH_LAUNCH_WINDOW_MILLISECONDS = 5000;

/** sessionStorage key set just before the update reload, so a reload can never loop. */
const RELOAD_GUARD_KEY = "explosive-endurance.sw-update-reload";

/** The facts `shouldApplyWaitingUpdate` decides from. */
export interface WaitingUpdateFacts {
  /** True when `registration.waiting` exists right after registering. */
  hasWaitingWorker: boolean;
  /** Milliseconds since the page started loading (`performance.now()`). */
  millisecondsSincePageStart: number;
  /** True when this tab session already reloaded for an update and hasn't seen a clean launch since. */
  alreadyReloadedForUpdate: boolean;
}

/**
 * Decides whether to activate a waiting worker right now. A worker that is
 * already waiting when registration resolves was downloaded on an earlier
 * visit (an update found during this page load would still be "installing"),
 * so applying it now, before the app has been on screen for long, can't
 * disturb a workout in progress. Later in the session the answer is no: the
 * update waits for the next launch. Pure so it can be unit tested.
 */
export function shouldApplyWaitingUpdate(facts: WaitingUpdateFacts): boolean {
  return facts.hasWaitingWorker && !facts.alreadyReloadedForUpdate && facts.millisecondsSincePageStart <= FRESH_LAUNCH_WINDOW_MILLISECONDS;
}

/**
 * Asks the waiting worker to take over and reloads the page once it has.
 * The reload is guarded by a sessionStorage flag so a worker that never
 * settles can't cause a reload loop.
 */
function applyWaitingUpdate(waitingWorker: ServiceWorker): void {
  navigator.serviceWorker.addEventListener(
    "controllerchange",
    () => {
      sessionStorage.setItem(RELOAD_GUARD_KEY, "1");
      window.location.reload();
    },
    { once: true },
  );

  waitingWorker.postMessage({ type: "SKIP_WAITING" });
}

/**
 * Registers the worker (production builds only: in `npm run dev` there is no
 * sw.js, and a worker would serve stale files while editing) and applies an
 * update left waiting by an earlier visit. The URL is relative so it
 * resolves under the GitHub Pages sub-path (/workout-app-2026/sw.js).
 * Called from main.ts before the app starts, so the reload happens before
 * the first screen settles. Failure is logged, never thrown: the app works
 * fine without a worker.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) {
    return;
  }

  navigator.serviceWorker
    .register("./sw.js")
    .then((registration) => {
      const shouldApply = shouldApplyWaitingUpdate({
        hasWaitingWorker: registration.waiting !== null,
        millisecondsSincePageStart: performance.now(),
        alreadyReloadedForUpdate: sessionStorage.getItem(RELOAD_GUARD_KEY) !== null,
      });

      if (registration.waiting && shouldApply) {
        applyWaitingUpdate(registration.waiting);
      } else if (!registration.waiting) {
        // A clean launch with nothing waiting: the next update may reload again.
        sessionStorage.removeItem(RELOAD_GUARD_KEY);
      }
    })
    .catch((error: unknown) => {
      console.warn("Service worker registration failed; the app won't work offline.", error);
    });
}
