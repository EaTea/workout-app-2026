import { describe, expect, it } from "vitest";
import { chooseStrategy } from "./strategy.ts";

const origin = "https://eatea.github.io";
const base = "https://eatea.github.io/workout-app-2026";

describe("chooseStrategy", () => {
  it("serves every page load from the precached shell", () => {
    expect(chooseStrategy({ method: "GET", mode: "navigate", url: `${base}/?date=2026-11-02` }, origin)).toBe("shell");
    expect(chooseStrategy({ method: "GET", mode: "navigate", url: `${base}/manifest.webmanifest` }, origin)).toBe("shell");
    // Even a navigation to program.json must never be cached as itself or replace the shell.
    expect(chooseStrategy({ method: "GET", mode: "navigate", url: `${base}/program.json` }, origin)).toBe("shell");
  });

  it("serves program.json network-first so edits show up", () => {
    expect(chooseStrategy({ method: "GET", mode: "cors", url: `${base}/program.json` }, origin)).toBe("network-first");
  });

  it("serves programs.json cache-first, in step with the precached code that reads it", () => {
    expect(chooseStrategy({ method: "GET", mode: "cors", url: `${base}/programs.json` }, origin)).toBe("cache-first");
  });

  it("serves hashed assets and icons cache-first", () => {
    expect(chooseStrategy({ method: "GET", mode: "no-cors", url: `${base}/assets/index-abc123.js` }, origin)).toBe("cache-first");
    expect(chooseStrategy({ method: "GET", mode: "no-cors", url: `${base}/icons/icon-192.png` }, origin)).toBe("cache-first");
  });

  it("ignores non-GET requests and other origins", () => {
    expect(chooseStrategy({ method: "POST", mode: "cors", url: `${base}/program.json` }, origin)).toBe("ignore");
    expect(chooseStrategy({ method: "GET", mode: "cors", url: "https://example.com/x.js" }, origin)).toBe("ignore");
  });
});
