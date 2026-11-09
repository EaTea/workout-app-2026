import { describe, expect, it } from "vitest";
import { logRouteHash, parseLogRoute, routeFromHash } from "./router";

describe("routeFromHash", () => {
  it("recognises the settings route", () => {
    expect(routeFromHash("#/settings")).toBe("settings");
  });

  it("recognises a log route", () => {
    expect(routeFromHash("#/log/2/med_ball_slam")).toBe("log");
  });

  it("defaults to today for empty, today, unknown and malformed hashes", () => {
    expect(routeFromHash("")).toBe("today");
    expect(routeFromHash("#/today")).toBe("today");
    expect(routeFromHash("#/nonsense")).toBe("today");
    expect(routeFromHash("#/log")).toBe("today");
    expect(routeFromHash("#/log/2")).toBe("today");
    expect(routeFromHash("#/log/x/pull_up")).toBe("today");
    expect(routeFromHash("#/log/0/pull_up")).toBe("today");
  });
});

describe("parseLogRoute", () => {
  it("reads the block position and exercise id", () => {
    expect(parseLogRoute("#/log/3/pull_up")).toEqual({ blockPosition: 3, exerciseId: "pull_up" });
  });

  it("rejects extra segments and odd characters", () => {
    expect(parseLogRoute("#/log/3/pull_up/extra")).toBeUndefined();
    expect(parseLogRoute("#/log/3/pull up")).toBeUndefined();
    expect(parseLogRoute("#/log/-1/pull_up")).toBeUndefined();
  });

  it("round-trips with logRouteHash", () => {
    expect(parseLogRoute(logRouteHash(4, "dip"))).toEqual({ blockPosition: 4, exerciseId: "dip" });
  });
});
