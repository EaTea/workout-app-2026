/**
 * Turns the untrusted contents of program.json into the internal `Program`.
 *
 * This is the only module that knows the wire format (`wire.ts`). It validates
 * as it maps, and every failure is an Error whose message starts with a
 * path-style location, e.g.
 *   days[2].blocks[1].items[0].exercise: unknown exercise "foo"
 * because that message is what Ed sees after breaking program.json while editing.
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
 *               │                              └─ parseNoEquipmentSwap (the item's optional swap)
 *               ├─ parseCombining (the allowed day pairs; bad pairs become warnings)
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
  NoEquipmentSwap,
  ProgressionPhase,
  TimerAdjustments,
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
  CombiningWire,
  DayWire,
  EvidenceWire,
  ExerciseWire,
  FatigueCheckWire,
  ItemWire,
  NoEquipmentSwapWire,
  NumberOrRangeWire,
  ProgramInfoWire,
  ProgramWire,
  ProgressionPhaseWire,
  TimerAdjustmentsWire,
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

const ROOT_KEYS = allowedKeysOf<ProgramWire>()(["program", "exercises", "days", "progression", "coreProgressions", "warmupRotation", "fatigueCheck", "combining"]);
const PROGRAM_INFO_KEYS = allowedKeysOf<ProgramInfoWire>()(["name", "goal", "lengthWeeks", "restDay", "sessionOrder", "rules", "safety"]);
const EXERCISE_KEYS = allowedKeysOf<ExerciseWire>()(["name", "category", "cues", "alternative", "evidence", "progression", "maxTested"]);
const DAY_KEYS = allowedKeysOf<DayWire>()(["day", "focus", "targetMinutes", "blocks"]);
const BLOCK_KEYS = allowedKeysOf<BlockWire>()(["type", "format", "rounds", "minutes", "restSecBetweenPairs", "items"]);
const ITEM_KEYS = allowedKeysOf<ItemWire>()([
  "exercise", "format", "sets", "reps", "repsPctOfMax", "restSec", "minutes", "rounds", "workSec", "durationSec", "perSide", "optional", "sameEveryWeek", "load", "note", "tempo", "weeklyIncrease", "noEquipment", "weeks",
]);
const NO_EQUIPMENT_SWAP_KEYS = allowedKeysOf<NoEquipmentSwapWire>()(["exercise", "reps", "durationSec", "load", "note", "tempo"]);
/** Item fields a swap may not set because it keeps them from the original (everything but its own keys; includes `noEquipment`, so swaps can't nest). Derived so it follows ITEM_KEYS. */
const KEPT_FROM_ORIGINAL_KEYS = ITEM_KEYS.filter((key) => !NO_EQUIPMENT_SWAP_KEYS.includes(key));
const SET_KEYS = allowedKeysOf<SetWire>()(["reps", "load"]);
const PROGRESSION_PHASE_KEYS = allowedKeysOf<ProgressionPhaseWire>()(["weeks", "phase", "changes", "retest", "timerAdjustments"]);
const TIMER_ADJUSTMENT_KEYS = allowedKeysOf<TimerAdjustmentsWire>()(["intervalWorkSec", "coreRestBetweenPairsSec"]);
const WARMUP_ROTATION_KEYS = allowedKeysOf<WarmupRotationWire>()(["everyWeeks", "swaps", "alsoAvailable"]);
const WARMUP_SWAP_KEYS = allowedKeysOf<WarmupSwapWire>()(["out", "in"]);
const FATIGUE_CHECK_KEYS = allowedKeysOf<FatigueCheckWire>()(["frequency", "tests", "rule", "lowerBackRule"]);
const COMBINING_KEYS = allowedKeysOf<CombiningWire>()(["pairs"]);

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

/**
 * Reads an optional list of non-empty strings (`program.safety`): absent gives
 * an empty list, while a present list must hold only text with something in
 * it, because each entry is shown to the person as a safety note. Called by
 * `parseProgram`.
 */
