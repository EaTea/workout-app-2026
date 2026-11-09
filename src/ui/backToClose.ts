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
 *
 * Three subtleties, all handled below:
 *  - `history.back()` is asynchronous. If a new overlay opened before the
 *    popstate caused by our own `back()` arrived, that late popstate would
 *    close the new overlay. So a new overlay waits for the pending popstate.
 *  - Marker entries survive a page reload (the service worker's update
 *    reload, for one). Each marker carries a random per-page-load id, so an
 *    entry from an earlier load is never taken for one of ours (it is only
 *    ever skipped, see below).
 *  - If the page navigates (hash change) while the overlay is open, the
 *    overlay closes but the marker entry stays behind in the history. Going
 *    Back onto it would otherwise be a dead press (same page, nothing
 *    happens), so a one-shot listener steps back again past it.
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

/** Random id of this page load; markers from an earlier load carry a different one. */
const pageLoadId = Math.random().toString(36).slice(2);

/** Source of a distinct marker number per call within this page load. */
let nextMarkerNumber = 1;

/**
 * Shape of the history state this helper stores (kept inside history.state only).
 * `pageLoadId` + `markerNumber` together identify one overlay's entry.
 */
interface MarkerState {
  backToCloseMarker: { pageLoadId: string; markerNumber: number };
}

/** The marker state for marker `markerNumber` of this page load. */
function makeMarkerState(markerNumber: number): MarkerState {
  return { backToCloseMarker: { pageLoadId, markerNumber } };
}

/** True when `state` is the marker entry with number `markerNumber` pushed during THIS page load. */
function isMarker(state: unknown, markerNumber: number): boolean {
  if (typeof state !== "object" || state === null) return false;
  const marker = (state as Partial<MarkerState>).backToCloseMarker;
  return marker?.pageLoadId === pageLoadId && marker.markerNumber === markerNumber;
}

/**
 * Work waiting for the popstate caused by our own `history.back()`.
 * `undefined` when no self-initiated back is in flight. Module level, because
 * the in-flight back outlives the overlay that issued it.
 */
let pendingSelfBack: { waiting: Array<() => void> } | undefined;

/**
 * Pops the current (marker) entry with `history.back()` and records that its
 * popstate is ours. Anything registered with `afterPendingSelfBack` runs once
 * that popstate has been delivered. Used by `release` and by the stale-entry skip.
 */
function popOwnEntry(history: HistoryLike, target: PopStateTarget): void {
  const pending = { waiting: [] as Array<() => void> };
  pendingSelfBack = pending;

  function handleOwnPopState(): void {
    target.removeEventListener("popstate", handleOwnPopState);
    pendingSelfBack = undefined;
    for (const task of pending.waiting) task();
  }

  target.addEventListener("popstate", handleOwnPopState);
  history.back();
}

/** Runs `task` now, or right after the in-flight self-initiated back's popstate has been delivered. */
function afterPendingSelfBack(task: () => void): void {
  if (pendingSelfBack) pendingSelfBack.waiting.push(task);
  else task();
}

/**
 * Pushes a same-URL marker history entry and calls `onBack` when the user
 * navigates Back past it. `onBack` should run the overlay's normal close
 * path, which in turn calls `release()` (a no-op for history in that case,
 * because the marker entry is already gone). Used by `openTimer`.
 *
 * If a previous overlay's own `history.back()` is still in flight, the push
 * and the listener are deferred until its popstate has arrived, so that
 * popstate cannot close this overlay.
 */
export function closeOnBack(history: HistoryLike, target: PopStateTarget, onBack: () => void): BackToCloseHandle {
  const markerNumber = nextMarkerNumber++;
  let isReleased = false;
  let wasPoppedByBack = false;
  let hasPushedMarker = false;

  /** Back popped our marker entry: close the overlay (which releases us). */
  function handlePopState(): void {
    if (isReleased) return;
    wasPoppedByBack = true;
    onBack();
  }

  /** Starts listening and pushes the marker; runs immediately or once a pending self-back has landed. */
  function start(): void {
    if (isReleased) return; // closed before it even started: nothing to undo
    target.addEventListener("popstate", handlePopState);
    history.pushState(makeMarkerState(markerNumber), "");
    hasPushedMarker = true;
  }

  afterPendingSelfBack(start);

  /** See `BackToCloseHandle.release`. */
  function release(): void {
    if (isReleased) return;
    isReleased = true;
    if (!hasPushedMarker) return;

    target.removeEventListener("popstate", handlePopState);

    if (isMarker(history.state, markerNumber)) {
      // Closed by its own controls: pop what we pushed.
      popOwnEntry(history, target);
    } else if (!wasPoppedByBack) {
      // The page navigated away (hash change) with the marker still in the
      // history behind us. If the user later goes Back onto it, step past it.
      skipMarkerWhenReached(history, target, markerNumber);
    }
  }

  return { release };
}

/**
 * Installs a listener that, the first time history lands on the abandoned
 * marker `markerNumber`, goes back once more so the press is not wasted.
 * Removes itself when it fires.
 */
function skipMarkerWhenReached(history: HistoryLike, target: PopStateTarget, markerNumber: number): void {
  function handleReached(): void {
    if (!isMarker(history.state, markerNumber)) return;
    target.removeEventListener("popstate", handleReached);
    popOwnEntry(history, target);
  }

  target.addEventListener("popstate", handleReached);
}
