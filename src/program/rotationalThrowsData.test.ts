import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { addDaysToDate } from "./calendar";
import { parseProgram } from "./parse";
import { buildSession, type SessionView } from "./schedule";

/**
 * Data tests over the shipped public/program.json for Day 3's alternating
 * explosive block (PLAN.md PR 26 and PR 27 step 3): plyo push-ups in odd weeks,
 * rotational wall throws in even weeks. They pin the two items, the worked
 * examples, and the promise that every other session is unchanged.
 */

const SHIPPED_JSON_PATH = "public/program.json";
const START_DATE = "2026-11-02";
const LAST_PROGRAM_DATE = "2026-12-27";

/** A fresh copy of the shipped file's JSON, safe to edit. */
function loadShippedJson(): any {
  return JSON.parse(readFileSync(SHIPPED_JSON_PATH, "utf-8"));
}

const settings = { startDate: START_DATE, maxReps: { pull_up: 12, dip: 15 }, maxSavedOn: {}, maxHistory: {} };

/** The items of Day 3's explosive block in the raw JSON (the wire form). */
function day3ExplosiveItems(json: any): any[] {
  const day = json.days.find((candidate: any) => candidate.day === 3);
  return day.blocks.find((block: any) => block.type === "explosive").items;
}

/**
 * The program as it was before PR 27, rebuilt from the shipped JSON: the
 * rotational item is removed and the plyo item loses its `weeks`, so plyo
 * push-ups run every week. Computed here so no fixture copy of the old file
 * has to be kept in step.
 */
function parsedBaseProgram() {
  const json = loadShippedJson();
  const items = day3ExplosiveItems(json);
  const plyoItem = items.find((item: any) => item.exercise === "plyo_push_up");
  delete plyoItem.weeks;
  items.splice(items.findIndex((item: any) => item.exercise === "rotational_wall_throw"), 1);
  return parseProgram(json).program;
}

const shipped = parseProgram(loadShippedJson());
const base = parsedBaseProgram();

/** Every date of the 8-week program, as "YYYY-MM-DD". */
function programDates(): string[] {
  const dates: string[] = [];
  for (let date = START_DATE; date <= LAST_PROGRAM_DATE; date = addDaysToDate(date, 1)) dates.push(date);
  return dates;
}

describe("the shipped file's Day 3 explosive block", () => {
  it("parses with no warnings", () => {
    expect(shipped.warnings).toEqual([]);
  });

  it("has plyo push-ups in the odd weeks and wall throws in the even weeks, with no noEquipment swap", () => {
    const [plyo, throws] = shipped.program.days[3]!.blocks[1]!.items;

    expect(shipped.program.days[3]!.blocks[1]!.type).toBe("explosive");
    expect(shipped.program.days[3]!.blocks[1]!.items).toHaveLength(2);

    expect(plyo).toMatchObject({ exerciseId: "plyo_push_up", perSide: false, restSec: { min: 45, max: 45 } });
    expect(plyo!.sets).toHaveLength(5);
    expect(plyo!.sets[0]!.reps).toEqual({ kind: "fixed", count: 5 });
    expect(plyo!.runsInWeeks).toEqual(new Set([1, 3, 5, 7]));
    expect(plyo!.noEquipment).toBeUndefined();

    expect(throws).toMatchObject({ exerciseId: "rotational_wall_throw", perSide: true, restSec: { min: 45, max: 45 } });
    expect(throws!.sets).toHaveLength(4);
    expect(throws!.sets[0]!.reps).toEqual({ kind: "fixed", count: 5 });
    expect(throws!.runsInWeeks).toEqual(new Set([2, 4, 6, 8]));
    expect(throws!.noEquipment).toBeUndefined();
  });

  it("defines the exercise with its cues, alternative and evidence", () => {
    const exercise = shipped.program.exercises["rotational_wall_throw"]!;

    expect(exercise.name).toBe("Rotational med ball wall throws");
    expect(exercise.category).toBe("explosive");
    expect(exercise.cues).toHaveLength(5);
    expect(exercise.alternative).toBe("No ball or no solid wall: do plyo push-ups, 5 x 5");
    expect(exercise.evidence).toEqual({ kind: "url", url: "https://doi.org/10.1519/R-18255.1" });
  });
});