function readOptionalNonEmptyStringList(record: UnknownRecord, key: string, path: string): string[] {
  if (record[key] === undefined) return [];

  const notes = readStringList(record, key, path);
  notes.forEach((note, index) => {
    if (note.trim() === "") fail(`${child(path, key)}[${index}]`, "expected text but found an empty string");
  });
  return notes;
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

/**
 * Converts an item's optional `noEquipment` swap (called by `parseItem`, which
 * passes what it already worked out about the original). Keys the swap must
 * keep from the original are errors, because silently ignoring them would let
 * a swap look like it changes the dose when it can't. Other unknown keys are
 * warnings with a "did you mean" hint, like everywhere else.
 *
 * A swap also can't change the kind of dose: a timed hold (the original has
 * `durationSec`) is swapped for another hold, and a reps item for another
 * reps item. `applyNoEquipmentSwap` takes reps and hold time from the swap
 * independently, so mixing them would silently keep the original's other
 * figure (a "2 × 30s" plank swapped for "10" reps would still be timed).
 */
function parseNoEquipmentSwap(
  raw: unknown,
  original: { exerciseId: string; isMaxBased: boolean; isTimed: boolean },
  exercises: Record<string, Exercise>,
  path: string,
  warnings: ProgramWarning[],
): NoEquipmentSwap {
  const record = expectRecord(raw, path);

  for (const key of Object.keys(record)) {
    if (KEPT_FROM_ORIGINAL_KEYS.includes(key)) {
      fail(child(path, key), `a swap keeps "${key}" from the original item, so it can't be set here`);
    }
  }
  collectUnknownFields(record, NO_EQUIPMENT_SWAP_KEYS, path, warnings);

  const swapExerciseId = readString(record, "exercise", path);
  const swapExercise = Object.hasOwn(exercises, swapExerciseId) ? exercises[swapExerciseId] : undefined;
  if (swapExercise === undefined) fail(child(path, "exercise"), `unknown exercise ${JSON.stringify(swapExerciseId)}`);
  if (swapExercise.maxTested) {
    fail(child(path, "exercise"), `${JSON.stringify(swapExerciseId)} is max-tested, and a swap never uses a tested max`);
  }
  if (swapExerciseId === original.exerciseId) {
    fail(child(path, "exercise"), `a swap can't be the item's own exercise ${JSON.stringify(swapExerciseId)}`);
  }

  if (original.isTimed && record.reps !== undefined) {
    fail(child(path, "reps"), "the original item is a timed hold, so its swap is a hold too: give \"durationSec\", not \"reps\"");
  }
  if (!original.isTimed && record.durationSec !== undefined) {
    fail(child(path, "durationSec"), "the original item is done in reps, so its swap is too: give \"reps\", not \"durationSec\"");
  }

  if (original.isMaxBased && record.reps === undefined) {
    fail(child(path, "reps"), "field is missing (the original item uses a percentage of a tested max, so the swap needs its own reps)");
  }

  return {
    exercise: swapExercise,
    reps: record.reps === undefined ? undefined : parseReps(record.reps, child(path, "reps")),
    durationSec: readOptionalNumber(record, "durationSec", path),
    load: readOptionalString(record, "load", path),
    note: readOptionalString(record, "note", path),
    tempo: readOptionalString(record, "tempo", path),
  };
}

/**
 * Reads an item's optional `weeks` list (the weeks the item runs in) into the
 * model's `runsInWeeks`. Absent gives "everyWeek". A present value must be a
 * non-empty list of whole numbers from 1 to `lengthWeeks` with no repeats:
 * anything else would silently drop or double an exercise, so it is a parse
 * error. Called by `parseItem`.
 */
function readRunsInWeeks(record: UnknownRecord, path: string, lengthWeeks: number): ReadonlySet<number> | "everyWeek" {
  if (record.weeks === undefined) return "everyWeek";

  const weeksPath = child(path, "weeks");
  const weeks = expectArray(record.weeks, weeksPath);
  if (weeks.length === 0) fail(weeksPath, "expected at least one week, or leave \"weeks\" out to run every week");

  const seenWeeks = new Set<number>();
  weeks.forEach((week, index) => {
    const weekPath = `${weeksPath}[${index}]`;
    if (typeof week !== "number" || !Number.isInteger(week)) {
      fail(weekPath, `expected a whole number but found ${describe(week)}`);
    }
    if (week < 1 || week > lengthWeeks) {
      fail(weekPath, `week ${week} is outside the program (weeks 1 to ${lengthWeeks})`);
    }
    if (seenWeeks.has(week)) fail(weekPath, `week ${week} is listed more than once`);
    seenWeeks.add(week);
  });

  return seenWeeks;
}

/**
 * Records a warning for each program week in which none of the block's items
 * run (only possible when some items have `weeks`). The schedule leaves the
 * block out of those weeks' sessions, which is almost never what was meant,
 * so the banner tells Ed which day, block and weeks. Called by `parseDay`.
 */
function warnAboutWeeksWithNoItems(block: Block, dayNumber: DayNumber, blockPath: string, lengthWeeks: number, warnings: ProgramWarning[]): void {
  if (block.items.every((item) => item.runsInWeeks === "everyWeek")) return;

  const emptyWeeks: number[] = [];
  for (let week = 1; week <= lengthWeeks; week++) {
    const someItemRuns = block.items.some((item) => item.runsInWeeks === "everyWeek" || item.runsInWeeks.has(week));
    if (!someItemRuns) emptyWeeks.push(week);
  }
  if (emptyWeeks.length === 0) return;

  const weekWord = emptyWeeks.length === 1 ? "week" : "weeks";
  warnings.push({
    path: blockPath,
    message: `Day ${dayNumber} "${block.type}" block has no items in ${weekWord} ${emptyWeeks.join(", ")}, so it is left out of ${emptyWeeks.length === 1 ? "that week" : "those weeks"}`,
  });
}

/** Converts one block item, looking its exercise id up in the library. */
function parseItem(raw: unknown, exercises: Record<string, Exercise>, lengthWeeks: number, path: string, warnings: ProgramWarning[]): BlockItem {
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

  // sameEveryWeek promises the item is identical in all 8 weeks, but an EMOM's
  // weekly increase still grows its reps, so the two can't be combined.
  const sameEveryWeek = readFlag(record, "sameEveryWeek", path);
  if (sameEveryWeek && record.weeklyIncrease !== undefined) {
    fail(path, `"sameEveryWeek" can't be combined with "weeklyIncrease", which changes the reps each week`);
  }

  // The weekly-increase offsets and the week-8 hold count every week, so
  // skipped weeks would make the shown reps wrong.
  if (record.weeks !== undefined && record.weeklyIncrease !== undefined) {
    fail(path, `"weeks" can't be combined with "weeklyIncrease", whose increase counts every week of the program`);
  }

  const load = readOptionalString(record, "load", path);
  const sets = record.sets === undefined ? [] : parseSets(record.sets, reps, load, child(path, "sets"), warnings);

  // An item is max-based when its reps (item-level, or in any set) are a percentage of the tested max.
  const isMaxBased = [reps, ...sets.map((set) => set.reps)].some((setReps) => setReps?.kind === "percentOfMax");
  const noEquipment =
    record.noEquipment === undefined
      ? undefined
      : parseNoEquipmentSwap(
          record.noEquipment,
          { exerciseId, isMaxBased, isTimed: record.durationSec !== undefined },
          exercises,
          child(path, "noEquipment"),
          warnings,
        );

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
    sameEveryWeek,
    load,
    note: readOptionalString(record, "note", path),
    tempo: readOptionalString(record, "tempo", path),
    weeklyIncrease: readOptionalString(record, "weeklyIncrease", path),
    noEquipment,
    runsInWeeks: readRunsInWeeks(record, path, lengthWeeks),
  };
}

