/**
 * Turns the untrusted contents of program.json into the internal `Program`.
 *
 * This is the only module that knows the wire format (`wire.ts`). It validates
 * as it maps, and every failure is an Error whose message starts with a
 * path-style location, e.g.
 *   days[2].blocks[1].items[0].exercise: unknown exercise "foo"
 * because that message is what Ed sees if he breaks program.json while editing.
 *
 * Errors versus warnings: anything that would make a session wrong (wrong
 * type, missing field, unknown exercise id, progression gap) throws. A field
 * the app doesn't recognise (a note Ed added, or a misspelt optional field) is
 * recorded as a `ProgramWarning` and parsing carries on, ignoring that field.
 * A misspelt optional field DOES change the session (the app falls back to
 * its default), so a warning carries a "did you mean" suggestion when the
 * name is close to a known one, and the banner shows it prominently.
 *
 *   unknown ──parseProgram──▶ { program: Program, warnings: ProgramWarning[] }
 *               ├─ parseExercise  (per library entry)
 *               ├─ parseDay ─ parseBlock ─ parseItem (resolves exercise ids)
 *               └─ progression / warmupRotation / fatigueCheck
 *   every parse* function ──unknown key──▶ collectUnknownFields ──▶ warnings
 *   every parse* function ──real problem─▶ fail() ──▶ throws
 */
import type {
  Block,
  BlockItem,
  Day,
  DayNumber,
  Evidence,
  Exercise,
  FatigueCheck,
  Format,
  ProgressionPhase,
  Program,
  ProgramWarning,
  Range,
  Reps,
  SetPrescription,
  WarmupRotation,
} from "./model";
import { DAYS_PER_WEEK } from "./model";
import type {
  BlockWire,
  DayWire,
  EvidenceWire,
  ExerciseWire,
  FatigueCheckWire,
  ItemWire,
  NumberOrRangeWire,
  ProgramInfoWire,
  ProgramWire,
  ProgressionPhaseWire,
  RepsWire,
  SetWire,
  SetsWire,
  WarmupRotationWire,
  WarmupSwapWire,
} from "./wire";

type UnknownRecord = Record<string, unknown>;

/** What `parseProgram` returns: the usable program plus any non-fatal notes about program.json. */
export interface ParseResult {
  program: Program;
  warnings: ProgramWarning[];
}

/**
 * Compile-time tie between the allowed-key lists below and the wire types.
 *
 * `allowedKeysOf<SomeWire>()(["a", "b"])` only compiles if every entry is a
 * key of `SomeWire` (a typo or a removed field is an error) AND every key of
 * `SomeWire` is listed (a newly added field is an error until it is added
 * here). So `npm run build` fails whenever wire.ts and these lists drift.
 * It is a curried call so `T` is given explicitly while the list's literal
 * types are still inferred.
 */
function allowedKeysOf<WireType>() {
  return <const Listed extends readonly (keyof WireType & string)[]>(
    keys: Listed & ([Exclude<keyof WireType, Listed[number]>] extends [never] ? unknown : { unlistedWireKeys: Exclude<keyof WireType, Listed[number]> }),
  ): readonly string[] => keys;
}

const ROOT_KEYS = allowedKeysOf<ProgramWire>()(["program", "exercises", "days", "progression", "coreProgressions", "warmupRotation", "fatigueCheck"]);
const PROGRAM_INFO_KEYS = allowedKeysOf<ProgramInfoWire>()(["name", "goal", "lengthWeeks", "restDay", "sessionOrder", "rules"]);
const EXERCISE_KEYS = allowedKeysOf<ExerciseWire>()(["name", "category", "cues", "alternative", "evidence", "progression", "maxTested"]);
const DAY_KEYS = allowedKeysOf<DayWire>()(["day", "focus", "targetMinutes", "blocks"]);
const BLOCK_KEYS = allowedKeysOf<BlockWire>()(["type", "format", "rounds", "minutes", "restSecBetweenPairs", "items"]);
const ITEM_KEYS = allowedKeysOf<ItemWire>()([
  "exercise", "format", "sets", "reps", "repsPctOfMax", "restSec", "minutes", "rounds", "workSec", "durationSec", "perSide", "optional", "load", "note", "tempo", "weeklyIncrease",
]);
const SET_KEYS = allowedKeysOf<SetWire>()(["reps", "load"]);
const PROGRESSION_PHASE_KEYS = allowedKeysOf<ProgressionPhaseWire>()(["weeks", "phase", "changes", "retest"]);
const WARMUP_ROTATION_KEYS = allowedKeysOf<WarmupRotationWire>()(["everyWeeks", "swaps", "alsoAvailable"]);
const WARMUP_SWAP_KEYS = allowedKeysOf<WarmupSwapWire>()(["out", "in"]);
const FATIGUE_CHECK_KEYS = allowedKeysOf<FatigueCheckWire>()(["frequency", "tests", "rule", "lowerBackRule"]);

