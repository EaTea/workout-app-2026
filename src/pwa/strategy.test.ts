import { describe, expect, it } from "vitest";
import { chooseStrategy } from "./strategy.ts";

const origin = "https://eatea.github.io";
const base = "https://eatea.github.io/workout-app-2026";
/** What the build bakes in for the shipped catalogue (see programFileNames). */
const programFiles = ["program.json", "steady-strength.json"];

describe("chooseStrategy", () => {
  it("serves every page load from the precached shell", () => {
    expect(chooseStrategy({ method: "GET", mode: "navigate", url: `${base}/?date=2026-11-02` }, origin, programFiles)).toBe("shell");
    expect(chooseStrategy({ method: "GET", mode: "navigate", url: `${base}/manifest.webmanifest` }, origin, programFiles)).toBe("shell");
    // Even a navigation to program.json must never be cached as itself or replace the shell.
    expect(chooseStrategy({ method: "GET", mode: "navigate", url: `${base}/program.json` }, origin, programFiles)).toBe("shell");
  });

  it("serves program.json network-first so edits show up", () => {
    expect(chooseStrategy({ method: "GET", mode: "cors", url: `${base}/program.json` }, origin, programFiles)).toBe("network-first");
  });

  it("serves every other catalogue-listed program file network-first too", () => {
    expect(chooseStrategy({ method: "GET", mode: "cors", url: `${base}/steady-strength.json` }, origin, programFiles)).toBe("network-first");
  });

  it("serves a json file the catalogue does not list cache-first, and matches whole file names only", () => {
    expect(chooseStrategy({ method: "GET", mode: "cors", url: `${base}/other.json` }, origin, programFiles)).toBe("cache-first");
    expect(chooseStrategy({ method: "GET", mode: "cors", url: `${base}/not-program.json` }, origin, programFiles)).toBe("cache-first");
  });

  it("serves programs.json cache-first, in step with the precached code that reads it", () => {
    expect(chooseStrategy({ method: "GET", mode: "cors", url: `${base}/programs.json` }, origin, programFiles)).toBe("cache-first");
  });

  it("serves hashed assets and icons cache-first", () => {
    expect(chooseStrategy({ method: "GET", mode: "no-cors", url: `${base}/assets/index-abc123.js` }, origin, programFiles)).toBe("cache-first");
    expect(chooseStrategy({ method: "GET", mode: "no-cors", url: `${base}/icons/icon-192.png` }, origin, programFiles)).toBe("cache-first");
  });

  it("ignores non-GET requests and other origins", () => {
    expect(chooseStrategy({ method: "POST", mode: "cors", url: `${base}/program.json` }, origin, programFiles)).toBe("ignore");
    expect(chooseStrategy({ method: "GET", mode: "cors", url: "https://example.com/x.js" }, origin, programFiles)).toBe("ignore");
  });
});