/**
 * Fails when a block lists the same exercise id twice and both items run in
 * some common week (overlapping `weeks`, or either without `weeks`): History,
 * Last time and Progress resolve a logged set to the first matching item, so
 * the second would be unreachable. The same exercise in disjoint weeks is
 * fine. Called by `parseBlock`.
 */
function failOnExerciseRepeatedInSameWeek(items: BlockItem[], itemsPath: string): void {
  items.forEach((item, index) => {
    for (let earlierIndex = 0; earlierIndex < index; earlierIndex++) {
      const earlier = items[earlierIndex]!;
      if (earlier.exerciseId !== item.exerciseId) continue;

      const runInCommonWeek =
        earlier.runsInWeeks === "everyWeek" || item.runsInWeeks === "everyWeek" || [...item.runsInWeeks].some((week) => (earlier.runsInWeeks as ReadonlySet<number>).has(week));
      if (runInCommonWeek) {
        fail(
          `${itemsPath}[${index}]`,
          `exercise ${JSON.stringify(item.exerciseId)} is already in this block (items[${earlierIndex}]) and both run in the same week; give them separate "weeks" or use it once`,
        );
      }
    }
  });
}

/**
 * Converts one block and all of its items. Refuses a `sameEveryWeek` item in
 * a block with its own `rounds` or `minutes`: a deload halves those for the
 * whole block, so the item couldn't stay the same every week.
 */