describe("worked examples from PLAN.md PR 26 (start date 2 Nov)", () => {
  /** The explosive block's items on `date` reduced to the figures the plan's table lists. */
  function explosiveOn(date: string) {
    const session = buildSession(shipped.program, settings, date);
    if (session.kind !== "training") throw new Error(`expected training on ${date}`);

    const block = session.blocks.find((candidate) => candidate.type === "explosive")!;
    return block.items.map((item) => ({
      exercise: item.exercise.id,
      sets: item.sets.length,
      reps: item.sets[0]!.target,
      perSide: item.perSide,
      restSec: item.restSec,
    }));
  }

  const plyo = { exercise: "plyo_push_up", sets: 5, reps: { kind: "fixed", count: 5 }, perSide: false, restSec: { min: 45, max: 45 } };
  const throws = (sets: number) => ({ exercise: "rotational_wall_throw", sets, reps: { kind: "fixed", count: 5 }, perSide: true, restSec: { min: 45, max: 45 } });

  it.each([
    ["4 Nov, week 1 Day 3 (Base)", "2026-11-04", [plyo]],
    ["11 Nov, week 2 Day 3 (Base)", "2026-11-11", [throws(4)]],
    ["25 Nov, week 4 Day 3 (Deload): halved", "2026-11-25", [throws(2)]],
    ["9 Dec, week 6 Day 3 (Power endurance)", "2026-12-09", [throws(4)]],
    ["16 Dec, week 7 Day 3 (Power endurance)", "2026-12-16", [plyo]],
    ["23 Dec, week 8 Day 3 (Deload + retest): halved", "2026-12-23", [throws(2)]],
  ])("%s", (_name, date, expected) => {
    expect(explosiveOn(date)).toEqual(expected);
  });
});

describe("regression against the program before the rotational throws", () => {
  const dates = programDates();

  /** Session of `date` from the given program. */
  function sessionOf(program: typeof base, date: string): SessionView {
    return buildSession(program, settings, date);
  }

  it("covers the 8 weeks (56 dates)", () => {
    expect(dates).toHaveLength(56);
  });

  it("leaves every session identical except Day 3's explosive block", () => {
    for (const date of dates) {
      const newSession = sessionOf(shipped.program, date);
      const oldSession = sessionOf(base, date);

      if (newSession.kind !== "training" || newSession.dayNumber !== 3 || oldSession.kind !== "training") {
        expect(newSession, date).toEqual(oldSession);
        continue;
      }

      // Day 3: every block except explosive must match; the explosive block is checked below.
      const withoutExplosive = (session: Extract<SessionView, { kind: "training" }>) => ({
        ...session,
        blocks: session.blocks.filter((block) => block.type !== "explosive"),
      });
      expect(withoutExplosive(newSession), date).toEqual(withoutExplosive(oldSession));

      const newPositions = newSession.blocks.map((block) => [block.type, block.position]);
      const oldPositions = oldSession.blocks.map((block) => [block.type, block.position]);
      expect(newPositions, date).toEqual(oldPositions);
    }
  });

  it("makes Day 3 in the odd weeks match the old plyo-every-week program exactly", () => {
    const oddWeekDay3Dates = dates.filter((date) => {
      const session = sessionOf(shipped.program, date);
      return session.kind === "training" && session.dayNumber === 3 && session.week % 2 === 1;
    });

    expect(oddWeekDay3Dates).toHaveLength(4);
    for (const date of oddWeekDay3Dates) {
      expect(sessionOf(shipped.program, date), date).toEqual(sessionOf(base, date));
    }
  });

  it("changes Day 3's explosive block in the even weeks only", () => {
    const differingWeeks: number[] = [];

    for (const date of dates) {
      const newSession = sessionOf(shipped.program, date);
      if (newSession.kind !== "training" || newSession.dayNumber !== 3) continue;

      if (JSON.stringify(newSession) !== JSON.stringify(sessionOf(base, date))) differingWeeks.push(newSession.week);
    }

    expect(differingWeeks).toEqual([2, 4, 6, 8]);
  });
});
