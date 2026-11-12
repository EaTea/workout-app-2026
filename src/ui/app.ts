import type { Program, ProgramWarning } from "../program/model";
import { programStatus, toDayNumber, todayLocalDate } from "../program/calendar";
import { readExportSource } from "../export/source";
import { rotationBlockStartWeek } from "../program/rotation";
import type { TrainingSettings } from "../settings/model";
import { loadSettings, saveSettings } from "../settings/storage";
import type { ProgramStorageKeys } from "../storage/programKeys";
import { retestJumpSkippedFromWire, retestJumpSkippedToWire, applyRetestMax, mergeRetestCheck, retestDismissedFromWire, retestDismissedToWire } from "./retest";
import { rotationDismissedFromWire, rotationDismissedToWire } from "./rotationCard";
import { focusRemainingRetestStepper, focusRetestJumpStepper } from "./retestCard";
import { element } from "./dom";
import { navigateTo, parseLogRoute, parsePlanRoute, routeFromHash, type Route } from "./router";
import { applyLogChange, loadLog, type LoadLogResult } from "../log/storage";
import type { WorkoutLog } from "../log/model";
import type { LogChangeOutcome } from "./logChange";
import { renderLogScreen } from "./logScreen";
import { renderHistoryScreen } from "./history";
import { isSessionInProgress } from "../log/sessionProgress";
import { buildSession, phaseForWeek, retestWeekStartDate } from "../program/schedule";
import { createScreenWakeLock } from "../timer/wakeLock";
import { renderNewDayBanner } from "./newDayBanner";
import { renderPreviewStrip } from "./previewStrip";
import { buildProgramOverview } from "../program/overview";
import { renderOverviewScreen } from "./overview";
import { renderDayPlanScreen } from "./dayPlan";
import { buildDayPlan } from "../program/dayPlan";
import { renderSettingsScreen } from "./settings";
import { buildProgramPicker, programNamesById } from "../program/picker";
import type { LoadedCatalogueEntry } from "../program/load";
import { chooseProgramAndReload, renderProgramPickerScreen, renderSwitchProgramLink } from "./programPicker";
import { renderTodayScreen } from "./today";
import { loadTicks, setTick } from "../noEquipment/storage";
import { buildSwappedSessionFor } from "../noEquipment/session";
import type { Combine, CombinesByDate } from "../combine/model";
import { activeCombineOn } from "../program/combineOffers";
import { addCombine, loadCombines, removeCombine } from "../combine/storage";
import type { NoEquipmentTicks } from "../noEquipment/model";
import { applyFatigueChange, loadFatigueHistory, type LoadFatigueHistoryResult } from "../fatigue/storage";
import { checkForWeek, recordCheck, weeklyChecksFor } from "../fatigue/operations";
import type { FatigueCheck } from "../fatigue/model";
import {
  checkInSnoozedFromWire,
  checkInSnoozedToWire,
  checkInWeekToAsk,
  PREVIEW_SAVING_OFF_MESSAGE,
  createCheckInDraft,
  dropWarningForShownDate,
  fatigueWarningDismissedFromWire,
  fatigueWarningDismissedToWire,
  type CheckInDraft,
} from "./checkin";
import { renderDropBanner } from "./checkinCard";
import { focusMainHeading, renderWarningBanner } from "./warningBanner";

