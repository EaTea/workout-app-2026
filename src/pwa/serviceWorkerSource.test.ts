import { describe, expect, it } from "vitest";
import { renderServiceWorker } from "./serviceWorkerSource";

describe("renderServiceWorker", () => {
  const source = renderServiceWorker("explosive-endurance-abc", ["./", "program.json"]);

  it("is valid JavaScript that embeds the cache name and precache list", () => {
    expect(() => new Function(source)).not.toThrow();
    expect(source).toContain('"explosive-endurance-abc"');
    expect(source).toContain('["./","program.json"]');
  });

  it("never swaps workers mid-session", () => {
    expect(source).not.toContain("skipWaiting()");
    expect(source).not.toContain("clients.claim()");
  });
});
