import { describe, expect, it } from "vitest";
import { routeFromHash } from "./router";

describe("routeFromHash", () => {
  it("recognises the settings route", () => {
    expect(routeFromHash("#/settings")).toBe("settings");
  });

  it("defaults to today for empty, today and unknown hashes", () => {
    expect(routeFromHash("")).toBe("today");
    expect(routeFromHash("#/today")).toBe("today");
    expect(routeFromHash("#/nonsense")).toBe("today");
  });
});