/**
 * App shell: owns the in-memory settings and workout log, picks the screen
 * for the current hash route, and draws the bottom navigation bar.
 *
 *   main.ts ──startApp──▶ render() ◀── hashchange
 *                           ├─ <main> Today | Overview | Log screen | History | Settings screen
 *                           └─ <nav>  Today | History | Settings
 *
 * First run: with no start date, the Today route (the default) draws the
 * Overview instead (the hash is left alone). Its "Start Day 1" button calls
 * `handleStartToday`, which saves the start date and moves to Today. The
 * Overview is also reachable at `#/overview` (links on Today and Settings); it
 * has no tab of its own, so Today stays highlighted in the nav for it.
 *
 * The Overview's training-day rows link to the read-only Day plan at
 * `#/plan/<day>/<week>` (dayPlan.ts), which also keeps Today highlighted and
 * shows the preview strip and warnings banner. A plan address outside the
 * program (week 9, day 8) draws the Overview instead.
 *
 * Optional `?date=YYYY-MM-DD` in the page URL overrides "today" (used by E2E
 * tests, and by Ed to preview another day). The preview affects Today, the
 * Day plan's current week and the Overview's "Start Day 1" only; max save dates always use the real local date. While
 * one is in the address, Today, the Overview and the log screen show a "Previewing 16 Nov ·
 * back to today" strip, and the log screen refuses to log to a date after the
 * real today (past dates can be backfilled).
 *
 * The shown date (pinned session): `startApp` keeps ONE "shown date", set from
 * `resolveToday` at startup. Today renders for it, and every log screen
 * address carries its own date (`#/log/<date>/<block>/<exercise>`), so what is
 * logged always goes to the session Ed is looking at. The shown date only
 * moves forward when the new-day banner's button is tapped (or the page is
 * reloaded); navigating Today -> History -> Today keeps it.
 *
 * Midnight rollover: if the app stays open past local midnight it does NOT
 * swap the session by itself (that could replace the workout under someone
 * training at 23:30 and lose scroll/focus, or send sets to the wrong day).
 * Instead a "It's a new day" banner is inserted at the top of Today's <main>,
 * and it stays (also after leaving and coming back to Today) until its
 * button is tapped, which moves the shown date to the real date.
 *
 *   every 60s / page visible ─▶ handleClockCheck ─┬─▶ updateSessionWakeLock  (idle timeout, midnight)
 *                                                 └─▶ shouldShowNewDayBanner? ─▶ main.prepend(banner)
 *   every render of Today ────▶ same banner check (a re-render must not lose the banner)
 *   banner button ─▶ shownDate = resolveToday ─▶ render()  (banner disappears)
 *
 * While a timer overlay or exercise sheet is open the banner may still be
 * added: both mark `#app > main` inert, and inert applies to the whole
 * subtree, so a child inserted later is inert too (no focus, no taps) until
 * the overlay closes and removes inert from <main>. Nothing is replaced.
 *
 * Log changes: screens never save a log they built themselves. They call
 * `changeLog(operation)`, which re-reads storage, applies the one operation to
 * that fresh log, saves, and keeps the result as the app's copy (log/storage.ts
 * `applyLogChange`). If the stored log cannot be read safely, nothing is saved
 * and the screen shows why.
 *
 * Weekly check-in (PLAN.md rule 6): the app also owns the saved fatigue checks
 * (loaded at startup like the log, saved only through `applyFatigueChange`,
 * which re-reads storage first). Today shows the check-in card while
 * `checkInWeekToAsk` says one is due for the shown date, and an amber drop
 * banner for the rest of a week whose check has a drop over 10%; dismissals
 * and snoozes are remembered in their own small localStorage keys.
 *
 * Screen stays awake while a session is in progress (PLAN.md rule 8): one
 * app-level ScreenWakeLock is wanted when the route is Today or the log
 * screen AND the session of the date on screen is in progress AND that date is
 * still the real current date (`resolveToday`). "In progress" (see
 * `isSessionInProgress`) ends when every set is logged or 45 minutes pass with
 * nothing logged, so the lock is re-evaluated after every render, every log
 * change and on the minute check; a session left open past midnight loses the
 * lock at the next check, because its date is no longer today's.
 * The timer overlay keeps its own lock (timerView.ts) while open; the two
 * coexist as separate sentinels, so closing the overlay never drops the
 * session lock and vice versa.
 */

/** How often a left-open app re-checks the local date and the session idle timeout. */
const DATE_CHECK_INTERVAL_MS = 60_000;

/** How long the "Saved" confirmation stays on screen. */
const SAVED_TOAST_MILLISECONDS = 2500;

/**
 * Returns the calendar date the app treats as today: the valid `?date=` value
 * from `search` (a `location.search` string) if present, else the local date.
 */
export function resolveToday(search: string, now: Date = new Date()): string {
  const override = new URLSearchParams(search).get("date");
  if (override !== null) {
    try {
      toDayNumber(override);
      return override;
    } catch {
      // Invalid override: ignore it and use the real date.
    }
  }
  return todayLocalDate(now);
}

/**
 * The `?date=` preview date in `search` (a `location.search` string), or
 * undefined when there is none or it is not a valid date. Decides whether
 * the "Previewing" strip is shown (`render` in `startApp`).
 */
export function previewDateFromSearch(search: string): string | undefined {
  const override = new URLSearchParams(search).get("date");
  if (override === null) return undefined;

  try {
    toDayNumber(override);
    return override;
  } catch {
    return undefined;
  }
}

/**
 * True when the date the app would show now differs from `shownDate`, the
 * date Today is showing. A valid `?date=` in `search` pins the
 * date, so a preview never counts as changed. Used by the midnight check in `startApp`.
 */
export function hasTodayChanged(shownDate: string, search: string, now: Date = new Date()): boolean {
  return resolveToday(search, now) !== shownDate;
}

/**
 * Pure decision for the midnight check: show the new-day banner only on the
 * Today route, when the date shown differs from the date now (see
 * `hasTodayChanged`; a `?date=` preview never differs), and not if the banner
 * is already on screen. Used by `showNewDayBannerIfNeeded` in `startApp`.
 */
export function shouldShowNewDayBanner(
  route: Route,
  shownDate: string,
  search: string,
  isBannerShown: boolean,
  hasStartDate: boolean,
  now: Date = new Date(),
): boolean {
  return route === "today" && hasStartDate && !isBannerShown && hasTodayChanged(shownDate, search, now);
}

/** Inline message on the Overview when the "Start Day 1" button cannot save the start date. */
export const START_TODAY_SAVE_FAILED_MESSAGE = "Couldn't save on this device, so the start date won't be remembered.";

/** Inline message shown when settings cannot be written to this device. */
export const SAVE_FAILED_MESSAGE = "Couldn't save on this device";

/**
 * Writes settings to `storage`, returning null on success or
 * `SAVE_FAILED_MESSAGE` if the browser refuses (storage full or blocked).
 * Used by `handleSave` in `startApp`; split out so it can be unit tested.
 */
export function persistSettings(newSettings: TrainingSettings, storage: Storage, keys: ProgramStorageKeys): string | null {
  try {
    saveSettings(newSettings, storage, keys);
    return null;
  } catch {
    return SAVE_FAILED_MESSAGE;
  }
}