/** Builds the error every parser failure goes through, so all messages share the "path: problem" shape. */
function fail(path: string, problem: string): never {
  throw new Error(`${path}: ${problem}`);
}

/** Describes a value for error messages, e.g. `"abc"`, `7`, `an array`. */
function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  if (typeof value === "object") return "an object";
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

/** Joins a parent path and a field name ("days[0]" + "focus"). The root path is "". */
function child(path: string, key: string): string {
  return path === "" ? key : `${path}.${key}`;
}

/** Narrows a value to a plain object or fails. */
function expectRecord(value: unknown, path: string): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(path, `expected an object but found ${describe(value)}`);
  }
  return value as UnknownRecord;
}

/** Narrows a value to an array or fails. */
function expectArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, `expected a list but found ${describe(value)}`);
  return value;
}

/**
 * Edit distance between two strings (the number of single-character inserts,
 * deletes or substitutions to turn one into the other). Used only to spot
 * misspelt field names; the names are short so the simple version is fine.
 */
function levenshteinDistance(first: string, second: string): number {
  let previousRow = Array.from({ length: second.length + 1 }, (_, index) => index);

  for (let row = 1; row <= first.length; row++) {
    const currentRow = [row];
    for (let column = 1; column <= second.length; column++) {
      const substitutionCost = first[row - 1] === second[column - 1] ? 0 : 1;
      currentRow[column] = Math.min(
        previousRow[column]! + 1, // delete
        currentRow[column - 1]! + 1, // insert
        previousRow[column - 1]! + substitutionCost, // substitute
      );
    }
    previousRow = currentRow;
  }

  return previousRow[second.length]!;
}

/** How many edits away from a known field name still counts as "probably a typo". */
const MAX_TYPO_DISTANCE = 2;

/**
 * Returns the known field `unknownKey` most likely meant (same letters in
 * another case, or within `MAX_TYPO_DISTANCE` edits), or undefined if nothing
 * is close. Used by `collectUnknownFields` to build the "did you mean" hint.
 */
function suggestKnownKey(unknownKey: string, allowedKeys: readonly string[]): string | undefined {
  const caseInsensitiveMatch = allowedKeys.find((known) => known.toLowerCase() === unknownKey.toLowerCase());
  if (caseInsensitiveMatch !== undefined) return caseInsensitiveMatch;

  let closestKey: string | undefined;
  let closestDistance = MAX_TYPO_DISTANCE + 1;
  for (const known of allowedKeys) {
    const distance = levenshteinDistance(unknownKey, known);
    if (distance < closestDistance) {
      closestKey = known;
      closestDistance = distance;
    }
  }
  return closestKey;
}

/**
 * Records a warning for each field not in `allowedKeys` (e.g. a typo like
 * "restSecs", or a note Ed added) and lets parsing continue; the field is
 * simply never read. When the name is close to a known field the warning
 * carries a `suggestion`, because a misspelt optional field silently changes
 * the session. Called at the top of every record-parsing function with the
 * shared `warnings` list that `parseProgram` returns to its caller.
 */
function collectUnknownFields(record: UnknownRecord, allowedKeys: readonly string[], path: string, warnings: ProgramWarning[]): void {
  for (const key of Object.keys(record)) {
    if (allowedKeys.includes(key)) continue;

    const suggestion = suggestKnownKey(key, allowedKeys);
    const message =
      suggestion === undefined
        ? `unknown field, ignored (known fields: ${allowedKeys.join(", ")})`
        : `unknown field, ignored — did you mean ${JSON.stringify(suggestion)}?`;
    warnings.push({ path: child(path, key), message, suggestion });
  }
}

/** Reads a required string field. */
function readString(record: UnknownRecord, key: string, path: string): string {
  const value = record[key];
  if (typeof value !== "string") {
    fail(child(path, key), `expected text but found ${value === undefined ? "nothing (field is missing)" : describe(value)}`);
  }
  return value;
}

