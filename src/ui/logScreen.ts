import "./rotation.css";
import { itemDisplayName } from "../program/rotation";
import type { BlockView, ItemView } from "../program/schedule";
import type { NoEquipmentTicks } from "../noEquipment/model";
import type { CombinesByDate } from "../combine/model";
import { buildSwappedSessionFor } from "../noEquipment/session";
import { todayLocalDate } from "../program/calendar";
import { blockSlotsOf } from "../program/combine";
import { activeCombineOn } from "../program/combineOffers";
import type { DayNumber, Program } from "../program/model";
import type { TrainingSettings } from "../settings/model";
import { countSetsForItem, formatLoggedSet, itemTracksReps, nextSetNumber, prefillForSet, setNeedsMax, setNounFor, setWord } from "../log/itemSets";
import type { LoggedSet, WorkoutLog } from "../log/model";
import { deleteSet, editSet, logSet, setsForItem } from "../log/operations";
import { formatClock } from "../timer/engine";
import { element } from "./dom";
import { openExerciseSheet } from "./exerciseSheet";
import { blockLabel, formatLastTime, formatPrescriptionSummary, formatRepTarget } from "./format";
import type { ChangeLog } from "./logChange";
import { lastTimeForItem } from "./lastTimeHint";
import { KILOGRAM_STEP } from "./kilograms";
import { renderActionButton, renderDeleteButton, renderNoteInput, renderStepper, MINIMUM_REPS } from "./setEditor";
import { restMemoryKey } from "./restMemory";
import { currentRestSeconds, openRestTimer } from "./restTimer";

/**
 * The log screen for one item (mockup 2), at `#/log/<date>/<blockPosition>/<exerciseId>`.
 * Opened from an item row on Today; "‹" goes back to Today. It logs to the
 * date in its address, not to "today by the clock", so a session started at
 * 23:50 keeps logging to that day after midnight.
 *
 *   Today row tap ──▶ #/log/2026-11-09/2/med_ball_slam ──▶ renderLogScreen
 *   (combined row)    #/log/2026-11-09/2/split_squat/day/2   (the block is Day 2's block 2)
 *
 * On a combined date (two days merged, PR 25) the address also names the
 * program day, because both days have a block 2. The screen finds the row by
 * (day, block position, exercise), and every set it logs there carries that
 * `day` (a normal session's sets carry none, as before).
 *
 *   state: log (this screen's copy) · currentSetNumber · draft {reps, kg, note}
 *
 *   draw() ─▶ header (‹ back, title, ⓘ details sheet)
 *          ─▶ set list:  logged rows ✓ (tap = edit)
 *                        current set expanded: reps/kg steppers, + Add note
 *                        later sets (tap = jump to it)
 *          ─▶ sticky actions: [Skip] [✓ Log set · rest 0:30]   (or Save/Delete when editing)
 *
 *   ✓ Log set ─▶ changeLog(fresh => logSet(fresh, ...)) re-reads and saves ─▶ next set becomes current
 *                                   │ save failed: inline error, change kept in memory (refused: not applied)
 *                                   └─ item has a rest (not a superset or interval, and a
 *                                      set is still to come) ─▶ openRestTimer, already running
 *   Skip ─▶ next unlogged set becomes current (nothing logged)
 *   Log all as planned ─▶ the current set with the draft's values, every other unlogged
 *                         set with its own pre-fill, one save
 *   tap logged set ─▶ edit mode ─▶ Save changes (editSet) / Delete set (deleteSet, asks for a second tap)
 *
 * Reps and kg are shown only for items that count reps. Heavy-bag rounds and
 * timed holds are just ticked. A kg of 0 means "no load": it is stored as no
 * load at all (bodyweight), never as 0 kg. Reps and kg are pre-filled by
 * `choosePrefill` (rule 8): the item's previous set this session; otherwise
 * reps from the plan's target (it already carries this week's increase) or,
 * when the plan has no number, from last time's same set; and the load from
 * last time's same set. Where the plan's target changes between sets (the calf
 * raise), the previous set is ignored and the same plan-then-last-time order
 * applies. "Last time" means the same day and block type, else the same block
 * type on any day (`findLastTime`). A "Last time (2 Nov): 6 × 6 at 6 kg" line
 * sits under the set list (not on warm-ups).
 *
 * A date after the real today (a `?date=` preview of the future) can be looked
 * at but not logged to: the Log buttons are disabled and a message says why.
 *
 * After every action the screen puts keyboard/screen-reader focus somewhere
 * sensible (`drawAndFocus`), since redrawing replaces the button that was
 * pressed: the new current set's first stepper, or the "All sets logged" message.
 *
 * The screen keeps its own copy of the log, but never saves it. Every change is
 * handed to app.ts through `changeLog` as one operation, which app.ts applies
 * to the freshly re-read stored log (so another open copy of the app is not
 * overwritten) and saves; the screen then adopts the log that comes back, and
 * Today (re-rendered from app.ts's copy) is current when Ed goes back.
 */

