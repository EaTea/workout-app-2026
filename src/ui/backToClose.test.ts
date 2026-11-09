import { describe, expect, it } from "vitest";
import { closeOnBack, type HistoryLike, type PopStateTarget } from "./backToClose";

/** A fake history stack plus event target; `goBack` mimics the browser's Back (pop, then fire popstate). */
function makeFakes() {
  const entries: unknown[] = [null];
  const listeners = new Set<() => void>();
  const history: HistoryLike = {
    get state() { return entries[entries.length - 1]; },
    pushState(state) { entries.push(state); },
    back() { fakes.goBack(); },
  };
  const target: PopStateTarget = {
    addEventListener(_type, listener) { listeners.add(listener); },
    removeEventListener(_type, listener) { listeners.delete(listener); },
  };
  const fakes = {
    entries, listeners, history, target,
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
});
