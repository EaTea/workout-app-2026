import { buildSession, type BlockView, type ItemView } from "../program/schedule";
import type { Program } from "../program/model";
import type { TrainingSettings } from "../settings/model";
import { countSetsForItem, formatLoggedSet, itemTracksReps, nextSetNumber, prefillForSet, setNeedsMax, setWord } from "../log/itemSets";
import { findLastTime } from "../log/lastTime";
import type { LoggedSet, WorkoutLog } from "../log/model";
import { deleteSet, editSet, logSet, setsForItem } from "../log/operations";
import { formatClock } from "../timer/engine";
import { element } from "./dom";
import { openExerciseSheet } from "./exerciseSheet";
import { blockLabel, formatPrescriptionSummary, formatRepTarget } from "./format";
import { lastTimeHint } from "./lastTimeHint";
import { renderActionButton, renderNoteInput, renderStepper, KILOGRAM_STEP, MINIMUM_REPS } from "./setEditor";
import { restMemoryKey } from "./restMemory";
import { currentRestSeconds, openRestTimer } from "./restTimer";

/**
 * The log screen for one item (mockup 2), at `#/log/<blockPosition>/<exerciseId>`.
 * Opened from an item row on Today; "‹" goes back to Today.
 *
 *   Today row tap ──▶ #/log/2/med_ball_slam ──▶ renderLogScreen
 *
 *   state: log (this screen's copy) · currentSetNumber · draft {reps, kg, note}
 *
 *   draw() ─▶ header (‹ back, title, ⓘ details sheet)
 *          ─▶ set list:  logged rows ✓ (tap = edit)
 *                        current set expanded: reps/kg steppers, + Add note
 *                        later sets (tap = jump to it)
 *          ─▶ sticky actions: [Skip] [✓ Log set · rest 0:30]   (or Save/Delete when editing)
 *
 *   ✓ Log set ─▶ logSet(log) ─▶ onLogChanged(log) saves it ─▶ next set becomes current
 *                                   │ save failed: inline error, change kept in memory
 *                                   └─ item has a rest (not a superset or interval, and a
 *                                      set is still to come) ─▶ openRestTimer
 *   Skip ─▶ next unlogged set becomes current (nothing logged)
 *   Log all as planned ─▶ every unlogged set logged with its own pre-fill, one save
 *   tap logged set ─▶ edit mode ─▶ Save changes (editSet) / Delete set (deleteSet)
 *
 * Reps and kg are shown only for items that count reps. Heavy-bag rounds and
 * timed holds are just ticked. A kg of 0 means "no load": it is stored as no
 * load at all (bodyweight), never as 0 kg. Reps and kg start from the item's
 * previous set this session, else last time's same set, else the plan (see
 * `choosePrefill`). A "Last time (2 Nov): 6 × 6 at 6 kg" line sits under the set
 * list (not on warm-ups).
 *
 * The screen keeps its own copy of the log and tells app.ts about every change
 * through `onLogChanged`, so Today (re-rendered from app.ts's copy) is current
 * when Ed goes back.
 */

/** Inline message when a log change cannot be written to this device. */
export const LOG_SAVE_FAILED_MESSAGE = "Couldn't save on this device. This set is kept until you reload.";

/** Shown when a set that needs a rep count (max-based, no saved max) has none. */
export const REPS_REQUIRED_MESSAGE = "Enter the reps you did. (The target needs your max: set it in Settings.)";

/** The reps, load and note in the steppers before the set is logged. */
interface SetDraft {
  /** Undefined until entered, for sets whose reps the plan can't give. */
  reps?: number;
  /** 0 means no load (bodyweight). */
  loadKg: number;
  note: string;
}

/**
 * Builds the log screen for the item at `blockPosition` / `exerciseId` of
 * the session on `date`. `initialLog` is app.ts's current log;
 * `onLogChanged(newLog)` is called after every change, must keep the new log
 * in app state and returns null when it was saved or a message to show inline
 * when saving failed. Unknown block/exercise, or a day with no training,
 * gives a "Nothing to log here" card.
 */
