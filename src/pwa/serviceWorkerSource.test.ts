import { describe, expect, it } from "vitest";
import { renderServiceWorker } from "./serviceWorkerSource.ts";

describe("renderServiceWorker", () => {
  const source = renderServiceWorker("explosive-endurance-abc", ["./", "program.json"]);

  it("is valid JavaScript that embeds the cache name and precache list", () => {
    expect(() => new Function(source)).not.toThrow();
    expect(source).toContain('"explosive-endurance-abc"');
    expect(source).toContain('["./","program.json"]');
  });

  it("only takes over early when the page asks, and never claims clients", () => {
    expect(source).not.toContain("clients.claim()");
    expect(source.match(/skipWaiting\(\)/g)).toHaveLength(1);
    expect(source).toContain('"SKIP_WAITING"');
    expect(source.indexOf("skipWaiting()")).toBeGreaterThan(source.indexOf('addEventListener("message"'));
  });

  it("precaches past the HTTP cache and fetches program.json past it too", () => {
    expect(source).toContain('{ cache: "reload" }');
    expect(source).toContain('{ cache: "no-cache" }');
  });

  it("matches precached files regardless of Vary (precache requests carry no Origin)", () => {
    expect(source).toContain("{ ignoreVary: true }");
  });

  it("only writes program.json to the cache, after install", () => {
    // Exactly one cache.put (program.json) and one addAll (install).
    expect(source.match(/cache\.put\(/g)).toHaveLength(1);
    expect(source.match(/cache\.addAll\(/g)).toHaveLength(1);
  });
});
