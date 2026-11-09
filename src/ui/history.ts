import type { Program } from "../program/model";
import { formatLoggedSet } from "../log/itemSets";
import { groupSetsByExercise, type ExerciseGroup } from "../log/history";
import type { LoggedSession, LoggedSet, WorkoutLog } from "../log/model";
import { deleteSet, editSet, sessionDates, type SetKey } from "../log/operations";
import { element } from "./dom";
import { formatSetsSummary } from "./format";
import { exerciseDisplayName, formatSessionHeader, loggedSetLabel, loggedSetNoun, loggedSetShowsRepsAndLoad } from "./historyText";
import type { ChangeLog } from "./logChange";
import { renderProgressSection } from "./progressChart";
import { renderSetEditor, type SetEditorValues } from "./setEditor";

/**
 * The History screen at `#/history`: one card per logged session, newest
 * first. Each card lists its exercises in block order with a compact summary;
 * tapping an exercise expands its sets, and tapping a set opens the shared
 * edit panel (reps, kg, note, Save, Delete).
 *
 *   renderHistoryScreen(program, log, changeLog)
 *     state: log (own copy) · expandedGroups · editingSet · message
 *     draw() ─▶ for each date (newest first) ─▶ session card
 *                 header "9 Nov · Week 2 · Day 1 · Upper: pull"
 *                 exercise row ──tap──▶ expands ─▶ "Set 1 · 6 reps · 6 kg" rows
 *                                                    └─tap─▶ edit panel
 *     Save ─▶ editSet ─┐
 *     Delete ─▶ deleteSet ─┴▶ changeLog(op) re-reads, saves (app.ts) ─▶ draw()
 *
 * Deleting the last set of a session removes the session (`deleteSet`), so its
 * card disappears. As on the log screen, a failed save keeps the change in
 * memory and shows an inline message. Delete asks for a second tap.
 *
 * The edit panel offers reps and kg steppers for any set whose program item
 * counts reps (even one logged without reps), and only a note otherwise; when
 * the program no longer describes the item, it goes by what was stored.
 *
 * Every redraw replaces the button that was pressed, so `draw(focusKey)` puts
 * focus back somewhere sensible by the name an element registered under:
 *   expand / collapse ─▶ that exercise row      open a set ─▶ the edit panel's first control
 *   Save / Cancel ─▶ the set's row              Delete ─▶ the session card heading
 *                                                          (page heading if the card is gone)
 */

/** Focus target names that are not per-item (see `draw` in `renderHistoryScreen`). */
const PAGE_HEADING_FOCUS_NAME = "page-heading";
const EDITOR_FOCUS_NAME = "editor";

/** Shown on an empty History. */
export const EMPTY_HISTORY_MESSAGE = "Nothing logged yet. Tap an exercise on Today to log it.";

/**
 * Builds the History screen. `initialLog` is app.ts's current log;
 * `changeLog(operation)` (see logChange.ts) applies one edit or delete to the
 * freshly re-read stored log, saves it, and returns the log to show plus an
 * inline message when saving failed or was refused.
 */