export function renderLogScreen(
  program: Program,
  settings: TrainingSettings,
  date: string,
  blockPosition: number,
  exerciseId: string,
  initialLog: WorkoutLog,
  onLogChanged: (newLog: WorkoutLog) => string | null,
): HTMLElement {
  const screen = element("section", "screen log-screen");
  const session = buildSession(program, settings, date);

  const block = session.kind === "training" ? session.blocks[blockPosition - 1] : undefined;
  const item = block?.items.find((candidate) => candidate.exercise.id === exerciseId);

  if (session.kind !== "training" || block === undefined || item === undefined) {
    screen.append(renderNothingToLogCard());
    return screen;
  }

  // Re-bound as plainly typed constants: the guard above narrows them, but not inside the
  // function declarations below.
  const trackedItem: ItemView = item;
  const trackedBlock: BlockView = block;
  const week = session.week;

  const sessionContext = { programWeek: week, day: session.dayNumber };
  const totalSets = countSetsForItem(trackedItem, trackedBlock);
  const tracksReps = itemTracksReps(trackedItem);
  const word = setWord(trackedItem);
  const restMemory = restMemoryKey(date, blockPosition, trackedItem.exercise.id);

  // A rest button only makes sense for straight/EMOM items with a prescribed rest. Heavy-bag
  // intervals have their own timer, and superset blocks rest between pairs (a block button on Today).
  const restRange = trackedItem.format !== "interval" && trackedBlock.format !== "superset" ? trackedItem.restSec : undefined;

  // Last time is looked up once: it only reads dates before this one, which edits here never touch.
  const lastTime = findLastTime(initialLog, trackedItem.exercise.id, date);
  const lastTimeText = lastTimeHint(initialLog, trackedItem, trackedBlock, date);

  let log = initialLog;
  let currentSetNumber: number | undefined;
  let draft: SetDraft = { loadKg: 0, note: "" };
  let isNoteOpen = false;
  let message: string | undefined;

  /** Sets of this item logged so far, in set order. */
  function loggedSets(): LoggedSet[] {
    return setsForItem(log, date, blockPosition, trackedItem.exercise.id);
  }

  /** The 1-based numbers of the sets already logged. */
  function loggedNumbers(): number[] {
    return loggedSets().map((set) => set.setNumber);
  }

  /** The first set not yet logged, or undefined when every set is done. */
  function firstUnloggedSetNumber(): number | undefined {
    const logged = loggedNumbers();
    for (let setNumber = 1; setNumber <= totalSets; setNumber++) {
      if (!logged.includes(setNumber)) return setNumber;
    }
    return undefined;
  }

  /**
   * The values the steppers start at for an unlogged set: the item's earlier
   * set this session, else last time's, else the plan (`prefillForSet`, rule 8).
   */
  function prefillFor(setNumber: number): { reps?: number; loadKg: number } {
    return prefillForSet(trackedItem, setNumber, loggedSets(), lastTime);
  }

  /** Makes `setNumber` the expanded set and loads its draft (a logged set loads its own values to edit). */
  function focusSet(setNumber: number | undefined): void {
    currentSetNumber = setNumber;
    isNoteOpen = false;
    if (setNumber === undefined) return;

    const existing = loggedSets().find((set) => set.setNumber === setNumber);
    if (existing !== undefined) {
      draft = { reps: existing.reps, loadKg: existing.loadKg ?? 0, note: existing.note ?? "" };
      isNoteOpen = draft.note !== "";
    } else {
      draft = { ...prefillFor(setNumber), note: "" };
    }
  }

  /** Builds a `LoggedSet` for `setNumber` from reps/kg/note values; zero kg and an empty note are left out. */
  function buildLoggedSet(setNumber: number, values: SetDraft): LoggedSet {
    const set: LoggedSet = { exerciseId: trackedItem.exercise.id, blockPosition, setNumber, loggedAt: new Date() };
    if (tracksReps && values.reps !== undefined) set.reps = values.reps;
    if (tracksReps && values.loadKg > 0) set.loadKg = values.loadKg;
    const note = values.note.trim();
    if (note !== "") set.note = note;
    return set;
  }

  /** Keeps `newLog` in memory, hands it to app.ts to save, and remembers any failure message for display. */
  function commit(newLog: WorkoutLog): void {
    log = newLog;
    message = onLogChanged(newLog) ?? undefined;
  }

  /** "✓ Log set" tapped: logs the current set, moves on, and starts the rest if the item has one. */
  function handleLogSet(): void {
    if (currentSetNumber === undefined) return;
    if (tracksReps && draft.reps === undefined && setNeedsMax(trackedItem, currentSetNumber)) {
      message = REPS_REQUIRED_MESSAGE;
      draw();
      return;
    }

    const loggedNumber = currentSetNumber;
    commit(logSet(log, date, buildLoggedSet(loggedNumber, draft), sessionContext));

    const upNext = nextSetNumber(loggedNumber, totalSets, loggedNumbers());
    focusSet(upNext);
    draw();

    if (restRange !== undefined && upNext !== undefined) {
      openRestTimer(restRange, trackedItem.exercise.name, restMemory, draw);
    }
  }

  /** "Skip" tapped: moves to the next unlogged set without logging anything. */
  function handleSkip(): void {
    if (currentSetNumber === undefined) return;
    focusSet(nextSetNumber(currentSetNumber, totalSets, loggedNumbers()));
    message = undefined;
    draw();
  }

  /**
   * "Log all as planned": logs every unlogged set with its own pre-fill (each
   * set follows the one before it, like tapping Log set repeatedly) in one
   * save. Refuses, with a message, if a set needs a max the app doesn't have.
   */
  function handleLogAll(): void {
    const remaining: number[] = [];
    for (let setNumber = 1; setNumber <= totalSets; setNumber++) {
      if (!loggedNumbers().includes(setNumber)) remaining.push(setNumber);
    }

    if (tracksReps && remaining.some((setNumber) => setNeedsMax(trackedItem, setNumber))) {
      message = REPS_REQUIRED_MESSAGE;
      draw();
      return;
    }

    let updatedLog = log;
    for (const setNumber of remaining) {
      const prefill = prefillForSet(trackedItem, setNumber, setsForItem(updatedLog, date, blockPosition, trackedItem.exercise.id), lastTime);
      updatedLog = logSet(updatedLog, date, buildLoggedSet(setNumber, { ...prefill, note: "" }), sessionContext);
    }

    commit(updatedLog);
    focusSet(firstUnloggedSetNumber());
    draw();
  }

  /** "Save changes" tapped while editing a logged set. */
  function handleSaveEdit(): void {
    if (currentSetNumber === undefined) return;
    if (tracksReps && draft.reps === undefined && setNeedsMax(trackedItem, currentSetNumber)) {
      message = REPS_REQUIRED_MESSAGE;
      draw();
      return;
    }

    const changed = buildLoggedSet(currentSetNumber, draft);
    const key = { exerciseId: changed.exerciseId, blockPosition, setNumber: changed.setNumber };
    // A key with value undefined clears that field in the stored set.
    commit(editSet(log, date, key, { reps: changed.reps, loadKg: changed.loadKg, note: changed.note }));
    focusSet(firstUnloggedSetNumber());
    draw();
  }

  /** "Delete set" tapped while editing a logged set. */
  function handleDelete(): void {
    if (currentSetNumber === undefined) return;
    commit(deleteSet(log, date, { exerciseId: trackedItem.exercise.id, blockPosition, setNumber: currentSetNumber }));
    focusSet(firstUnloggedSetNumber());
    draw();
  }

  /** Rebuilds the whole screen from the state above. Called after every state change. */
  function draw(): void {
    const logged = loggedSets();
    const isEditing = currentSetNumber !== undefined && logged.some((set) => set.setNumber === currentSetNumber);
    const unloggedCount = totalSets - logged.length;

    const children: HTMLElement[] = [
      renderHeader(),
      element("p", "log-subtitle", formatPrescriptionSummary(trackedItem)),
      renderSetList(),
    ];

    if (lastTimeText !== undefined) {
      children.push(element("p", "log-last-time", lastTimeText));
    }

    if (message !== undefined) {
      const alert = element("p", "field-error", message);
      alert.setAttribute("role", "alert");
      children.push(alert);
    }

    if (currentSetNumber === undefined) {
      children.push(element("p", "log-done", unloggedCount === 0 ? "All sets logged." : "No set selected. Tap a set above."));
    } else {
      children.push(renderActions(isEditing, unloggedCount));
    }

    screen.replaceChildren(...children);
  }

  /** Title row: back link, kicker + exercise name, and the ⓘ button that opens the details sheet. */
  function renderHeader(): HTMLElement {
    const header = element("header", "log-header");

    const back = element("a", "log-back", "‹");
    back.href = "#/today";
    back.setAttribute("aria-label", "Back to Today");

    const heading = element("div", "log-heading");
    heading.append(
      element("div", "kicker", `${blockLabel(trackedBlock.type)} · Week ${week}`),
      element("h1", "log-title", trackedItem.exercise.name),
    );

    const infoButton = element("button", "log-info", "ⓘ");
    infoButton.type = "button";
    infoButton.setAttribute("aria-label", "Exercise details");
    infoButton.addEventListener("click", () => openExerciseSheet(trackedItem, infoButton));

    header.append(back, heading, infoButton);
    return header;
  }

  /** The card listing every set: logged ticks, the expanded current set, and the sets still to do. */
  function renderSetList(): HTMLElement {
    const card = element("div", "card log-sets");
    const logged = loggedSets();

    for (let setNumber = 1; setNumber <= totalSets; setNumber++) {
      const loggedSet = logged.find((set) => set.setNumber === setNumber);

      if (setNumber === currentSetNumber) {
        card.append(renderCurrentSet(setNumber, loggedSet !== undefined));
      } else {
        card.append(renderCollapsedSet(setNumber, loggedSet));
      }
    }
    return card;
  }

  /** One collapsed row: logged (tick plus values) or still to do (empty circle plus plan). Tapping focuses it. */
  function renderCollapsedSet(setNumber: number, loggedSet: LoggedSet | undefined): HTMLElement {
    const row = element("button", loggedSet ? "log-set-row log-set-logged" : "log-set-row");
    row.type = "button";

    const circle = element("span", loggedSet ? "log-check log-check-done" : "log-check", loggedSet ? "✓" : "");
    circle.setAttribute("aria-hidden", "true");

    const details = element("span", "log-set-details");
    details.append(element("span", "log-set-values", loggedSet ? formatLoggedSet(loggedSet) : plannedText(setNumber)));
    if (loggedSet?.note) {
      details.append(element("span", "log-set-note", loggedSet.note));
    }

    row.append(element("span", "log-set-label", `${word} ${setNumber}`), circle, details);
    row.setAttribute("aria-label", loggedSet
      ? `${word} ${setNumber}, ${formatLoggedSet(loggedSet)}, tap to edit`
      : `${word} ${setNumber}, not done, tap to log`);

    row.addEventListener("click", () => {
      message = undefined;
      focusSet(setNumber);
      draw();
    });
    return row;
  }

  /** What the plan asks for in an unlogged set, e.g. "6 reps" or "12–15 reps"; blank for ticked-only items. */
  function plannedText(setNumber: number): string {
    if (!tracksReps) return "";

    const target = trackedItem.sets[setNumber - 1]?.target ?? trackedItem.target;
    if (target === undefined) return "";
    if (target.kind === "needsMax") return "needs your max";
    if (target.kind === "text") return target.text;
    return `${formatRepTarget(target)} reps`;
  }

  /** The expanded set: reps and kg steppers (rep items only) and the optional note. */
  function renderCurrentSet(setNumber: number, isLogged: boolean): HTMLElement {
    const panel = element("div", "log-set-current");
    panel.append(element("div", "log-set-label log-set-label-current", `${word} ${setNumber}`));

    if (tracksReps) {
      panel.append(
        renderStepper("reps", "reps", () => draft.reps, (value) => { draft.reps = value; }, MINIMUM_REPS, 1, false),
        renderStepper("kg", "kg", () => (draft.loadKg > 0 ? draft.loadKg : undefined), (value) => { draft.loadKg = value ?? 0; }, 0, KILOGRAM_STEP, true),
      );
    } else if (!isLogged) {
      panel.append(element("p", "log-set-hint", "Tick it when done."));
    }

    panel.append(renderNoteField());
    return panel;
  }

  /** "+ Add note" button that turns into a text field when tapped (or is already one when the set has a note). */
  function renderNoteField(): HTMLElement {
    if (!isNoteOpen) {
      const addNote = element("button", "log-add-note", "+ Add note");
      addNote.type = "button";
      addNote.addEventListener("click", () => {
        isNoteOpen = true;
        draw();
        screen.querySelector<HTMLInputElement>(".log-note-input")?.focus();
      });
      return addNote;
    }

    return renderNoteInput(draft.note, (value) => { draft.note = value; });
  }

  /** The sticky button bar: Skip + Log set normally, Cancel/Delete/Save while editing; plus "Log all as planned". */
  function renderActions(isEditing: boolean, unloggedCount: number): HTMLElement {
    const bar = element("div", "log-actions");

    if (isEditing) {
      const save = renderActionButton("log-primary", "✓ Save changes", handleSaveEdit);
      const cancel = renderActionButton("log-secondary", "Cancel", () => {
        message = undefined;
        focusSet(firstUnloggedSetNumber());
        draw();
      });
      const remove = renderActionButton("log-secondary log-danger", "Delete set", handleDelete);
      bar.append(save, cancel, remove);
      return bar;
    }

    if (unloggedCount >= 2) {
      bar.append(renderActionButton("log-all", "Log all as planned", handleLogAll));
    }

    const skip = renderActionButton("log-secondary", "Skip", handleSkip);
    skip.disabled = currentSetNumber === undefined || nextSetNumber(currentSetNumber, totalSets, loggedNumbers()) === undefined;

    // Label shows the rest only when logging will actually start it (a set is still to come).
    const startsRest = restRange !== undefined && nextSetNumber(currentSetNumber ?? 0, totalSets, loggedNumbers()) !== undefined;
    const logLabel = startsRest ? `✓ Log set · rest ${formatClock(currentRestSeconds(restRange, restMemory))}` : "✓ Log set";
    bar.append(skip, renderActionButton("log-primary", logLabel, handleLogSet));
    return bar;
  }

  focusSet(firstUnloggedSetNumber());
  draw();
  return screen;
}

/** Card for an unknown block/exercise or a day with nothing to train. */
function renderNothingToLogCard(): HTMLElement {
  const card = element("div", "card message-card");
  const link = element("a", "text-link", "Back to Today");
  link.href = "#/today";
  card.append(element("h2", "card-title", "Nothing to log here"), element("p", undefined, "This exercise isn't part of the session on this date."), link);
  return card;
}
