import { describe, expect, it } from "vitest";
import { closeOnBack, type HistoryLike, type PopStateTarget } from "./backToClose";

/**
 * A fake history stack plus event target; `goBack` mimics the browser's Back (pop, then fire popstate).
 * With `asyncBack`, `history.back()` only queues its pop: `flushBack()` delivers it, like a real browser's task.
 */
function makeFakes(asyncBack = false) {
  let queuedBacks = 0;
  const entries: unknown[] = [null];
  const listeners = new Set<() => void>();
  const history: HistoryLike = {
    get state() { return entries[entries.length - 1]; },
    pushState(state) { entries.push(state); },
    back() {
      if (asyncBack) queuedBacks += 1;
      else fakes.goBack();
    },
  };
  const target: PopStateTarget = {
    addEventListener(_type, listener) { listeners.add(listener); },
    removeEventListener(_type, listener) { listeners.delete(listener); },
  };
  const fakes = {
    entries, listeners, history, target,
    /** Delivers the pops queued by `history.back()` (async mode). */
    flushBack() {
      while (queuedBacks > 0) {
        queuedBacks -= 1;
        fakes.goBack();
      }
    },
    goBack() {
      entries.pop();
      for (const listener of [...listeners]) listener();
    },
  };
  return fakes;
}

describe("closeOnBack", () => {
  it("pushes one marker entry on open without firing popstate", () => {
    const fakes = makeFakes();
    closeOnBack(fakes.history, fakes.target, () => {});
    expect(fakes.entries).toHaveLength(2);
  });

  it("calls onBack when Back pops the marker, and does not call history.back again on release", () => {
    const fakes = makeFakes();
    let backCalls = 0;
    const handle = closeOnBack(fakes.history, fakes.target, () => { backCalls += 1; handle.release(); });
    fakes.goBack();
    expect(backCalls).toBe(1);
    expect(fakes.entries).toHaveLength(1);
    expect(fakes.listeners.size).toBe(0);
  });

  it("pops its own entry on release, without calling onBack", () => {
    const fakes = makeFakes();
    let backCalls = 0;
    const handle = closeOnBack(fakes.history, fakes.target, () => { backCalls += 1; });
    handle.release();
    expect(fakes.entries).toHaveLength(1);
    expect(backCalls).toBe(0);
  });

  it("release is idempotent", () => {
    const fakes = makeFakes();
    const handle = closeOnBack(fakes.history, fakes.target, () => {});
    handle.release();
    handle.release();
    expect(fakes.entries).toHaveLength(1);
  });

  it("does not pop when the current entry is not its marker (another navigation happened)", () => {
    const fakes = makeFakes();
    const handle = closeOnBack(fakes.history, fakes.target, () => {});
    fakes.entries.push(null);
    handle.release();
    expect(fakes.entries).toHaveLength(3);
  });

  it("a second overlay after the first is closed gets its own entry and its own Back", () => {
    const fakes = makeFakes();
    closeOnBack(fakes.history, fakes.target, () => {}).release();
    let backCalls = 0;
    const second = closeOnBack(fakes.history, fakes.target, () => { backCalls += 1; second.release(); });
    expect(fakes.entries).toHaveLength(2);
    fakes.goBack();
    expect(backCalls).toBe(1);
    expect(fakes.entries).toHaveLength(1);
  });

  it("a new overlay opened before the previous release's popstate arrives is not closed by it", () => {
    const fakes = makeFakes(true);
    closeOnBack(fakes.history, fakes.target, () => {}).release(); // back() is now in flight
    let backCalls = 0;
    closeOnBack(fakes.history, fakes.target, () => { backCalls += 1; });

    fakes.flushBack(); // the late popstate

    expect(backCalls).toBe(0);
    // The second overlay pushed its marker only after the late popstate, and Back still closes it.
    expect(fakes.entries).toHaveLength(2);
    fakes.goBack();
    expect(backCalls).toBe(1);
  });

  it("an overlay released while still waiting for a pending back never pushes", () => {
    const fakes = makeFakes(true);
    closeOnBack(fakes.history, fakes.target, () => {}).release();
    closeOnBack(fakes.history, fakes.target, () => {}).release();
    fakes.flushBack();
    expect(fakes.entries).toHaveLength(1);
    expect(fakes.listeners.size).toBe(0);
  });

  it("a marker from an earlier page load is not mistaken for ours", () => {
    const fakes = makeFakes();
    const handle = closeOnBack(fakes.history, fakes.target, () => {});
    // Replace our entry with a look-alike from another load: same number, different page id.
    const ours = fakes.entries.pop() as { backToCloseMarker: { markerNumber: number } };
    fakes.entries.push({ backToCloseMarker: { pageLoadId: "another-load", markerNumber: ours.backToCloseMarker.markerNumber } });
    handle.release();
    expect(fakes.entries).toHaveLength(2);
  });

  it("closing on a hash change leaves no dead press: reaching the abandoned marker steps back past it", () => {
    const fakes = makeFakes();
    const handle = closeOnBack(fakes.history, fakes.target, () => {});
    fakes.entries.push(null); // hash navigation to another screen
    handle.release(); // the overlay closes on hashchange; no back() call
    expect(fakes.entries).toHaveLength(3);

    fakes.goBack(); // user presses Back: lands on the abandoned marker, which is skipped
    expect(fakes.entries).toHaveLength(1);
    expect(fakes.listeners.size).toBe(0);
  });
});
