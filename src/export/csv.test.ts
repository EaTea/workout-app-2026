import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { LoggedSession, LoggedSet, WorkoutLog } from "../log/model";
import { parseProgram } from "../program/parse";
import { CSV_BYTE_ORDER_MARK, logToCsv, neutraliseSpreadsheetFormula, quoteCsvCell } from "./csv";

const program = parseProgram(JSON.parse(readFileSync("public/program.json", "utf-8"))).program;

/** A logged set; optional fields come from `extra`. */
function makeSet(exerciseId: string, blockPosition: number, setNumber: number, extra: Partial<LoggedSet> = {}): LoggedSet {
  return { exerciseId, blockPosition, setNumber, loggedAt: new Date("2026-11-02T10:00:00Z"), ...extra };
}

/** A log from sessions keyed by date. */
function makeLog(...sessions: LoggedSession[]): WorkoutLog {
  return { sessions: Object.fromEntries(sessions.map((session) => [session.date, session])) };
}

describe("logToCsv", () => {
  it("starts with a UTF-8 byte order mark, then the header with CRLF line endings; an empty log is only the header", () => {
    expect(logToCsv({ sessions: {} }, program)).toBe(
      `${CSV_BYTE_ORDER_MARK}date,week,day,block,block_type,exercise_id,exercise_name,performed_as,set,reps,kg,note\r\n`,
    );
    expect(CSV_BYTE_ORDER_MARK).toBe("\uFEFF");
  });

  it("keeps exercise_name as the original and fills performed_as with the rotated-in name for a week 5 warm-up", () => {
    const warmupPosition = program.days[1]!.blocks.findIndex((block) => block.type === "warmup") + 1;
    const log = makeLog(
      { date: "2026-11-09", programWeek: 2, day: 1, sets: [makeSet("ytwi", warmupPosition, 1)] },
      { date: "2026-11-30", programWeek: 5, day: 1, sets: [makeSet("ytwi", warmupPosition, 1)] },
    );

    const lines = logToCsv(log, program).split("\r\n");
    const unrotatedCells = lines[1]!.split(",");
    const rotatedCells = lines[2]!.split(",");

    expect(unrotatedCells.slice(5, 8)).toEqual(["ytwi", "YTWI raises", "YTWI raises"]);
    expect(rotatedCells.slice(5, 8)).toEqual(["ytwi", "YTWI raises", "Reverse fly"]);
  });

  it("writes one row per set, oldest session first, sets in block then set order", () => {
    const log = makeLog(
      { date: "2026-11-04", programWeek: 1, day: 3, sets: [makeSet("dip", 3, 1, { reps: 7, loadKg: 10 })] },
      {
        date: "2026-11-02", programWeek: 1, day: 1,
        sets: [makeSet("pull_up", 3, 1, { reps: 5, loadKg: 8 }), makeSet("med_ball_slam", 2, 2, { reps: 6 }), makeSet("med_ball_slam", 2, 1, { reps: 6 })],
      },
    );

    const lines = logToCsv(log, program).split("\r\n");

    expect(lines[1]).toBe(`2026-11-02,1,1,2,${program.days[1]?.blocks[1]?.type},med_ball_slam,${program.exercises.med_ball_slam?.name},${program.exercises.med_ball_slam?.name},1,6,,`);
    expect(lines[2]?.split(",")[8]).toBe("2");
    expect(lines[3]).toContain(",pull_up,");
    expect(lines[3]).toContain(",5,8,");
    expect(lines[4]).toMatch(/^2026-11-04,1,3,3,/);
    expect(lines[5]).toBe("");
  });

  it("uses empty cells for missing reps, kg, week, day and block type, and the raw id for an unknown exercise", () => {
    const log = makeLog({ date: "2026-11-02", sets: [makeSet("mystery_move", 9, 1)] });

    expect(logToCsv(log, program).split("\r\n")[1]).toBe("2026-11-02,,,9,,mystery_move,mystery_move,mystery_move,1,,,");
  });

  it("quotes notes containing commas, quotes and newlines", () => {
    const log = makeLog({ date: "2026-11-02", programWeek: 1, day: 1, sets: [makeSet("pull_up", 3, 1, { reps: 5, note: 'felt "heavy", slow\nsecond line' })] });

    expect(logToCsv(log, program)).toContain(',"felt ""heavy"", slow\nsecond line"\r\n');
  });

  it("prefixes a note that looks like a formula", () => {
    const log = makeLog({ date: "2026-11-02", sets: [makeSet("pull_up", 3, 1, { note: "=1+1" })] });

    expect(logToCsv(log, program)).toContain(",'=1+1\r\n");
  });

  it("prefixes a note whose formula start comes after spaces", () => {
    const log = makeLog({ date: "2026-11-02", sets: [makeSet("pull_up", 3, 1, { note: "  =1+1" })] });

    expect(logToCsv(log, program)).toContain(",'  =1+1\r\n");
  });
});

describe("quoteCsvCell", () => {
  it("leaves plain text alone and quotes special characters", () => {
    expect(quoteCsvCell("plain")).toBe("plain");
    expect(quoteCsvCell("a,b")).toBe('"a,b"');
    expect(quoteCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(quoteCsvCell("line\r\nbreak")).toBe('"line\r\nbreak"');
  });
});

describe("neutraliseSpreadsheetFormula", () => {
  it("prefixes =, +, -, @, tab and carriage return starts but not ordinary text", () => {
    for (const risky of ["=SUM(A1)", "+1", "-1", "@cmd", "\tx", "\rx", " =1", "   @cmd", "  -1"]) {
      expect(neutraliseSpreadsheetFormula(risky)).toBe(`'${risky}`);
    }
    expect(neutraliseSpreadsheetFormula("easy = good")).toBe("easy = good");
    expect(neutraliseSpreadsheetFormula("  plain")).toBe("  plain");
  });
});
