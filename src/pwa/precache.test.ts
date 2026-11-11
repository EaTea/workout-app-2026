import { describe, expect, it } from "vitest";
import { parseCatalogue } from "../program/catalogue.ts";
import { buildCacheName, buildPrecacheList, programFileNames } from "./precache.ts";

describe("buildPrecacheList", () => {
  it("lists index.html as './', drops sw.js and source maps, and sorts", () => {
    const list = buildPrecacheList(["program.json", "programs.json", "index.html", "assets/index-1.js", "assets/index-1.js.map", "sw.js", "icons/icon-192.png"]);
    expect(list).toEqual(["./", "assets/index-1.js", "icons/icon-192.png", "program.json", "programs.json"]);
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

describe("programFileNames", () => {
  it("lists the file of every catalogue entry, without the ./ prefix and without programs.json", () => {
    const catalogue = parseCatalogue({
      programs: [
        { id: "explosive-endurance", file: "program.json" },
        { id: "steady-strength", file: "steady-strength.json" },
      ],
    });

    expect(programFileNames(catalogue)).toEqual(["program.json", "steady-strength.json"]);
  });
});