function parseBlock(raw: unknown, exercises: Record<string, Exercise>, lengthWeeks: number, path: string, warnings: ProgramWarning[]): Block {
  const record = expectRecord(raw, path);
  collectUnknownFields(record, BLOCK_KEYS, path, warnings);

  const itemsPath = child(path, "items");
  const items = expectArray(record.items ?? fail(itemsPath, "field is missing"), itemsPath);

  const rounds = readOptionalRange(record, "rounds", path);
  const minutes = readOptionalNumber(record, "minutes", path);
  const parsedItems = items.map((item, index) => parseItem(item, exercises, lengthWeeks, `${itemsPath}[${index}]`, warnings));

  const blockIsHalvedAsAWhole = rounds !== undefined || minutes !== undefined;
  const sameEveryWeekIndex = parsedItems.findIndex((parsedItem) => parsedItem.sameEveryWeek);
  if (blockIsHalvedAsAWhole && sameEveryWeekIndex !== -1) {
    fail(
      `${itemsPath}[${sameEveryWeekIndex}]`,
      `"sameEveryWeek" can't be used in a block with its own "rounds" or "minutes", which a deload halves; put the item in a block without them`,
    );
  }

  failOnExerciseRepeatedInSameWeek(parsedItems, itemsPath);

  return {
    type: readString(record, "type", path),
    format: parseFormat(record, path),
    rounds,
    minutes,
    restSecBetweenPairs: readOptionalRange(record, "restSecBetweenPairs", path),
    items: parsedItems,
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
    // A weekday name is the likely mistake (an old program.json used "Mon"), so explain the numbering.
    const hint =
      typeof value === "string"
        ? `. Days are numbered 1–${DAYS_PER_WEEK} from your start date (Day 1 is the first session).`
        : "";
    fail(child(path, key), `expected a whole number from 1 to ${DAYS_PER_WEEK} but found ${describe(value)}${hint}`);
  }
  return value;
}

/**
 * Converts one training day and its blocks, and records a warning for each
 * block with weeks in which none of its items run (see `warnAboutWeeksWithNoItems`).
 */
function parseDay(raw: unknown, exercises: Record<string, Exercise>, lengthWeeks: number, path: string, warnings: ProgramWarning[]): Day {
  const record = expectRecord(raw, path);
  collectUnknownFields(record, DAY_KEYS, path, warnings);

  const blocksPath = child(path, "blocks");
  const blocks = expectArray(record.blocks ?? fail(blocksPath, "field is missing"), blocksPath);

  const day = readDayNumber(record, "day", path);
  const parsedBlocks = blocks.map((block, index) => {
    const blockPath = `${blocksPath}[${index}]`;
    const parsedBlock = parseBlock(block, exercises, lengthWeeks, blockPath, warnings);
    warnAboutWeeksWithNoItems(parsedBlock, day, blockPath, lengthWeeks, warnings);
    return parsedBlock;
  });

  return {
    day,
    focus: readString(record, "focus", path),
    targetMinutes: readNumber(record, "targetMinutes", path),
    blocks: parsedBlocks,
  };
}

/** Reads an optional whole-number field (negative allowed); a missing key is 0. */
function readOptionalWholeSeconds(record: UnknownRecord, key: string, path: string): number {
  const value = record[key];
  if (value === undefined) return 0;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    fail(child(path, key), `expected a whole number of seconds but found ${describe(value)}`);
  }
  return value;
}

/**
 * Converts a phase's optional `timerAdjustments` object. Called by
 * parseProgressionPhase; unknown keys become warnings like everywhere else.
 */