/**
 * Shows the app inside `root`. `storageKeys` are the localStorage keys of the
 * active program (main.ts builds them from the program id). Re-renders on every hash change; settings
 * edits go through `saveSettings`, update the in-memory copy and return to Today.
 * `warnings` (unknown program.json fields) appear as a dismissible banner on
 * Today; dismissing hides it until the page is reloaded. `loadedPrograms` is
 * every catalogue program as loaded at startup: the picker at `#/programs`
 * shows a card for each, and the Import card names programs from it.
 */
export function startApp(
  root: HTMLElement,
  program: Program,
  storageKeys: ProgramStorageKeys,
  initialSettings: TrainingSettings,
  warnings: ProgramWarning[] = [],
  loadedLog: LoadLogResult = { log: { sessions: {} } },
  loadedFatigue: LoadFatigueHistoryResult = { history: { checks: [] } },
  loadedPrograms: LoadedCatalogueEntry[] = [],
): void {
  const programNames = programNamesById(loadedPrograms);
  let settings = initialSettings;
  let log = loadedLog.log;
  let warningsDismissed = false;
  let logWarningDismissed = false;
  let fatigueHistory = loadedFatigue.history;
  let fatigueLoadWarningDismissed = false;
  /** The "No equipment" ticks per date (kept in localStorage too; throwaway, see noEquipment/storage.ts). */
  let noEquipmentTicks: NoEquipmentTicks = loadTicks(localStorage, storageKeys.noEquipment);
  /** The days combined into another day's session, by host date (kept in localStorage too; see combine/storage.ts). */
  let combines: CombinesByDate = loadCombines(localStorage, storageKeys.combines);
  /** The date "Remind me tomorrow" was tapped on the check-in card (kept in localStorage too), or undefined. */
  let checkInSnoozedDate = loadStoredValue(storageKeys.checkInSnoozed, checkInSnoozedFromWire);
  /** The program week whose drop banner was dismissed (kept in localStorage too), or undefined. */
  let dropBannerDismissedWeek = loadStoredValue(storageKeys.fatigueWarningDismissed, fatigueWarningDismissedFromWire);
  /** Unsaved check-in stepper values, kept here so a re-render does not reset them. */
  let checkInDraft: CheckInDraft | undefined;
  /** Set when "Start Day 1" could not be saved; shown inline on the Overview. */
  let startTodayFailureMessage: string | undefined;
  /** The date "Not today" was tapped on the retest card (kept in localStorage too), or undefined. */
  let retestDismissedDate = loadRetestDismissedDate(storageKeys);
  /** First date of the retest week whose broad jump was skipped (kept in localStorage too), or undefined. */
  let retestJumpSkippedWeekStart = loadStoredValue(storageKeys.retestJumpSkipped, retestJumpSkippedFromWire);
  /** First weeks of the rotation blocks whose card was dismissed (kept in localStorage too). */
  let rotationDismissedBlockWeeks = loadStoredValue(storageKeys.rotationDismissed, rotationDismissedFromWire) ?? [];
  /** Retest card stepper values by exercise id, kept here so re-renders don't reset an unsaved one. */
  const retestDrafts: Record<string, number | undefined> = {};

  /** The retest card's broad jump stepper value (undefined = blank), kept here for the same reason. */
  const retestJumpDraft: { metres?: number } = {};
  /**
   * The pinned session date: what Today shows. Set once here and moved only by
   * `handleShowNewDay` (the banner button), so a session left open past
   * midnight is not swapped under Ed. Compared against the clock by
   * `showNewDayBannerIfNeeded`.
   */
  let shownDate = resolveToday(window.location.search);
  /** The app-level lock for "session in progress"; separate from each timer overlay's own lock. Lives as long as the page. */
  const sessionWakeLock = createScreenWakeLock();

  /**
   * Decides whether the screen should be kept awake right now and tells the
   * session lock. Wanted on Today (for the shown date) and on the log screen
   * (for the date in its address) when that date is the real current date and
   * its session is in progress (`isSessionInProgress`, which also applies the
   * 45-minute idle timeout using the current time). Called at the end of
   * `render()`, from `changeLog` (the log screen redraws itself without a full
   * render) and from `handleClockCheck` (so midnight and the idle timeout take
   * effect without any tap). Never throws: a program gap on the date just
   * means "not wanted".
   */
  function updateSessionWakeLock(): void {
    const route = routeFromHash(window.location.hash);
    let sessionDate: string | undefined;
    if (route === "today") sessionDate = shownDate;
    if (route === "log") sessionDate = parseLogRoute(window.location.hash)?.date;

    let isWanted = false;
    if (sessionDate !== undefined && sessionDate === resolveToday(window.location.search)) {
      try {
        isWanted = isSessionInProgress(buildSwappedSessionFor(program, settings, log, noEquipmentTicks, combines, sessionDate, todayLocalDate()).session, log, sessionDate, new Date());
      } catch {
        isWanted = false;
      }
    }

    sessionWakeLock.setWanted(isWanted);
  }

  /**
   * Saves a "No equipment" tick for the shown date (the real today only
   * decides how old ticks are pruned), then re-renders Today so the row, its
   * log screen and timers show the swap, and puts focus back on the checkbox.
   * Returns null on success or the failure message for Today to show.
   */
  function handleToggleNoEquipment(itemKey: string, ticked: boolean): string | null {
    let result = setTick(localStorage, storageKeys.noEquipment, shownDate, itemKey, ticked, todayLocalDate());
    if (!result.ok) return result.error;

    // A combined session reads a plain key ticked before combining ("3:pull_up") as the host day's tick
    // ("1.3:pull_up"). Unticking the qualified key must also clear that plain key, or it would tick again.
    const hostDayOfKey = /^(\d+)\.(\d+:.+)$/.exec(itemKey);
    if (!ticked && hostDayOfKey !== null) {
      const hostCombine = activeCombineOn(program, settings.startDate, shownDate, combines, log, todayLocalDate());
      if (hostCombine !== undefined && hostCombine.hostDay === Number(hostDayOfKey[1])) {
        const plainResult = setTick(localStorage, storageKeys.noEquipment, shownDate, hostDayOfKey[2]!, false, todayLocalDate());
        if (!plainResult.ok) return plainResult.error;
        result = plainResult;
      }
    }

    noEquipmentTicks = result.ticks;
    render();
    document.querySelector<HTMLInputElement>(`input[data-no-equipment-key="${CSS.escape(itemKey)}"]`)?.focus();
    return null;
  }

  /**
   * "Add Day N to today" tapped on the shown date: stores the combine
   * (`addCombine`) and re-renders Today, which now shows the merged session.
   * Returns null on success or the failure message for Today to show.
   */
  function handleAddCombine(combine: Combine): string | null {
    const result = addCombine(localStorage, storageKeys.combines, shownDate, combine);
    if (!result.ok) return result.error;

    combines = result.combines;
    render();
    return null;
  }

  /** "Undo combine" tapped on the shown date: removes the combine (`removeCombine`) and re-renders Today with both days back. */
  function handleUndoCombine(): string | null {
    const result = removeCombine(localStorage, storageKeys.combines, shownDate);
    if (!result.ok) return result.error;

    combines = result.combines;
    render();
    return null;
  }

  /** Dismiss handler for the warning banner: remembers it for this page load and re-renders. */
  function handleDismissWarnings(): void {
    warningsDismissed = true;
    render();
  }

  /** Dismiss handler for the "log could not be read" banner. */
  function handleDismissLogWarning(): void {
    logWarningDismissed = true;
    render();
  }

  /** Dismiss handler for the "check-ins could not be read" banner. */
  function handleDismissFatigueLoadWarning(): void {
    fatigueLoadWarningDismissed = true;
    render();
  }

  /**
   * Passed to the log screen and History for every change: re-reads the stored
   * log, applies the one `operation` to it, saves (`applyLogChange`), keeps the
   * resulting log as the app's copy (Today reads it for "2/6") and re-checks
   * the wake lock. Returns the log for the screen to show and an inline
   * message if saving failed (the change is kept in memory) or was refused
   * (the stored log could not be read safely; nothing changes).
   */
  function changeLog(operation: (freshLog: WorkoutLog) => WorkoutLog): LogChangeOutcome {
    const result = applyLogChange(localStorage, storageKeys, operation);
    if (result.log !== undefined) {
      log = result.log;
    }

    updateSessionWakeLock();
    return { log, error: result.saved ? null : result.error };
  }

  /**
   * Save handler passed to the Settings screen. Persists the settings; on
   * success updates the in-memory copy, goes to Today and shows "Saved".
   * On failure returns a message for the screen to show inline and stays put.
   */
  function handleSave(newSettings: TrainingSettings): string | null {
    const failureMessage = persistSettings(newSettings, localStorage, storageKeys);
    if (failureMessage !== null) {
      return failureMessage;
    }

    settings = newSettings;
    navigateTo("today");
    showSavedToast();
    return null;
  }

  /**
   * Called by the Import card after `applyImport` or `undoLastImport`
   * replaced the stored data. Reloads the in-memory settings, log and
   * check-ins from storage (so what is shown is what was stored, not what was
   * parsed), forgets every draft (check-in, retest maxes, broad jump) because
   * they belonged to the old data, goes to Today, moves focus to the main
   * heading (the Import card's button is gone) and says the import can be
   * undone in Settings. Dismissal flags (retest, rotation, snooze) are left
   * as they were.
   */
  function handleImported(): void {
    settings = loadSettings(localStorage, storageKeys);
    loadedLog = loadLog(localStorage, storageKeys);
    log = loadedLog.log;
    loadedFatigue = loadFatigueHistory(localStorage, storageKeys);
    fatigueHistory = loadedFatigue.history;
    // An import replaces the stored combines too (an import without any clears them).
    combines = loadCombines(localStorage, storageKeys.combines);
    logWarningDismissed = false;
    fatigueLoadWarningDismissed = false;
    checkInDraft = undefined;
    for (const exerciseId of Object.keys(retestDrafts)) delete retestDrafts[exerciseId];
    delete retestJumpDraft.metres;

    showTodayAndFocusHeading();
    showToast("Imported. You can undo it in Settings.");
  }

  /**
   * Shows the Today screen and moves focus to its main heading, whether or not
   * the address already says `#/today` (changing the hash to the same value
   * fires no `hashchange`, so that case renders directly). Used after an
   * import and after the Overview's "Start Day 1" saves the start date.
   */
  function showTodayAndFocusHeading(): void {
    if (routeFromHash(window.location.hash) === "today") {
      render();
      focusMainHeading();
    } else {
      // The hashchange listener that renders was added first, so this runs after the new screen is drawn.
      window.addEventListener("hashchange", focusMainHeading, { once: true });
      navigateTo("today");
    }
  }

  /**
   * Handler for the Overview's first-run "Start Day 1" button: saves `today`
   * (which honours the `?date=` override) as the start date, keeping any
   * maxes, then shows Today (Week 1 · Day 1) with focus on its heading. A
   * storage failure is shown inline on the Overview (the nav stays, and Ed can
   * still pick a date in Settings).
   */
  function handleStartToday(): void {
    const today = resolveToday(window.location.search);
    const failureMessage = persistSettings({ ...settings, startDate: today }, localStorage, storageKeys);
    if (failureMessage !== null) {
      startTodayFailureMessage = START_TODAY_SAVE_FAILED_MESSAGE;
      render();
      return;
    }

    startTodayFailureMessage = undefined;
    settings = { ...settings, startDate: today };
    showTodayAndFocusHeading();
  }

  /**
   * True when the shown date is the real today. A `?date=` preview (or a page
   * left open past midnight) fails this, and then the retest and check-in
   * cards can't save: a retest save stamps the REAL date, so saving from a
   * preview would change the max for every week (PLAN.md rules 5 and 6).
   */
  function canSaveOnShownDate(): boolean {
    return shownDate === todayLocalDate();
  }

  /**
   * Save handler for one exercise on the week 8 retest card. Refuses when the
   * shown date is not the real today. Otherwise it RE-READS the stored
   * settings and changes only this one max and its date (`applyRetestMax`, the
   * real local date, never the preview), so a second open copy of the app that
   * changed the start date or the other max isn't undone. On success the app
   * keeps the saved settings, re-renders Today (the EMOM target switches to the
   * new max at once) and moves focus to the next retest stepper, or to the
   * main heading when the card is gone. Returns null on success or the message
   * for the card to show inline.
   */
  function handleSaveRetestMax(exerciseId: string, newMax: number): string | null {
    if (!canSaveOnShownDate()) return PREVIEW_SAVING_OFF_MESSAGE;

    const newSettings = applyRetestMax(loadSettings(localStorage, storageKeys), exerciseId, newMax, todayLocalDate());

    const failureMessage = persistSettings(newSettings, localStorage, storageKeys);
    if (failureMessage !== null) {
      return failureMessage;
    }
    settings = newSettings;

    if (exerciseId === RETEST_PULL_UP_ID) {
      recordRetestCheck({ maxPullUps: newMax }); // a failure only keeps the check in memory; the max itself is saved
    }

    render();
    if (!focusRemainingRetestStepper()) focusMainHeading();
    return null;
  }

  /**
   * Rule 6: week 8's retest replaces the weekly check-in, so saving the
   * pull-up retest or the retest card's broad jump records week 8's check.
   * `values` holds only the field being saved; `mergeRetestCheck` keeps the
   * other field (and the date) of any check already stored for the week, so
   * the two saves can come in either order without wiping each other. It only
   * records when the REAL save date is inside the retest week (a save made
   * outside it files nothing under a week it doesn't belong to) and returns a
   * message in that case. Returns null on success, else the message for the
   * card; on a write failure the check is still kept in memory. Dips never
   * touch this.
   */
  function recordRetestCheck(values: { broadJumpMetres?: number; maxPullUps?: number }): string | null {
    const realToday = todayLocalDate();
    const status = programStatus(settings.startDate, program.lengthWeeks, realToday);
    if (status.kind !== "active" || !phaseForWeek(program, status.week).retest) return "The retest week is not today";
    const week = status.week;

    const now = new Date();
    const result = applyFatigueChange(localStorage, storageKeys, (freshHistory) => {
      const existing = checkForWeek(weeklyChecksFor(freshHistory, settings.startDate, program.lengthWeeks), week);
      return recordCheck(freshHistory, mergeRetestCheck(existing, values, realToday, now), settings.startDate, program.lengthWeeks);
    }, now);

    if (result.history !== undefined) fatigueHistory = result.history;
    return result.saved ? null : result.error;
  }

  /**
   * Save handler for the retest card's optional broad jump ("Save jump").
   * Refuses in a preview. Records week 8's check with the jump (merged with
   * any retested pull-ups), re-renders Today (the card shows the saved value)
   * and keeps focus on the jump stepper. Returns null on success or the
   * message to show inline.
   */
  function handleSaveBroadJump(metres: number): string | null {
    if (!canSaveOnShownDate()) return PREVIEW_SAVING_OFF_MESSAGE;

    const failureMessage = recordRetestCheck({ broadJumpMetres: metres });
    if (failureMessage !== null) return failureMessage;

    render();
    focusRetestJumpStepper();
    return null;
  }

  /**
   * Save handler for the check-in card. Refuses when the shown date is not the
   * real today (a preview). Stores one check for the shown date's program
   * week: `date` is the shown date (equal to the real today here) and
   * `savedAt` is the real clock. Blank fields are left out. The fatigue
   * history is re-read first: if this week already has a check there (saved
   * from another open copy), it is NOT overwritten; the card goes away, the
   * stored check is shown and a short note says so. On success the draft is
   * cleared, Today re-renders (the card goes; a drop shows the banner) and
   * focus moves to the main heading, because the Save button is gone. Returns
   * null on success or the message to show inline; on a write failure the
   * check is still kept in memory (and the card goes at the next render).
   */
  function handleSaveCheckIn(values: { broadJumpMetres?: number; maxPullUps?: number }): string | null {
    if (!canSaveOnShownDate()) return PREVIEW_SAVING_OFF_MESSAGE;

    const week = checkInWeekToAsk(program, settings, shownDate, fatigueHistory, undefined);
    if (week === undefined) return "No check-in is due for this day";

    const check: FatigueCheck = { date: shownDate, savedAt: new Date(), ...values };
    let foundExistingCheck = false;
    const result = applyFatigueChange(localStorage, storageKeys, (freshHistory) => {
      if (checkForWeek(weeklyChecksFor(freshHistory, settings.startDate, program.lengthWeeks), week) !== undefined) {
        foundExistingCheck = true;
        return freshHistory; // keep the other copy's check untouched
      }
      return recordCheck(freshHistory, check, settings.startDate, program.lengthWeeks);
    });
    if (result.history !== undefined) fatigueHistory = result.history;
    if (!result.saved) return result.error;

    checkInDraft = undefined;
    render();
    focusMainHeading();
    if (foundExistingCheck) showToast(CHECK_ALREADY_SAVED_MESSAGE);
    return null;
  }

  /** "Remind me tomorrow": hides the card for the shown date, remembered across reloads, and re-renders. */
  function handleSnoozeCheckIn(): void {
    checkInSnoozedDate = shownDate;
    try {
      localStorage.setItem(storageKeys.checkInSnoozed, checkInSnoozedToWire(shownDate));
    } catch {
      // Storage blocked: hidden until reload, which is fine for a snooze.
    }
    render();
    focusMainHeading(); // the Remind me tomorrow button is gone with the card
  }

  /** Dismiss on the drop banner: hides it for that week, remembered across reloads, and re-renders. */
  function handleDismissDropBanner(week: number): void {
    dropBannerDismissedWeek = week;
    try {
      localStorage.setItem(storageKeys.fatigueWarningDismissed, fatigueWarningDismissedToWire(week));
    } catch {
      // Storage blocked: stays dismissed until reload.
    }
    render();
  }

  /** The unsaved check-in values for `week`; a draft of another week is replaced by a fresh, blank one. */
  function draftForWeek(week: number): CheckInDraft {
    if (checkInDraft === undefined || checkInDraft.week !== week) {
      checkInDraft = createCheckInDraft(week);
    }
    return checkInDraft;
  }

  /**
   * "Skip jump" on the jump-only retest card: remembers (across reloads) that
   * the broad jump is skipped for the shown date's retest week, and re-renders
   * so the card goes. Does nothing in a preview or outside a retest week.
   */
  function handleSkipRetestJump(): void {
    if (!canSaveOnShownDate()) return;

    const weekStartDate = retestWeekStartDate(program, settings, shownDate);
    if (weekStartDate === undefined) return;

    retestJumpSkippedWeekStart = weekStartDate;
    try {
      localStorage.setItem(storageKeys.retestJumpSkipped, retestJumpSkippedToWire(weekStartDate));
    } catch {
      // Storage blocked: stays skipped until reload.
    }
    render();
    focusMainHeading();
  }

  /** "Not today" on the retest card: hides it for the shown date, remembered across reloads, and re-renders. */
  function handleDismissRetest(): void {
    retestDismissedDate = shownDate;
    try {
      localStorage.setItem(storageKeys.retestDismissed, retestDismissedToWire(shownDate));
    } catch {
      // Storage blocked: the card stays hidden until reload, which is fine for a dismissal.
    }
    render();
    focusMainHeading(); // the Not today button is gone with the card
  }

  /** "Got it" on the warm-up rotation card: hides it for the whole rotation block (keyed by the block's first week), remembered across reloads. */
  function handleDismissRotation(): void {
    if (!canSaveOnShownDate()) return; // a ?date= preview changes nothing stored

    const blockStartWeek = rotationBlockStartWeek(program, buildSession(program, settings, shownDate));
    if (blockStartWeek === undefined) return;

    rotationDismissedBlockWeeks = [...new Set([...rotationDismissedBlockWeeks, blockStartWeek])];
    try {
      localStorage.setItem(storageKeys.rotationDismissed, rotationDismissedToWire(rotationDismissedBlockWeeks));
    } catch {
      // Storage blocked: the card stays hidden until reload, which is fine for a dismissal.
    }
    render();
    focusMainHeading(); // the Got it button is gone with the card
  }

  /**
   * Moves the shown date forward to the real current date and redraws. Only
   * the new-day banner's button calls this, so the session on screen never
   * changes by itself.
   */
  function handleShowNewDay(): void {
    shownDate = resolveToday(window.location.search);
    render();
  }

  /**
   * Adds the "It's a new day" banner to the top of Today's existing <main>
   * if the real date has moved on from the shown date. Called after every
   * render (so leaving Today and coming back keeps the banner until it is
   * tapped) and from `handleClockCheck`. Skipped while there is no start date
   * (the first-run Overview stands in for Today) and on the Overview route. Never re-renders, so the current
   * session, scroll position, focus and any open timer/sheet are untouched.
   */
  function showNewDayBannerIfNeeded(): void {
    const main = root.querySelector("main");
    const isBannerShown = document.querySelector(".new-day-banner") !== null;
    const route = routeFromHash(window.location.hash);
    if (main === null || !shouldShowNewDayBanner(route, shownDate, window.location.search, isBannerShown, settings.startDate !== null)) return;

    main.prepend(renderNewDayBanner(handleShowNewDay));
  }

  /**
   * The periodic check, run every minute and when the page becomes visible (a
   * sleeping phone's timers are paused): re-evaluates the wake lock (idle
   * timeout, a session left open past midnight) and offers the new-day banner.
   */
  function handleClockCheck(): void {
    updateSessionWakeLock();
    showNewDayBannerIfNeeded();
  }

  /**
   * Draws the screen for the current hash route plus the nav bar into `root`.
   * Runs once at start and again on every `hashchange` (see `startApp`).
   */
  function render(): void {
    try {
      // With no start date, Today is replaced by the Overview (first run); the hash stays as it is.
      const requestedRoute = routeFromHash(window.location.hash);
      const isFirstRun = requestedRoute === "today" && settings.startDate === null;
      const planTarget = parsePlanRoute(window.location.hash);
      // A plan address outside the program (week 9, day 8) falls back to the Overview.
      const planIsInProgram = requestedRoute === "plan" && planTarget !== undefined
        && buildDayPlan(program, settings, planTarget.week, planTarget.dayNumber, shownDate) !== undefined;
      const route: Route = isFirstRun || (requestedRoute === "plan" && !planIsInProgram) ? "overview" : requestedRoute;
      const main = element("main", "app-main");
      const previewDate = previewDateFromSearch(window.location.search);
      if (previewDate !== undefined && (route === "today" || route === "log" || route === "overview" || route === "plan")) {
        main.append(renderPreviewStrip(previewDate));
      }
      if ((route === "today" || route === "overview" || route === "plan") && warnings.length > 0 && !warningsDismissed) {
        main.append(renderWarningBanner(warnings, handleDismissWarnings));
      }
      if (route !== "settings" && loadedLog.warning !== undefined && !logWarningDismissed) {
        main.append(renderLogWarningBanner(loadedLog.warning, handleDismissLogWarning));
      }
      if (route !== "settings" && loadedFatigue.warning !== undefined && !fatigueLoadWarningDismissed) {
        main.append(renderLogWarningBanner(loadedFatigue.warning, handleDismissFatigueLoadWarning));
      }
      if (route === "today") {
        const drop = dropWarningForShownDate(program, settings, shownDate, fatigueHistory);
        if (program.fatigueCheck !== undefined && drop.warnings.length > 0 && dropBannerDismissedWeek !== drop.week) {
          main.append(renderDropBanner(drop.warnings, program.fatigueCheck.rule, () => handleDismissDropBanner(drop.week)));
        }
      }
      const logTarget = parseLogRoute(window.location.hash);
      if (route === "settings") {
        main.append(renderSettingsScreen(program, settings, todayLocalDate(), handleSave, () => readExportSource(localStorage, storageKeys), {
          isPreview: previewDateFromSearch(window.location.search) !== undefined,
          storage: localStorage,
          storageKeys,
          programNames,
          currentSessionCount: () => Object.keys(log.sessions).length,
          onImported: handleImported,
        }));
      } else if (route === "programs") {
        // Reached from "Switch program": choosing saves and reloads (the shell holds one program's keys).
        main.append(renderProgramPickerScreen(buildProgramPicker(loadedPrograms, storageKeys.programId), chooseProgramAndReload));
      } else if (route === "log" && logTarget !== undefined) {
        main.append(renderLogScreen(program, storageKeys.programId, settings, logTarget.date, logTarget.blockPosition, logTarget.exerciseId, log, changeLog, todayLocalDate(), noEquipmentTicks, logTarget.day, combines));
      } else if (route === "history") {
        main.append(renderHistoryScreen(program, log, changeLog));
      } else if (route === "plan" && planTarget !== undefined) {
        const planScreen = renderDayPlanScreen(program, storageKeys.programId, settings, planTarget.week, planTarget.dayNumber, shownDate, window.location.search, combines, log, todayLocalDate());
        if (planScreen !== undefined) main.append(planScreen);
      } else if (route === "overview") {
        const status = programStatus(settings.startDate, program.lengthWeeks, shownDate);
        main.append(renderOverviewScreen(buildProgramOverview(program, status), {
          search: window.location.search,
          onStartToday: handleStartToday,
          startTodayFailureMessage: startTodayFailureMessage,
        }));
      } else {
        main.append(renderTodayScreen(program, storageKeys.programId, settings, shownDate, log, {
          dismissedDate: retestDismissedDate,
          actions: { canSave: canSaveOnShownDate(), onSaveMax: handleSaveRetestMax, onDismiss: handleDismissRetest, drafts: retestDrafts, jumpDraft: retestJumpDraft, onSaveBroadJump: handleSaveBroadJump, onSkipJump: handleSkipRetestJump },
          history: fatigueHistory,
          jumpSkippedWeekStart: retestJumpSkippedWeekStart,
        }, {
          history: fatigueHistory,
          snoozedDate: checkInSnoozedDate,
          canSave: canSaveOnShownDate(),
          ruleText: program.fatigueCheck?.rule ?? "",
          draftForWeek,
          onSave: handleSaveCheckIn,
          onSnooze: handleSnoozeCheckIn,
        }, { dismissedBlockWeeks: rotationDismissedBlockWeeks, canDismiss: canSaveOnShownDate(), onDismiss: handleDismissRotation }, {
          ticks: noEquipmentTicks,
          // Ticks follow logging rules: past dates and today, not a future preview.
          canTick: shownDate <= todayLocalDate(),
          onToggle: handleToggleNoEquipment,
        }, {
          combines,
          // Combining is "on the day": offers and Undo show only when the shown date is this real today.
          realToday: todayLocalDate(),
          actions: {
            onAdd: handleAddCombine,
            onUndo: handleUndoCombine,
          },
        }));
      }
      // The log screen, the Overview and the Day plan belong to Today, so Today stays highlighted in the nav.
      root.replaceChildren(main, renderNavigationBar(route === "log" || route === "overview" || route === "plan" ? "today" : route));
      updateSessionWakeLock();
      showNewDayBannerIfNeeded();
    } catch (error) {
      // A throwing render (e.g. a program gap hit on one date) must not leave
      // a blank screen: show the same readable card as a startup failure.
      showStartupError(root, error);
    }
  }

  window.addEventListener("hashchange", render);
  window.setInterval(handleClockCheck, DATE_CHECK_INTERVAL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") handleClockCheck();
  });
  render();
}

