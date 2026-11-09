import { describe, expect, it } from "vitest";
import { buildCacheName, buildPrecacheList } from "./precache";

describe("buildPrecacheList", () => {
  it("lists index.html as './', drops sw.js and source maps, and sorts", () => {
    const list = buildPrecacheList(["program.json", "index.html", "assets/index-1.js", "assets/index-1.js.map", "sw.js", "icons/icon-192.png"]);
    expect(list).toEqual(["./", "assets/index-1.js", "icons/icon-192.png", "program.json"]);
  });
});

describe("buildCacheName", () => {
  it("is stable for the same list and changes when an asset is renamed", () => {
    const first = buildCacheName(["./", "assets/index-1.js"]);
    expect(buildCacheName(["./", "assets/index-1.js"])).toBe(first);
    expect(buildCacheName(["./", "assets/index-2.js"])).not.toBe(first);
    expect(first).toMatch(/^explosive-endurance-[0-9a-f]{10}$/);
  });
});
