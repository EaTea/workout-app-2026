import { describe, expect, it } from "vitest";
import { logRouteHash, parseLogRoute, parsePlanRoute, planRouteHash, routeFromHash } from "./router";

describe("routeFromHash", () => {
  it("recognises the settings route", () => {
    expect(routeFromHash("#/settings")).toBe("settings");
  });

  it("recognises the overview route", () => {
    expect(routeFromHash("#/overview")).toBe("overview");
    expect(routeFromHash("#/overview/extra")).toBe("today");
  });

  it("recognises the history route", () => {
    expect(routeFromHash("#/history")).toBe("history");
    expect(routeFromHash("#/history/extra")).toBe("today");
  });

  it("recognises a log route", () => {
    expect(routeFromHash("#/log/2026-11-09/2/med_ball_slam")).toBe("log");
  });

  it("defaults to today for empty, today, unknown and malformed hashes", () => {
    expect(routeFromHash("")).toBe("today");
    expect(routeFromHash("#/today")).toBe("today");
    expect(routeFromHash("#/nonsense")).toBe("today");
    expect(routeFromHash("#/log")).toBe("today");
    expect(routeFromHash("#/log/2026-11-09")).toBe("today");
    expect(routeFromHash("#/log/2026-11-09/x/pull_up")).toBe("today");
    expect(routeFromHash("#/log/2026-11-09/0/pull_up")).toBe("today");
    expect(routeFromHash("#/log/2026-02-30/1/pull_up")).toBe("today");
  });

  it("sends the old date-less log form to today", () => {
    expect(routeFromHash("#/log/2/med_ball_slam")).toBe("today");
  });
});

describe("parseLogRoute", () => {
  it("reads the date, block position and exercise id", () => {
    expect(parseLogRoute("#/log/2026-11-09/3/pull_up")).toEqual({ date: "2026-11-09", blockPosition: 3, exerciseId: "pull_up" });
  });

  it("rejects the old form, impossible dates, extra segments and odd characters", () => {
    expect(parseLogRoute("#/log/3/pull_up")).toBeUndefined();
    expect(parseLogRoute("#/log/2026-13-01/3/pull_up")).toBeUndefined();
    expect(parseLogRoute("#/log/2026-11-09/3/pull_up/extra")).toBeUndefined();
    expect(parseLogRoute("#/log/2026-11-09/3/pull up")).toBeUndefined();
    expect(parseLogRoute("#/log/2026-11-09/-1/pull_up")).toBeUndefined();
  });

  it("round-trips with logRouteHash", () => {
    expect(parseLogRoute(logRouteHash("2026-11-10", 4, "dip"))).toEqual({ date: "2026-11-10", blockPosition: 4, exerciseId: "dip" });
  });
});

describe("plan route", () => {
  it("parses #/plan/<day>/<week>", () => {
    expect(parsePlanRoute("#/plan/1/4")).toEqual({ dayNumber: 1, week: 4 });
    expect(parsePlanRoute("#/plan/6/12")).toEqual({ dayNumber: 6, week: 12 });
  });

  it("rejects malformed hashes", () => {
    for (const hash of ["", "#/plan", "#/plan/1", "#/plan/1/", "#/plan/1/4/5", "#/plan/x/4", "#/plan/1/-2", "#/plan/1.5/4", "#/plan/0/4", "#/plan/1/0", "#/plans/1/4"]) {
      expect(parsePlanRoute(hash), hash).toBeUndefined();
    }
  });

  it("builds the hash and round-trips with the parser", () => {
    expect(planRouteHash(1, 4)).toBe("#/plan/1/4");
    expect(parsePlanRoute(planRouteHash(3, 7))).toEqual({ dayNumber: 3, week: 7 });
  });

  it("is a plan route only when well formed", () => {
    expect(routeFromHash("#/plan/1/4")).toBe("plan");
    expect(routeFromHash("#/plan/x/4")).toBe("today");
  });
});