/**
 * Reads the retest card's dismissed date from localStorage at startup
 * (through `retestDismissedFromWire`); undefined if absent, corrupt or if
 * storage cannot be read.
 */
function loadRetestDismissedDate(storageKeys: ProgramStorageKeys): string | undefined {
  try {
    return retestDismissedFromWire(localStorage.getItem(storageKeys.retestDismissed));
  } catch {
    return undefined;
  }
}

/**
 * Reads one small stored value at startup (through its `fromWire` mapping);
 * undefined if absent, corrupt or if storage cannot be read. Used for the
 * check-in snooze and the drop banner dismissal.
 */
function loadStoredValue<Value>(key: string, fromWire: (text: string | null) => Value | undefined): Value | undefined {
  try {
    return fromWire(localStorage.getItem(key));
  } catch {
    return undefined;
  }
}

/**
 * Id of the exercise whose retest also counts as the week 8 fatigue check
 * (max pull-ups). Kept as a constant on purpose: program.json's
 * `fatigueCheck.tests` is only free text ("Max pull-ups"), with no exercise id
 * to follow, and the check-in card's fields (broad jump, max pull-ups) are
 * fixed in code and in the stored check's shape anyway.
 */
const RETEST_PULL_UP_ID = "pull_up";

/** Shown when a check-in save found this week's check already stored (saved from another open copy). */
const CHECK_ALREADY_SAVED_MESSAGE = "Already saved on another screen";