/** Reads an optional string field. */
function readOptionalString(record: UnknownRecord, key: string, path: string): string | undefined {
  return record[key] === undefined ? undefined : readString(record, key, path);
}

/** Reads a required finite number field. */
function readNumber(record: UnknownRecord, key: string, path: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(child(path, key), `expected a number but found ${value === undefined ? "nothing (field is missing)" : describe(value)}`);
  }
  return value;
}

/** Reads an optional number field. */
function readOptionalNumber(record: UnknownRecord, key: string, path: string): number | undefined {
  return record[key] === undefined ? undefined : readNumber(record, key, path);
}

/** Reads an optional boolean field, defaulting to false. */
function readFlag(record: UnknownRecord, key: string, path: string): boolean {
  const value = record[key];
  if (value === undefined) return false;
  if (typeof value !== "boolean") fail(child(path, key), `expected true or false but found ${describe(value)}`);
  return value;
}

/** Reads a required list of strings. */
function readStringList(record: UnknownRecord, key: string, path: string): string[] {
  const listPath = child(path, key);
  const list = expectArray(record[key] ?? fail(listPath, "field is missing"), listPath);
  return list.map((entry, index) => {
    if (typeof entry !== "string") fail(`${listPath}[${index}]`, `expected text but found ${describe(entry)}`);
    return entry;
  });
}

/** Reads a required positive-integer-valued field such as lengthWeeks. */
function readPositiveInteger(record: UnknownRecord, key: string, path: string): number {
  const value = readNumber(record, key, path);
  if (!Number.isInteger(value) || value < 1) fail(child(path, key), `expected a whole number of at least 1 but found ${value}`);
  return value;
}

/** Type guard for the wire union "number or [min, max]". */
function isNumberOrRangeWire(value: unknown): value is NumberOrRangeWire {
  const isNumber = (entry: unknown): entry is number => typeof entry === "number" && Number.isFinite(entry);
  return isNumber(value) || (Array.isArray(value) && value.length === 2 && value.every(isNumber));
}

/** Converts "number or [min, max]" to a Range; a single number gives min === max. Fails if min > max. */
function parseRange(value: unknown, path: string): Range {
  if (!isNumberOrRangeWire(value)) {
    fail(path, `expected a number or a [min, max] pair of numbers but found ${JSON.stringify(value)}`);
  }
  const [min, max] = typeof value === "number" ? [value, value] : value;
  if (min > max) fail(path, `range minimum ${min} is larger than maximum ${max}`);
  return { min, max };
}

/** Reads an optional "number or [min, max]" field. */
function readOptionalRange(record: UnknownRecord, key: string, path: string): Range | undefined {
  return record[key] === undefined ? undefined : parseRange(record[key], child(path, key));
}

/** Type guard for reps on the wire: a number or free text. */
function isRepsWire(value: unknown): value is RepsWire {
  return (typeof value === "number" && Number.isFinite(value)) || typeof value === "string";
}

/**
 * Converts wire reps to the `Reps` union. Text such as "12-15" or "8" becomes
 * a range or fixed count; anything else ("easy, ~50% effort") stays as text.
 */
function parseReps(value: unknown, path: string): Reps {
  if (!isRepsWire(value)) fail(path, `expected a number or text but found ${describe(value)}`);
  if (typeof value === "number") return { kind: "fixed", count: value };

  const rangeMatch = /^(\d+)\s*-\s*(\d+)$/.exec(value.trim());
  if (rangeMatch) {
    const min = Number(rangeMatch[1]);
    const max = Number(rangeMatch[2]);
    if (min > max) fail(path, `rep range minimum ${min} is larger than maximum ${max}`);
    return { kind: "range", min, max };
  }
  if (/^\d+$/.test(value.trim())) return { kind: "fixed", count: Number(value.trim()) };

  return { kind: "text", text: value };
}

