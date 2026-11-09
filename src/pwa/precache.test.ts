import { describe, expect, it } from "vitest";
import { buildCacheName, buildPrecacheList } from "./precache.ts";

describe("buildPrecacheList", () => {
  it("lists index.html as './', drops sw.js and source maps, and sorts", () => {
    const list = buildPrecacheList(["program.json", "index.html", "assets/index-1.js", "assets/index-1.js.map", "sw.js", "icons/icon-192.png"]);
    expect(list).toEqual(["./", "assets/index-1.js", "icons/icon-192.png", "program.json"]);
  });
});

describe("buildCacheName", () => {
  const bytes = (text: string) => new TextEncoder().encode(text);

  it("is stable and independent of file order", () => {
    const files = [
      { url: "./", contents: bytes("<html>") },
      { url: "program.json", contents: bytes("{}") },
    ];
    const first = buildCacheName(files);
    expect(buildCacheName([...files].reverse())).toBe(first);
    expect(first).toMatch(/^explosive-endurance-[0-9a-f]{10}$/);
  });

  it("changes when a file's content changes, even with the same name", () => {
    const before = buildCacheName([{ url: "program.json", contents: bytes('{"a":1}') }]);
    const after = buildCacheName([{ url: "program.json", contents: bytes('{"a":2}') }]);
    expect(after).not.toBe(before);
  });

  it("changes when a file is renamed or bytes move between files", () => {
    const base = buildCacheName([{ url: "a", contents: bytes("xy") }, { url: "b", contents: bytes("") }]);
    expect(buildCacheName([{ url: "c", contents: bytes("xy") }, { url: "b", contents: bytes("") }])).not.toBe(base);
    expect(buildCacheName([{ url: "a", contents: bytes("x") }, { url: "b", contents: bytes("y") }])).not.toBe(base);
  });
});
