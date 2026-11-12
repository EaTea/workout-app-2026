import type { WorkoutLog } from "../log/model";
import type { Program } from "../program/model";
import { setDay } from "../log/setDay";
import { performedAsName } from "../program/rotation";

/**
 * CSV export of the workout log: one row per logged set, for opening in a
 * spreadsheet. Pure (no DOM, no storage) so it is unit tested directly;
 * `ui/exportSection.ts` calls `logToCsv` and hands the text to `download.ts`.
 *
 *   WorkoutLog + Program ──logToCsv──▶ "date,week,day,...\r\n2026-11-02,1,1,..."
 */

/** The header row, in column order. Rows are built in exactly this order. */
export const CSV_COLUMNS = [
  "date",
  "week",
  "day",
  "block",
  "block_type",
  "exercise_id",
  "exercise_name",
  "performed_as",
  "set",
  "reps",
  "kg",
  "note",
] as const;

/**
 * Byte order mark. Excel opens a CSV as the local ANSI code page unless the
 * file starts with this, which garbles non-ASCII text such as the "→" or
 * accented letters in a note.
 */
export const CSV_BYTE_ORDER_MARK = "\uFEFF";

/** RFC 4180 says records end with CRLF; spreadsheets on every platform accept it. */
const LINE_ENDING = "\r\n";

/**
 * Builds the whole CSV text for `log`: the header, then every set of every
 * session, sessions oldest first and sets in block then set order. Names and
 * block types are looked up in `program` (a set whose exercise or block is no
 * longer in the program shows the raw exercise id and an empty block type, so
 * old logs still export). `exercise_name` is the exercise as the program
 * names it; `performed_as` is the rotated-in name for a warm-up logged in a
 * swapped week, else the same text. The text starts with a UTF-8 byte order
 * mark so Excel reads it as UTF-8. The day column and the block type come
 * from each set's own day (`setDay`), so a session holding two days exports
 * each row under its own day. Missing reps, kg, week and day become empty cells.
 */
export function logToCsv(log: WorkoutLog, program: Program): string {
  const rows: string[][] = [[...CSV_COLUMNS]];

  const sessions = Object.values(log.sessions).sort((first, second) => first.date.localeCompare(second.date));

  for (const session of sessions) {
    // Day first, so a session holding two days lists one day's rows, then the other's.
    const sets = [...session.sets].sort(
      (first, second) =>
        (setDay(session, first) ?? 0) - (setDay(session, second) ?? 0) ||
        first.blockPosition - second.blockPosition ||
        first.setNumber - second.setNumber,
    );

    for (const set of sets) {
      const exerciseName = program.exercises[set.exerciseId]?.name ?? set.exerciseId;
      const day = setDay(session, set);
      const blockType = day === undefined ? "" : (program.days[day]?.blocks[set.blockPosition - 1]?.type ?? "");

      rows.push([
        session.date,
        session.programWeek?.toString() ?? "",
        day?.toString() ?? "",
        set.blockPosition.toString(),
        blockType,
        set.exerciseId,
        exerciseName,
        performedAsName(program, set.exerciseId, session.programWeek, blockType),
        set.setNumber.toString(),
        set.reps?.toString() ?? "",
        set.loadKg?.toString() ?? "",
        set.note === undefined ? "" : neutraliseSpreadsheetFormula(set.note),
      ]);
    }
  }

  return CSV_BYTE_ORDER_MARK + rows.map((row) => row.map(quoteCsvCell).join(",")).join(LINE_ENDING) + LINE_ENDING;
}

/**
 * Quotes one cell per RFC 4180: a cell containing a comma, a double quote or a
 * line break is wrapped in double quotes, with inner quotes doubled. Other
 * cells are written as they are.
 */
export function quoteCsvCell(cell: string): string {
  if (/[",\r\n]/.test(cell)) {
    return `"${cell.replaceAll('"', '""')}"`;
  }
  return cell;
}

/**
 * Guards against CSV formula injection. The note is the only free text Ed (or
 * anything pasted into a note) controls; Excel, Sheets and Numbers treat a
 * cell starting with `=`, `+`, `-` or `@` (and a leading tab or carriage
 * return) as a formula, which could run when the file is opened. Some of
 * them skip leading spaces first, so spaces before those characters don't
 * stop the guard. A leading single quote makes the spreadsheet show the text literally. Applied to notes
 * only: every other cell is a number, a date, or a name from program.json.
 */
export function neutraliseSpreadsheetFormula(text: string): string {
  return /^ *[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}