/** Converts a `sets` value (count or per-set list) into one SetPrescription per set. */
function parseSets(value: unknown, itemReps: Reps | undefined, itemLoad: string | undefined, path: string, warnings: ProgramWarning[]): SetPrescription[] {
  const isCount = (candidate: unknown): candidate is Exclude<SetsWire, SetWire[]> => typeof candidate === "number";

  if (isCount(value)) {
    if (!Number.isInteger(value) || value < 1) fail(path, `expected a whole number of at least 1 but found ${value}`);
    return Array.from({ length: value }, () => ({ reps: itemReps, load: itemLoad }));
  }

  const entries = expectArray(value, path);
  if (entries.length === 0) fail(path, "per-set list must not be empty");
  return entries.map((entry, index) => {
    const setPath = `${path}[${index}]`;
    const record = expectRecord(entry, setPath);
    collectUnknownFields(record, SET_KEYS, setPath, warnings);
    return {
      reps: parseReps(record.reps ?? fail(child(setPath, "reps"), "field is missing"), child(setPath, "reps")),
      load: readOptionalString(record, "load", setPath) ?? itemLoad,
    };
  });
}

/** Converts evidence text: "coaching practice" or an http(s) URL. */
function parseEvidence(value: unknown, path: string): Evidence {
  if (typeof value !== "string") fail(path, `expected a URL or "coaching practice" but found ${describe(value)}`);
  const evidenceText: EvidenceWire = value;
  if (evidenceText === "coaching practice") return { kind: "coachingPractice" };
  if (/^https?:\/\/\S+$/.test(evidenceText)) return { kind: "url", url: evidenceText };
  return fail(path, `expected a URL or "coaching practice" but found ${JSON.stringify(evidenceText)}`);
}

/** Converts an optional format field; absent means ordinary straight sets. */
function parseFormat(record: UnknownRecord, path: string): Format {
  const value = record.format;
  if (value === undefined) return "straight sets";
  if (value === "emom" || value === "interval" || value === "superset") return value;
  return fail(child(path, "format"), `expected "emom", "interval" or "superset" but found ${describe(value)}`);
}

/** Converts one entry of the exercise library. */
function parseExercise(id: string, raw: unknown, path: string, warnings: ProgramWarning[]): Exercise {
  const record = expectRecord(raw, path);
  collectUnknownFields(record, EXERCISE_KEYS, path, warnings);

  return {
    id,
    name: readString(record, "name", path),
    category: readString(record, "category", path),
    cues: record.cues === undefined ? [] : readStringList(record, "cues", path),
    alternative: readOptionalString(record, "alternative", path),
    evidence: parseEvidence(record.evidence ?? fail(child(path, "evidence"), "field is missing"), child(path, "evidence")),
    progression: record.progression === undefined ? [] : readStringList(record, "progression", path),
    maxTested: readFlag(record, "maxTested", path),
  };
}

/** Converts one block item, looking its exercise id up in the library. */
function parseItem(raw: unknown, exercises: Record<string, Exercise>, path: string, warnings: ProgramWarning[]): BlockItem {
  const record = expectRecord(raw, path);
  collectUnknownFields(record, ITEM_KEYS, path, warnings);

  const exerciseId = readString(record, "exercise", path);
  const exercise = Object.hasOwn(exercises, exerciseId) ? exercises[exerciseId] : undefined;
  if (exercise === undefined) fail(child(path, "exercise"), `unknown exercise ${JSON.stringify(exerciseId)}`);

  if (record.reps !== undefined && record.repsPctOfMax !== undefined) {
    fail(path, `use either "reps" or "repsPctOfMax", not both`);
  }

  // Item-level reps: plain reps, or a percentage of the tested max.
  let reps: Reps | undefined;
  if (record.reps !== undefined) {
    reps = parseReps(record.reps, child(path, "reps"));
  } else if (record.repsPctOfMax !== undefined) {
    const fraction = parseRange(record.repsPctOfMax, child(path, "repsPctOfMax"));
    reps = { kind: "percentOfMax", min: fraction.min, max: fraction.max };
  }

  const load = readOptionalString(record, "load", path);
  const sets = record.sets === undefined ? [] : parseSets(record.sets, reps, load, child(path, "sets"), warnings);

  return {
    exerciseId,
    exercise,
    format: parseFormat(record, path),
    sets,
    // With explicit sets the reps live in each set, so don't also expose them item-wide.
    reps: sets.length > 0 ? undefined : reps,
    restSec: readOptionalRange(record, "restSec", path),
    minutes: readOptionalNumber(record, "minutes", path),
    rounds: readOptionalRange(record, "rounds", path),
    workSec: readOptionalRange(record, "workSec", path),
    durationSec: readOptionalNumber(record, "durationSec", path),
    perSide: readFlag(record, "perSide", path),
    optional: readFlag(record, "optional", path),
    load,
    note: readOptionalString(record, "note", path),
    tempo: readOptionalString(record, "tempo", path),
    weeklyIncrease: readOptionalString(record, "weeklyIncrease", path),
  };
}