/** Dismissible amber banner shown when saved data (the workout log or the weekly check-ins) could not be read (it was set aside, see log/storage.ts). */
function renderLogWarningBanner(warningText: string, onDismiss: () => void): HTMLElement {
  const banner = element("div", "card warning-banner");
  banner.setAttribute("role", "status");

  const dismissButton = element("button", "warning-dismiss", "Dismiss");
  dismissButton.type = "button";
  dismissButton.addEventListener("click", () => {
    onDismiss();
    focusMainHeading();
  });

  const header = element("div", "warning-banner-header");
  header.append(element("p", "warning-banner-text", warningText), dismissButton);
  banner.append(header);
  return banner;
}

/** Bottom nav: Today, History and Settings. */
function renderNavigationBar(activeRoute: Route): HTMLElement {
  const nav = element("nav", "bottom-nav");
  nav.setAttribute("aria-label", "Main");

  const todayLink = navigationLink("◉", "Today", "#/today", activeRoute === "today");

  const historyLink = navigationLink("▤", "History", "#/history", activeRoute === "history");

  const settingsLink = navigationLink("⚙", "Settings", "#/settings", activeRoute === "settings");

  nav.append(todayLink, historyLink, settingsLink);
  return nav;
}

/** One tappable nav entry with an icon above its label. */
function navigationLink(icon: string, label: string, href: string, isActive: boolean): HTMLAnchorElement {
  const link = element("a", isActive ? "nav-item nav-item-active" : "nav-item");
  link.href = href;
  if (isActive) {
    link.setAttribute("aria-current", "page");
  }
  link.append(element("i", undefined, icon), label);
  return link;
}

