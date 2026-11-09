/**
 * Makes the Back button/gesture close an overlay (the timer) instead of
 * leaving the screen behind it.
 *
 *   open  ──pushState(marker, same URL)──▶ history: [ ..., screen, screen+marker ]
 *   Back  ──popstate──▶ onBack() (the overlay's normal close path)
 *   own close button / Done / Escape ──▶ release() ──▶ history.back() (pops our marker)
 *
 * `pushState` with no URL fires neither `hashchange` nor `popstate`, so the
 * hash router (ui/app.ts) does not re-render and the overlay survives. The
 * history and the event target are passed in so unit tests can use fakes;
 * `timerView.ts` hands in the real `window.history` and `window`.
 */

/** The slice of `History` this helper uses. */
export interface HistoryLike {
  state: unknown;
  pushState(state: unknown, unused: string): void;
  back(): void;
}

/** The slice of `Window` this helper uses. */
export interface PopStateTarget {
  addEventListener(type: "popstate", listener: () => void): void;
  removeEventListener(type: "popstate", listener: () => void): void;
}

/** What `closeOnBack` returns. */
export interface BackToCloseHandle {
  /**
   * Call when the overlay closes, for whatever reason. Stops listening and,
   * if our marker entry is still the current one (the overlay was closed by
   * its own controls, not by Back), pops it with `history.back()`. Safe to call more than once.
   */
  release(): void;
}

/** Source of a distinct marker per call, so a stale entry from an earlier overlay is never mistaken for ours. */
let nextMarkerNumber = 1;

/** Shape of the history state this helper stores (a wire-ish value kept inside history.state only). */
interface MarkerState {
  backToCloseMarker: number;
}

/** True when `state` is the marker entry with number `markerNumber`. */
function isMarker(state: unknown, markerNumber: number): boolean {
  return typeof state === "object" && state !== null && (state as Partial<MarkerState>).backToCloseMarker === markerNumber;
}

/**
 * Pushes a same-URL marker history entry and calls `onBack` when the user
 * navigates Back past it. `onBack` should run the overlay's normal close
 * path, which in turn calls `release()` (a no-op for history in that case,
 * because the marker entry is already gone). Used by `openTimer`.
 */
export function closeOnBack(history: HistoryLike, target: PopStateTarget, onBack: () => void): BackToCloseHandle {
  const markerNumber = nextMarkerNumber++;
  let isReleased = false;

  /** Back popped our marker entry: close the overlay (which releases us). */
  function handlePopState(): void {
    if (isReleased) return;
    onBack();
  }

  target.addEventListener("popstate", handlePopState);
  history.pushState({ backToCloseMarker: markerNumber } satisfies MarkerState, "");

  /** See `BackToCloseHandle.release`. */
  function release(): void {
    if (isReleased) return;
    isReleased = true;

    target.removeEventListener("popstate", handlePopState);
    // Only pop what we pushed: after a Back the current entry is the screen's own.
    if (isMarker(history.state, markerNumber)) history.back();
  }

  return { release };
}