/** Converts one block and all of its items. */
function parseBlock(raw: unknown, exercises: Record<string, Exercise>, path: string, warnings: ProgramWarning[]): Block {
  const record = expectRecord(raw, path);
  collectUnknownFields(record, BLOCK_KEYS, path, warnings);

  const itemsPath = child(path, "items");
  const items = expectArray(record.items ?? fail(itemsPath, "field is missing"), itemsPath);

  return {
    type: readString(record, "type", path),
    format: parseFormat(record, path),
    rounds: readOptionalRange(record, "rounds", path),
    minutes: readOptionalNumber(record, "minutes", path),
    restSecBetweenPairs: readOptionalRange(record, "restSecBetweenPairs", path),
    items: items.map((item, index) => parseItem(item, exercises, `${itemsPath}[${index}]`, warnings)),
  };
}

/**
 * Reads `record[key]` as a program day number: a whole number from 1 to 7.
 * Used for `days[].day` and `program.restDay`; anything else (a string such
 * as text, 0, 8, 2.5) is rejected with the offending value in the message.
 */
function readDayNumber(record: UnknownRecord, key: string, path: string): DayNumber {
  const value = record[key];
  if (value === undefined) fail(child(path, key), "field is missing");
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > DAYS_PER_WEEK) {
    fail(child(path, key), `expected a whole number from 1 to ${DAYS_PER_WEEK} but found ${JSON.stringify(value)}`);
  }
  return value;
}

/** Converts one training day and its blocks. */
function parseDay(raw: unknown, exercises: Record<string, Exercise>, path: string, warnings: ProgramWarning[]): Day {
  const record = expectRecord(raw, path);
  collectUnknownFields(record, DAY_KEYS, path, warnings);

  const blocksPath = child(path, "blocks");
  const blocks = expectArray(record.blocks ?? fail(blocksPath, "field is missing"), blocksPath);

  return {
    day: readDayNumber(record, "day", path),
    focus: readString(record, "focus", path),
    targetMinutes: readNumber(record, "targetMinutes", path),
    blocks: blocks.map((block, index) => parseBlock(block, exercises, `${blocksPath}[${index}]`, warnings)),
  };
}

/** Converts one progression phase. */
function parseProgressionPhase(raw: unknown, path: string, warnings: ProgramWarning[]): ProgressionPhase {
  const record = expectRecord(raw, path);
  collectUnknownFields(record, PROGRESSION_PHASE_KEYS, path, warnings);

  const weeksPath = child(path, "weeks");
  const weeks = expectArray(record.weeks ?? fail(weeksPath, "field is missing"), weeksPath).map((week, index) => {
    if (typeof week !== "number" || !Number.isInteger(week)) fail(`${weeksPath}[${index}]`, `expected a week number but found ${describe(week)}`);
    return week;
  });

  return {
    weeks,
    phase: readString(record, "phase", path),
    changes: readStringList(record, "changes", path),
    retest: readFlag(record, "retest", path),
  };
}

/** Converts the warm-up rotation section. */
function parseWarmupRotation(raw: unknown, path: string, warnings: ProgramWarning[]): WarmupRotation {
  const record = expectRecord(raw, path);
  collectUnknownFields(record, WARMUP_ROTATION_KEYS, path, warnings);

  const swapsPath = child(path, "swaps");
  const swaps = expectArray(record.swaps ?? fail(swapsPath, "field is missing"), swapsPath).map((swap, index) => {
    const swapPath = `${swapsPath}[${index}]`;
    const swapRecord = expectRecord(swap, swapPath);
    collectUnknownFields(swapRecord, WARMUP_SWAP_KEYS, swapPath, warnings);
    return { out: readString(swapRecord, "out", swapPath), in: readString(swapRecord, "in", swapPath) };
  });

  return { everyWeeks: readPositiveInteger(record, "everyWeeks", path), swaps, alsoAvailable: readStringList(record, "alsoAvailable", path) };
}

/** Converts the fatigue-check section. */
function parseFatigueCheck(raw: unknown, path: string, warnings: ProgramWarning[]): FatigueCheck {
  const record = expectRecord(raw, path);
  collectUnknownFields(record, FATIGUE_CHECK_KEYS, path, warnings);

  return {
    frequency: readString(record, "frequency", path),
    tests: readStringList(record, "tests", path),
    rule: readString(record, "rule", path),
    lowerBackRule: readString(record, "lowerBackRule", path),
  };
}