function parseTimerAdjustments(raw: unknown, path: string, warnings: ProgramWarning[]): TimerAdjustments {
  const record = expectRecord(raw, path);
  collectUnknownFields(record, TIMER_ADJUSTMENT_KEYS, path, warnings);

  return {
    intervalWorkSec: readOptionalWholeSeconds(record, "intervalWorkSec", path),
    coreRestBetweenPairsSec: readOptionalWholeSeconds(record, "coreRestBetweenPairsSec", path),
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
    timerAdjustments: record.timerAdjustments === undefined ? undefined : parseTimerAdjustments(record.timerAdjustments, child(path, "timerAdjustments"), warnings),
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
 * Converts the optional `combining` section into the list of usable day pairs
 * (rule 1 of the combine design). A pair is usable when it is a list of two
 * whole-number days that are different training days (in `days`, so never the
 * rest day), next to each other, lower day first. An unusable pair is not an
 * error: it becomes a `ProgramWarning` naming its path and reason, and is
 * left out, so a typo in Ed's file never takes down the app, it just offers
 * fewer combines. A pair repeated in the file is kept once. A `combining`
 * section that is not an object, or whose `pairs` is not a list, is a real
 * error like any other malformed section. Called by `parseProgram` after the
 * days are known.
 *
 *   "combining": { "pairs": [[1, 2], [2, 4]] }  ──▶  [[1, 2]] + a warning for [2, 4]
 */
function parseCombining(
  raw: unknown,
  days: Partial<Record<DayNumber, Day>>,
  path: string,
  warnings: ProgramWarning[],
): [DayNumber, DayNumber][] {
  const record = expectRecord(raw, path);
  collectUnknownFields(record, COMBINING_KEYS, path, warnings);

  const rawPairs = expectArray(record.pairs ?? fail(child(path, "pairs"), "field is missing"), child(path, "pairs"));
  const pairs: [DayNumber, DayNumber][] = [];

  rawPairs.forEach((rawPair, index) => {
    const pairPath = `${child(path, "pairs")}[${index}]`;
    const problem = describeCombinePairProblem(rawPair, days);
    if (problem !== null) {
      warnings.push({ path: pairPath, message: `${problem}, so this pair is ignored` });
      return;
    }

    const [earlierDay, laterDay] = rawPair as [DayNumber, DayNumber];
    const alreadyListed = pairs.some(([listedEarlier, listedLater]) => listedEarlier === earlierDay && listedLater === laterDay);
    if (!alreadyListed) pairs.push([earlierDay, laterDay]);
  });

  return pairs;
}

/**
 * Why `rawPair` cannot be a combine pair, or null when it can. Kept apart
 * from `parseCombining` so each rule reads as one check, in the order a
 * person fixing the file would meet them. Only `parseCombining` calls it.
 */
function describeCombinePairProblem(rawPair: unknown, days: Partial<Record<DayNumber, Day>>): string | null {
  if (!Array.isArray(rawPair) || rawPair.length !== 2) {
    return `expected a pair like [1, 2] but found ${describe(rawPair)}`;
  }

  const [earlierDay, laterDay] = rawPair as unknown[];
  for (const day of [earlierDay, laterDay]) {
    if (typeof day !== "number" || !Number.isInteger(day)) {
      return `expected two whole day numbers but found ${describe(day)}`;
    }
    if (days[day] === undefined) {
      return `day ${day} is not a training day`;
    }
  }

  if (earlierDay === laterDay) return `day ${earlierDay as number} cannot be combined with itself`;
  if (laterDay !== (earlierDay as number) + 1) {
    return `days ${earlierDay as number} and ${laterDay as number} are not next to each other, with the lower day first`;
  }
  return null;
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
 * The section's raw value, or undefined when the program file leaves it out.
 * Used for the sections a program may omit (`coreProgressions`,
 * `warmupRotation`, `fatigueCheck`); a present section is still fully checked
 * by its own parser. Called by `parseProgram`.
 */
function optionalSection(root: UnknownRecord, key: string): unknown {
  return root[key];
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

  // Read before the days because an item's `weeks` are checked against it.
  const lengthWeeks = readPositiveInteger(info, "lengthWeeks", "program");

  const days: Partial<Record<DayNumber, Day>> = {};
  expectArray(requireSection(root, "days"), "days").forEach((rawDay, index) => {
    const day = parseDay(rawDay, exercises, lengthWeeks, `days[${index}]`, warnings);
    if (days[day.day] !== undefined) fail(`days[${index}].day`, `day ${day.day} appears more than once`);
    days[day.day] = day;
  });
  if (Object.keys(days).length === 0) fail("days", "the program needs at least one training day");

  const restDay = readDayNumber(info, "restDay", "program");
  if (days[restDay] !== undefined) {
    fail("program.restDay", `day ${restDay} is the rest day but days has an entry for it`);
  }

  // An absent section means no core progressions: an empty record.
  const rawCoreProgressions = optionalSection(root, "coreProgressions");
  const coreProgressionRecord = rawCoreProgressions === undefined ? {} : expectRecord(rawCoreProgressions, "coreProgressions");
  const coreProgressions: Record<string, string> = {};
  for (const key of Object.keys(coreProgressionRecord)) {
    coreProgressions[key] = readString(coreProgressionRecord, key, "coreProgressions");
  }

  const rawWarmupRotation = optionalSection(root, "warmupRotation");
  const rawFatigueCheck = optionalSection(root, "fatigueCheck");
  const rawCombining = optionalSection(root, "combining");

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
    safety: readOptionalNonEmptyStringList(info, "safety", "program"),
    exercises,
    days,
    progression,
    coreProgressions,
    warmupRotation: rawWarmupRotation === undefined ? undefined : parseWarmupRotation(rawWarmupRotation, "warmupRotation", warnings),
    fatigueCheck: rawFatigueCheck === undefined ? undefined : parseFatigueCheck(rawFatigueCheck, "fatigueCheck", warnings),
    combinePairs: rawCombining === undefined ? [] : parseCombining(rawCombining, days, "combining", warnings),
  };

  return { program, warnings };
}