/** Shown when a set that needs a rep count (max-based, no saved max) has none. */
export const REPS_REQUIRED_MESSAGE = "Enter the reps you did. (The target needs your max: set it in Settings.)";

/** Shown, and the Log buttons disabled, when the screen's date is after the real today. */
export const FUTURE_DATE_MESSAGE = "This date is in the future, so nothing can be logged to it yet. Preview only.";

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
 * the session on `date` (taken from the route). `initialLog` is app.ts's
 * current log; `changeLog(operation)` applies one change to the stored log
 * (see logChange.ts) and returns the log to show plus a message to show
 * inline when saving failed or was refused. `realToday` is the real local date
 * (never a `?date=` preview); a `date` after it cannot be logged to. Unknown
 * block/exercise, or a day with no training, gives a "Nothing to log here" card.
 *
 * `day` is the program day from the route (absent in an old-form link: the
 * date's own day), and `combines` the stored combines, so the screen builds the
 * same session Today showed (`buildSwappedSessionFor`).
 */
export function renderLogScreen(
  program: Program,
  settings: TrainingSettings,
  date: string,
  blockPosition: number,
  exerciseId: string,
  initialLog: WorkoutLog,
  changeLog: ChangeLog,
  realToday: string = todayLocalDate(),
  noEquipmentTicks: NoEquipmentTicks = new Map(),
  day?: DayNumber,
  combines: CombinesByDate = new Map(),
): HTMLElement {
  const screen = element("section", "screen log-screen");
  // The swapped session, so a swapped item is found under the swap's id (the one in the address)
  // and logs, pre-fills and shows "last time" as the swap. A combined date gives the merged session.
  const { session } = buildSwappedSessionFor(program, settings, initialLog, noEquipmentTicks, combines, date);
  const combine = activeCombineOn(program, settings.startDate, date, combines);

  // Find the row by (day, block position, exercise). An old-form link has no day: the date's own day.
  // On a normal date a link naming another day matches nothing (e.g. a stale link after "Undo combine").
  const wantedDay = day ?? combine?.hostDay;
  const slot = session.kind === "training" || session.kind === "combined"
    ? blockSlotsOf(session).find((candidate) =>
        candidate.source.blockPosition === blockPosition &&
        (wantedDay === undefined || candidate.source.day === wantedDay) &&
        candidate.block.items.some((candidateItem) => candidateItem.exercise.id === exerciseId))
    : undefined;
  const block = slot?.block;
  const item = block?.items.find((candidate) => candidate.exercise.id === exerciseId);

  const hasTraining = session.kind === "training" || session.kind === "combined";
  if (!hasTraining || slot === undefined || block === undefined || item === undefined) {
    screen.append(renderNothingToLogCard());
    return screen;
  }

  // Re-bound as plainly typed constants: the guard above narrows them, but not inside the
  // function declarations below.
  const trackedItem: ItemView = item;
  const trackedBlock: BlockView = block;
  const week = session.week;
  const isFutureDate = date > realToday;

  // The program day this item's block belongs to. Used to find sets and name keys. A normal session's new
  // sets do not store it (they keep the session's day); a combined session's sets always do (`LoggedSet.day`),
  // since two days share the date.
  const dayNumber = slot.source.day;
  const isCombined = session.kind === "combined";
  const sessionContext = { programWeek: week, day: combine?.hostDay ?? dayNumber };
  const totalSets = countSetsForItem(trackedItem, trackedBlock);
  const tracksReps = itemTracksReps(trackedItem);
  const word = setWord(trackedItem);
  const restMemory = restMemoryKey(date, blockPosition, trackedItem.exercise.id, isCombined ? dayNumber : undefined);

  // A rest button only makes sense for straight/EMOM items with a prescribed rest. Heavy-bag
  // intervals have their own timer, and superset blocks rest between pairs (a block button on Today).
  const restRange = trackedItem.format !== "interval" && trackedBlock.format !== "superset" ? trackedItem.restSec : undefined;

  // Last time is looked up once: it only reads dates before this one, which edits here never touch.
  // The hint and the pre-fill share this one result, so they cannot disagree.
  const lastTime = lastTimeForItem(initialLog, program, trackedItem, trackedBlock, dayNumber, date);
  const lastTimeText = lastTime === undefined ? undefined : formatLastTime(lastTime, setNounFor(trackedItem));

  let log = initialLog;
  let currentSetNumber: number | undefined;
  let draft: SetDraft = { loadKg: 0, note: "" };
  let isNoteOpen = false;
  let message: string | undefined;

  /** Sets of this item logged so far, in set order. */
  function loggedSets(): LoggedSet[] {
    return setsForItem(log, date, blockPosition, trackedItem.exercise.id, dayNumber);
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
   * The values the steppers start at for an unlogged set (`prefillForSet`,
   * rule 8): reps from the item's earlier set this session, else the plan, else
   * last time's; load from the earlier set, else last time's.
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
    // Two days share this date in a combined session, so each set says which day's block it is in.
    if (isCombined) set.day = dayNumber;
    if (tracksReps && values.reps !== undefined) set.reps = values.reps;
    if (tracksReps && values.loadKg > 0) set.loadKg = values.loadKg;
    const note = values.note.trim();
    if (note !== "") set.note = note;
    return set;
  }

  /** Asks app.ts to apply `operation` to the stored log and save it; adopts the resulting log and remembers any failure message for display. */
  function commit(operation: (freshLog: WorkoutLog) => WorkoutLog): void {
    const outcome = changeLog(operation);
    log = outcome.log;
    message = outcome.error ?? undefined;
  }

  /** "✓ Log set" tapped: logs the current set, moves on, and starts the rest if the item has one. */
  function handleLogSet(): void {
    if (currentSetNumber === undefined || isFutureDate) return;
    if (tracksReps && draft.reps === undefined && setNeedsMax(trackedItem, currentSetNumber)) {
      message = REPS_REQUIRED_MESSAGE;
      drawAndFocus();
      return;
    }

    const loggedNumber = currentSetNumber;
    const loggedSet = buildLoggedSet(loggedNumber, draft);
    commit((freshLog) => logSet(freshLog, date, loggedSet, sessionContext));

    // A refused save leaves the set unlogged: stay on it, with the message showing, and no rest timer over it.
    if (!loggedNumbers().includes(loggedNumber)) {
      drawAndFocus();
      return;
    }

    const upNext = nextSetNumber(loggedNumber, totalSets, loggedNumbers());
    focusSet(upNext);
    drawAndFocus();

    // The rest opens already running (this tap is the user gesture that lets it make sound). When
    // it closes, the screen is redrawn (the label shows the remembered seconds) and focus goes
    // back to the current set, since the button that opened it no longer exists.
    if (restRange !== undefined && upNext !== undefined) {
      openRestTimer(restRange, itemDisplayName(trackedItem), restMemory, { startImmediately: true, onClose: drawAndFocus });
    }
  }

  /** "Skip" tapped: moves to the next unlogged set without logging anything. */
  function handleSkip(): void {
    if (currentSetNumber === undefined) return;
    focusSet(nextSetNumber(currentSetNumber, totalSets, loggedNumbers()));
    message = undefined;
    drawAndFocus();
  }

  /**
   * "Log all as planned": logs every unlogged set in one save. The current set
   * is logged with the draft's values (what the steppers and note show, so
   * edits made before tapping are kept); every other set gets its own pre-fill
   * and follows the one before it, like tapping Log set repeatedly. Refuses,
   * with a message, if a set would have no reps although it needs a max the
   * app doesn't have.
   *
   * The sets are worked out from this screen's copy of the log, then applied to
   * the freshly re-read stored log; a set another open copy of the app has
   * already logged is left alone.
   */
  function handleLogAll(): void {
    if (isFutureDate) return;

    const setsToLog: LoggedSet[] = [];
    const simulatedSets = [...loggedSets()];

    for (let setNumber = 1; setNumber <= totalSets; setNumber++) {
      if (loggedNumbers().includes(setNumber)) continue;

      const values: SetDraft = setNumber === currentSetNumber
        ? draft
        : { ...prefillForSet(trackedItem, setNumber, simulatedSets, lastTime), note: "" };

      if (tracksReps && values.reps === undefined && setNeedsMax(trackedItem, setNumber)) {
        message = REPS_REQUIRED_MESSAGE;
        drawAndFocus();
        return;
      }

      const setToLog = buildLoggedSet(setNumber, values);
      setsToLog.push(setToLog);
      simulatedSets.push(setToLog);
    }

    commit((freshLog) => {
      let updatedLog = freshLog;
      for (const setToLog of setsToLog) {
        const alreadyLogged = setsForItem(updatedLog, date, blockPosition, trackedItem.exercise.id, dayNumber).some((set) => set.setNumber === setToLog.setNumber);
        if (!alreadyLogged) updatedLog = logSet(updatedLog, date, setToLog, sessionContext);
      }
      return updatedLog;
    });
    focusSet(firstUnloggedSetNumber());
    drawAndFocus();
  }

  /** "Save changes" tapped while editing a logged set. */
  function handleSaveEdit(): void {
    if (currentSetNumber === undefined) return;
    if (tracksReps && draft.reps === undefined && setNeedsMax(trackedItem, currentSetNumber)) {
      message = REPS_REQUIRED_MESSAGE;
      drawAndFocus();
      return;
    }

    const changed = buildLoggedSet(currentSetNumber, draft);
    const key = { exerciseId: changed.exerciseId, day: dayNumber, blockPosition, setNumber: changed.setNumber };
    // A key with value undefined clears that field in the stored set.
    commit((freshLog) => editSet(freshLog, date, key, { reps: changed.reps, loadKg: changed.loadKg, note: changed.note }));
    focusSet(firstUnloggedSetNumber());
    drawAndFocus();
  }

  /** "Delete set" tapped while editing a logged set. */
  function handleDelete(): void {
    if (currentSetNumber === undefined) return;
    const key = { exerciseId: trackedItem.exercise.id, day: dayNumber, blockPosition, setNumber: currentSetNumber };
    commit((freshLog) => deleteSet(freshLog, date, key));
    focusSet(firstUnloggedSetNumber());
    drawAndFocus();
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

    if (isFutureDate) {
      const futureNote = element("p", "field-error", FUTURE_DATE_MESSAGE);
      futureNote.setAttribute("role", "status");
      children.push(futureNote);
    }

    if (message !== undefined) {
      const alert = element("p", "field-error", message);
      alert.setAttribute("role", "alert");
      children.push(alert);
    }

    if (currentSetNumber === undefined) {
      const done = element("p", "log-done", unloggedCount === 0 ? "All sets logged." : "No set selected. Tap a set above.");
      // Not a tab stop, but focusable by script so `drawAndFocus` can land here.
      done.tabIndex = -1;
      children.push(done);
    } else {
      children.push(renderActions(isEditing, unloggedCount));
    }

    screen.replaceChildren(...children);
  }

  /**
   * Redraws, then moves focus to where the athlete works next. Redrawing
   * replaces the button that was just pressed, which would drop focus to the
   * page; this puts it on the current set's first stepper (or, for a set with
   * no steppers, its main button), or on the "All sets logged" message when
   * no set is current. Used after every action instead of `draw` alone.
   */
  function drawAndFocus(): void {
    draw();

    const target = currentSetNumber === undefined
      ? screen.querySelector<HTMLElement>(".log-done")
      : screen.querySelector<HTMLElement>(".log-set-current .log-stepper-button") ?? screen.querySelector<HTMLElement>(".log-actions .log-primary");
    target?.focus();
  }

  /** Title row: back link, kicker + exercise name, and the ⓘ button that opens the details sheet. */
  function renderHeader(): HTMLElement {
    const header = element("header", "log-header");

    const back = element("a", "log-back", "‹");
    back.href = "#/today";
    back.setAttribute("aria-label", "Back to Today");

    const heading = element("div", "log-heading");
    heading.append(
      element("div", "kicker", `${blockLabel(trackedBlock.type)} · Week ${week}${isCombined ? ` · Day ${dayNumber}` : ""}`),
      element("h1", "log-title", itemDisplayName(trackedItem)),
    );
    if (trackedItem.rotatedIn !== undefined) {
      heading.append(element("p", "log-rotated-in", `Rotated in for ${trackedItem.rotatedIn.originalName}`));
    }
    if (trackedItem.swappedFrom !== undefined) {
      heading.append(element("p", "log-rotated-in", `Instead of ${trackedItem.swappedFrom.name}`));
    }

    const infoButton = element("button", "log-info", "ⓘ");
    infoButton.type = "button";
    infoButton.setAttribute("aria-label", "Exercise details");
    infoButton.addEventListener("click", () => openExerciseSheet(trackedItem, infoButton));

    // A rotated-in exercise has no library entry, so there are no details to show.
    header.append(back, heading);
    if (trackedItem.rotatedIn === undefined) header.append(infoButton);
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
      drawAndFocus();
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
        renderStepper("kg", "kg", () => (draft.loadKg > 0 ? draft.loadKg : undefined), (value) => { draft.loadKg = value ?? 0; }, 0, KILOGRAM_STEP, true, true),
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
        drawAndFocus();
      });
      const remove = renderDeleteButton(handleDelete);
      bar.append(save, cancel, remove);
      return bar;
    }

    if (unloggedCount >= 2) {
      const logAll = renderActionButton("log-all", "Log all as planned", handleLogAll);
      logAll.disabled = isFutureDate;
      bar.append(logAll);
    }

    const skip = renderActionButton("log-secondary", "Skip", handleSkip);
    skip.disabled = currentSetNumber === undefined || nextSetNumber(currentSetNumber, totalSets, loggedNumbers()) === undefined;

    // Label shows the rest only when logging will actually start it (a set is still to come).
    const startsRest = restRange !== undefined && nextSetNumber(currentSetNumber ?? 0, totalSets, loggedNumbers()) !== undefined;
    const logLabel = startsRest ? `✓ Log set · rest ${formatClock(currentRestSeconds(restRange, restMemory))}` : "✓ Log set";
    const logButton = renderActionButton("log-primary", logLabel, handleLogSet);
    logButton.disabled = isFutureDate;
    bar.append(skip, logButton);
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