/** Briefly shows "Saved" above the nav bar (see `showToast`). */
function showSavedToast(): void {
  showToast("Saved");
}

/** Briefly shows `message` above the nav bar. Lives outside #app so re-renders don't remove it. */
function showToast(message: string): void {
  const toast = element("div", "toast", message);
  toast.setAttribute("role", "status");
  document.body.append(toast);
  window.setTimeout(() => toast.remove(), SAVED_TOAST_MILLISECONDS);
}

/**
 * Replaces the app with a readable error card (a program file failed to parse, or a render threw).
 * `onSwitchProgram`, when given, adds a "Switch program" link under the message
 * (used when the chosen program's file is broken, so the athlete can pick another).
 */
export function showStartupError(root: HTMLElement, error: unknown, onSwitchProgram?: () => void): void {
  const message = error instanceof Error ? error.message : String(error);
  const card = element("div", "card error-card");
  card.setAttribute("role", "alert");
  card.append(element("h2", "card-title", "Could not load the program"), element("pre", "error-message", message));

  if (onSwitchProgram !== undefined) {
    const switchLink = renderSwitchProgramLink();
    switchLink.addEventListener("click", (event) => {
      event.preventDefault();
      onSwitchProgram();
    });
    card.append(switchLink);
  }

  const main = element("main", "app-main");
  main.append(card);
  root.replaceChildren(main);
}