/**
 * Fails unless the phases cover weeks 1..lengthWeeks exactly once: no week
 * outside the program, none listed twice, none missing. The schedule looks
 * a phase up for every week, so a gap would otherwise crash on that day.
 */
function checkProgressionCoversEveryWeek(progression: ProgressionPhase[], lengthWeeks: number): void {
  const seenInPhase = new Map<number, number>();

  progression.forEach((phase, phaseIndex) => {
    phase.weeks.forEach((week, weekIndex) => {
      const path = `progression[${phaseIndex}].weeks[${weekIndex}]`;
      if (week < 1 || week > lengthWeeks) {
        fail(path, `week ${week} is outside the program (weeks 1 to ${lengthWeeks})`);
      }
      const earlierPhase = seenInPhase.get(week);
      if (earlierPhase !== undefined) {
        fail(path, `week ${week} is already covered by progression[${earlierPhase}]`);
      }
      seenInPhase.set(week, phaseIndex);
    });
  });

  for (let week = 1; week <= lengthWeeks; week++) {
    if (!seenInPhase.has(week)) {
      fail("progression", `week ${week} is not covered by any phase`);
    }
  }
}

/** Reads a required top-level section of the document. */
function requireSection(root: UnknownRecord, key: string): unknown {
  return root[key] ?? fail(key, "section is missing");
}

/**
 * Validates parsed program.json contents and builds the internal `Program`.
 *
 * Called by `loadProgram` at startup and directly by tests. Throws an Error
 * with a path-style message (see the module comment) on the first real
 * problem; unknown fields don't throw but come back in `warnings`.
 * Exercises are parsed first so day items can resolve their exercise ids.
 */
export function parseProgram(json: unknown): ParseResult {
  const warnings: ProgramWarning[] = [];
  const root = expectRecord(json, "program.json");
  collectUnknownFields(root, ROOT_KEYS, "", warnings);

  const info = expectRecord(requireSection(root, "program"), "program");
  collectUnknownFields(info, PROGRAM_INFO_KEYS, "program", warnings);

  const exerciseRecords = expectRecord(requireSection(root, "exercises"), "exercises");
  const exercises: Record<string, Exercise> = {};
  for (const [id, rawExercise] of Object.entries(exerciseRecords)) {
    exercises[id] = parseExercise(id, rawExercise, `exercises.${id}`, warnings);
  }

  const days: Partial<Record<DayNumber, Day>> = {};
  expectArray(requireSection(root, "days"), "days").forEach((rawDay, index) => {
    const day = parseDay(rawDay, exercises, `days[${index}]`, warnings);
    if (days[day.day] !== undefined) fail(`days[${index}].day`, `day ${day.day} appears more than once`);
    days[day.day] = day;
  });
  if (Object.keys(days).length === 0) fail("days", "the program needs at least one training day");

  const restDay = readDayNumber(info, "restDay", "program");
  if (days[restDay] !== undefined) {
    fail("program.restDay", `day ${restDay} is the rest day but days has an entry for it`);
  }

  const coreProgressionRecord = expectRecord(requireSection(root, "coreProgressions"), "coreProgressions");
  const coreProgressions: Record<string, string> = {};
  for (const key of Object.keys(coreProgressionRecord)) {
    coreProgressions[key] = readString(coreProgressionRecord, key, "coreProgressions");
  }

  const lengthWeeks = readPositiveInteger(info, "lengthWeeks", "program");
  const progression = expectArray(requireSection(root, "progression"), "progression").map((phase, index) =>
    parseProgressionPhase(phase, `progression[${index}]`, warnings),
  );
  checkProgressionCoversEveryWeek(progression, lengthWeeks);

  const program: Program = {
    name: readString(info, "name", "program"),
    goal: readString(info, "goal", "program"),
    lengthWeeks,
    restDay,
    sessionOrder: readStringList(info, "sessionOrder", "program"),
    rules: readStringList(info, "rules", "program"),
    exercises,
    days,
    progression,
    coreProgressions,
    warmupRotation: parseWarmupRotation(requireSection(root, "warmupRotation"), "warmupRotation", warnings),
    fatigueCheck: parseFatigueCheck(requireSection(root, "fatigueCheck"), "fatigueCheck", warnings),
  };

  return { program, warnings };
}
