import { describe, expect, it } from "vitest";
import { createRestMemory, restMemoryKey } from "./restMemory";

describe("createRestMemory", () => {
  it("returns the fallback until something is recorded", () => {
    const memory = createRestMemory();
    expect(memory.get("a", 30)).toBe(30);
  });

  it("returns the latest recorded value, per key", () => {
    const memory = createRestMemory();
    memory.set("a", 35);
    memory.set("b", 50);
    memory.set("a", 40);

    expect(memory.get("a", 30)).toBe(40);
    expect(memory.get("b", 30)).toBe(50);
    expect(memory.get("c", 30)).toBe(30);
  });

  it("keeps separate memories separate", () => {
    const first = createRestMemory();
    first.set("a", 35);
    expect(createRestMemory().get("a", 30)).toBe(30);
  });
});

describe("restMemoryKey", () => {
  it("differs by date, block position and rest id", () => {
    const base = restMemoryKey("2026-11-09", 2, "med_ball_slam");
    expect(restMemoryKey("2026-11-10", 2, "med_ball_slam")).not.toBe(base);
    expect(restMemoryKey("2026-11-09", 3, "med_ball_slam")).not.toBe(base);
    expect(restMemoryKey("2026-11-09", 2, "between-pairs")).not.toBe(base);
    expect(restMemoryKey("2026-11-09", 2, "med_ball_slam")).toBe(base);
  });
});

describe("restMemoryKey for a combined session", () => {
  it("keeps Day 1's and Day 2's block 2 apart, and the plain key unchanged", () => {
    const plain = restMemoryKey("2026-11-09", 2, "med_ball_slam");
    expect(plain).toBe("2026-11-09|block 2|med_ball_slam");

    const dayOne = restMemoryKey("2026-11-09", 2, "med_ball_slam", 1);
    const dayTwo = restMemoryKey("2026-11-09", 2, "med_ball_slam", 2);
    expect(dayOne).not.toBe(dayTwo);
    expect(dayOne).not.toBe(plain);
  });
});
