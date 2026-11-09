import type { Program } from "../program/model";
import { formatLoggedSet } from "../log/itemSets";
import { groupSetsByExercise, type ExerciseGroup } from "../log/history";
import type { LoggedSession, LoggedSet, WorkoutLog } from "../log/model";
import { deleteSet, editSet, sessionDates, type SetKey } from "../log/operations";
import { element } from "./dom";
import { formatSetsSummary } from "./format";
import { exerciseDisplayName, formatSessionHeader, loggedSetLabel, loggedSetNoun } from "./historyText";
import { renderSetEditor, type SetEditorValues } from "./setEditor";

/**
 * The History screen at `#/history`: one card per logged session, newest
 * first. Each card lists its exercises in block order with a compact summary;
 * tapping an exercise expands its sets, and tapping a set opens the shared
 * edit panel (reps, kg, note, Save, Delete).
 *
 *   renderHistoryScreen(program, log, onLogChanged)
 *     state: log (own copy) · expandedGroups · editingSet · message
 *     draw() ─▶ for each date (newest first) ─▶ session card
 *                 header "9 Nov · Week 2 · Day 1 · Upper: pull"
 *                 exercise row ──tap──▶ expands ─▶ "Set 1 · 6 reps · 6 kg" rows
 *                                                    └─tap─▶ edit panel
 *     Save ─▶ editSet ─┐
 *     Delete ─▶ deleteSet ─┴▶ onLogChanged(log) saves (app.ts) ─▶ draw()
 *
 * Deleting the last set of a session removes the session (`deleteSet`), so its
 * card disappears. As on the log screen, a failed save keeps the change in
 * memory and shows an inline message.
 */

/** Shown on an empty History. */
export const EMPTY_HISTORY_MESSAGE = "Nothing logged yet. Tap an exercise on Today to log it.";

/**
 * Builds the History screen. `initialLog` is app.ts's current log;
 * `onLogChanged(newLog)` must keep the new log in app state and returns null
 * when it was saved, or a message to show inline when saving failed.
 */
export function renderHistoryScreen(
  program: Program,
  initialLog: WorkoutLog,
  onLogChanged: (newLog: WorkoutLog) => string | null,
): HTMLElement {
  const screen = element("section", "screen history-screen");

  let log = initialLog;
  /** Keys (see `groupKey`) of the exercise rows currently expanded. */
  const expandedGroups = new Set<string>();
  /** The one set being edited: its session date and key. */
  let editing: { date: string; key: SetKey } | undefined;
  let message: string | undefined;

  /** Stable id of an exercise row within the screen, for the expanded state. */
  function groupKey(date: string, group: ExerciseGroup): string {
    return `${date}|${group.blockPosition}|${group.exerciseId}`;
  }

  /** True when `set` of the session on `date` is the one being edited. */
  function isEditing(date: string, set: LoggedSet): boolean {
    return editing !== undefined && editing.date === date && isKeyOfSet(editing.key, set);
  }

  /** Keeps `newLog` in memory, hands it to app.ts to save, and remembers any failure message. */
  function commit(newLog: WorkoutLog): void {
    log = newLog;
    message = onLogChanged(newLog) ?? undefined;
  }

  /** Save tapped in the edit panel: stores the edited reps, load and note, then closes the panel. */
  function handleSave(date: string, set: LoggedSet, values: SetEditorValues): void {
    const note = values.note.trim();
    // A key with value undefined clears that field in the stored set.
    commit(editSet(log, date, keyOf(set), {
      reps: values.reps,
      loadKg: values.loadKg > 0 ? values.loadKg : undefined,
      note: note === "" ? undefined : note,
    }));
    editing = undefined;
    draw();
  }

  /** Delete tapped in the edit panel. The session card goes with its last set. */
  function handleDelete(date: string, set: LoggedSet): void {
    commit(deleteSet(log, date, keyOf(set)));
    editing = undefined;
    draw();
  }

  /** Rebuilds the whole screen from the state above. */
  function draw(): void {
    const dates = sessionDates(log);
    const children: HTMLElement[] = [element("h1", "screen-title", "History")];

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
  }

  /** One card: the header line, then a row per exercise in block order. */
  function renderSessionCard(session: LoggedSession): HTMLElement {
    const card = element("section", "card history-session");
    card.append(element("h2", "history-session-header", formatSessionHeader(session, program)));

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
    row.addEventListener("click", () => {
      const key = groupKey(session.date, group);
      if (expandedGroups.has(key)) expandedGroups.delete(key);
      else expandedGroups.add(key);
      draw();
    });
    wrapper.append(row);

    if (isExpanded) {
      const label = loggedSetLabel(program, session, group.blockPosition, group.exerciseId);
      for (const set of group.sets) {
        wrapper.append(isEditing(session.date, set) ? renderEditPanel(session.date, set, label) : renderSetRow(session.date, set, label));
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
    row.addEventListener("click", () => {
      editing = { date, key: keyOf(set) };
      message = undefined;
      draw();
    });
    return row;
  }

  /** The shared edit panel for `set`; steppers appear only for sets that carry reps or a load. */
  function renderEditPanel(date: string, set: LoggedSet, label: string): HTMLElement {
    const showsRepsAndLoad = set.reps !== undefined || set.loadKg !== undefined;

    return renderSetEditor(
      `${label} ${set.setNumber}`,
      { reps: set.reps, loadKg: set.loadKg ?? 0, note: set.note ?? "" },
      showsRepsAndLoad,
      {
        onSave: (values) => handleSave(date, set, values),
        onCancel: () => {
          editing = undefined;
          draw();
        },
        onDelete: () => handleDelete(date, set),
      },
    );
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