export function renderHistoryScreen(
  program: Program,
  initialLog: WorkoutLog,
  changeLog: ChangeLog,
): HTMLElement {
  const screen = element("section", "screen history-screen");

  let log = initialLog;
  /** Keys (see `groupKey`) of the exercise rows currently expanded. */
  const expandedGroups = new Set<string>();
  /** The one set being edited: its session date and key. */
  let editing: { date: string; key: SetKey } | undefined;
  let message: string | undefined;
  /** Elements that focus can be sent to after a redraw, by name; rebuilt on every draw. */
  let focusTargets = new Map<string, HTMLElement>();

  /** Stable id of an exercise row within the screen, for the expanded state. */
  function groupKey(date: string, group: ExerciseGroup): string {
    return `${date}|${group.blockPosition}|${group.exerciseId}`;
  }

  /** True when `set` of the session on `date` is the one being edited. */
  function isEditing(date: string, set: LoggedSet): boolean {
    return editing !== undefined && editing.date === date && isKeyOfSet(editing.key, set);
  }

  /** Asks app.ts to apply `operation` to the stored log and save it; adopts the resulting log and remembers any failure message. */
  function commit(operation: (freshLog: WorkoutLog) => WorkoutLog): void {
    const outcome = changeLog(operation);
    log = outcome.log;
    message = outcome.error ?? undefined;
  }

  /** Save tapped in the edit panel: stores the edited reps, load and note, then closes the panel. */
  function handleSave(date: string, set: LoggedSet, values: SetEditorValues): void {
    const note = values.note.trim();
    // A key with value undefined clears that field in the stored set.
    commit((freshLog) => editSet(freshLog, date, keyOf(set), {
      reps: values.reps,
      loadKg: values.loadKg > 0 ? values.loadKg : undefined,
      note: note === "" ? undefined : note,
    }));
    editing = undefined;
    draw(setFocusName(date, set));
  }

  /** Delete tapped (twice) in the edit panel. The session card goes with its last set; focus goes to the card's heading, or the page heading if the card is gone. */
  function handleDelete(date: string, set: LoggedSet): void {
    commit((freshLog) => deleteSet(freshLog, date, keyOf(set)));
    editing = undefined;
    draw(log.sessions[date] !== undefined ? cardFocusName(date) : PAGE_HEADING_FOCUS_NAME);
  }

  /** Name for the focus target of a session card's heading. */
  function cardFocusName(date: string): string {
    return `card|${date}`;
  }

  /** Name for the focus target of one set's row. */
  function setFocusName(date: string, set: LoggedSet): string {
    return `set|${date}|${set.blockPosition}|${set.exerciseId}|${set.setNumber}`;
  }

  /**
   * Rebuilds the whole screen from the state above, then moves focus to the
   * element registered as `focusName` (see the diagram at the top), if any.
   */
  function draw(focusName?: string): void {
    focusTargets = new Map();
    const dates = sessionDates(log);
    const pageHeading = element("h1", "screen-title", "History");
    pageHeading.tabIndex = -1;
    focusTargets.set(PAGE_HEADING_FOCUS_NAME, pageHeading);
    const children: HTMLElement[] = [pageHeading];

    // Progress charts come first; they are rebuilt with the log on every redraw.
    if (dates.length > 0) children.push(renderProgressSection(program, log));

    if (message !== undefined) {
      const alert = element("p", "field-error", message);
      alert.setAttribute("role", "alert");
      children.push(alert);
    }

    if (dates.length === 0) {
      children.push(element("p", "history-empty", EMPTY_HISTORY_MESSAGE));
    }

    for (const date of dates) {
      const session = log.sessions[date];
      if (session !== undefined) children.push(renderSessionCard(session));
    }

    screen.replaceChildren(...children);
    if (focusName !== undefined) focusTargets.get(focusName)?.focus();
  }

  /** One card: the header line (focusable by script, for after a delete), then a row per exercise in block order. */
  function renderSessionCard(session: LoggedSession): HTMLElement {
    const card = element("section", "card history-session");
    const header = element("h2", "history-session-header", formatSessionHeader(session, program));
    header.tabIndex = -1;
    focusTargets.set(cardFocusName(session.date), header);
    card.append(header);

    for (const group of groupSetsByExercise(session)) {
      card.append(renderExerciseRow(session, group));
    }
    return card;
  }

  /** An exercise's summary row (a button that expands it), followed by its sets when expanded. */
  function renderExerciseRow(session: LoggedSession, group: ExerciseGroup): HTMLElement {
    const wrapper = element("div", "history-exercise");
    const isExpanded = expandedGroups.has(groupKey(session.date, group));
    const name = exerciseDisplayName(program, group.exerciseId);
    const noun = loggedSetNoun(program, session, group.blockPosition, group.exerciseId);
    const summary = formatSetsSummary(group.sets, noun);

    const row = element("button", "history-exercise-row");
    row.type = "button";
    row.setAttribute("aria-expanded", String(isExpanded));
    row.setAttribute("aria-label", `${name}, ${summary}`);

    const text = element("span", "history-exercise-text");
    text.append(element("span", "history-exercise-name", name), element("span", "history-exercise-summary", summary));

    // Notes are shown muted under the summary, one line per set that has one.
    for (const set of group.sets) {
      if (set.note) text.append(element("span", "history-exercise-note", set.note));
    }

    row.append(text, element("span", "history-chevron", isExpanded ? "▾" : "▸"));
    const rowFocusName = `exercise|${groupKey(session.date, group)}`;
    focusTargets.set(rowFocusName, row);
    row.addEventListener("click", () => {
      const key = groupKey(session.date, group);
      if (expandedGroups.has(key)) expandedGroups.delete(key);
      else expandedGroups.add(key);
      draw(rowFocusName);
    });
    wrapper.append(row);

    if (isExpanded) {
      const label = loggedSetLabel(program, session, group.blockPosition, group.exerciseId);
      for (const set of group.sets) {
        wrapper.append(isEditing(session.date, set) ? renderEditPanel(session, set, label) : renderSetRow(session.date, set, label));
      }
    }
    return wrapper;
  }

  /** One expanded set, e.g. "Set 1 · 6 reps · 6 kg"; tapping opens its edit panel. */
  function renderSetRow(date: string, set: LoggedSet, label: string): HTMLElement {
    const text = `${label} ${set.setNumber} · ${formatLoggedSet(set)}`;

    const row = element("button", "history-set-row", text);
    row.type = "button";
    row.setAttribute("aria-label", `${text}, tap to edit`);
    focusTargets.set(setFocusName(date, set), row);
    row.addEventListener("click", () => {
      editing = { date, key: keyOf(set) };
      message = undefined;
      draw(EDITOR_FOCUS_NAME);
    });
    return row;
  }

  /** The shared edit panel for `set`; steppers appear for sets whose program item counts reps (see `loggedSetShowsRepsAndLoad`). */
  function renderEditPanel(session: LoggedSession, set: LoggedSet, label: string): HTMLElement {
    const date = session.date;
    const showsRepsAndLoad = loggedSetShowsRepsAndLoad(program, session, set);

    const panel = renderSetEditor(
      `${label} ${set.setNumber}`,
      { reps: set.reps, loadKg: set.loadKg ?? 0, note: set.note ?? "" },
      showsRepsAndLoad,
      {
        onSave: (values) => handleSave(date, set, values),
        onCancel: () => {
          editing = undefined;
          draw(setFocusName(date, set));
        },
        onDelete: () => handleDelete(date, set),
      },
    );

    // The panel's first control: the reps stepper's − button, or the note field when there are no steppers.
    const firstControl = panel.querySelector<HTMLElement>(".log-stepper-button, .log-note-input");
    if (firstControl !== null) focusTargets.set(EDITOR_FOCUS_NAME, firstControl);
    return panel;
  }

  draw();
  return screen;
}

/** The identity of a logged set, as `editSet` / `deleteSet` take it. */
function keyOf(set: LoggedSet): SetKey {
  return { exerciseId: set.exerciseId, blockPosition: set.blockPosition, setNumber: set.setNumber };
}

/** True when `key` names `set`. */
function isKeyOfSet(key: SetKey, set: LoggedSet): boolean {
  return key.exerciseId === set.exerciseId && key.blockPosition === set.blockPosition && key.setNumber === set.setNumber;
}
