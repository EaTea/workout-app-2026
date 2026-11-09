import {
  createTimerState, describeTimer, formatClock, pauseTimer, resumeTimer, skipSegment, startTimer, tickTimer,
  type TimerEvent, type TimerPlan, type TimerState, type TimerUpdate,
} from "../timer/engine";
import { element } from "./dom";

/**
 * Full-screen timer overlay shared by the EMOM, interval and rest timers.
 * It owns no timing logic: it feeds `Date.now()` into the pure engine
 * (timer/engine.ts) on a 250ms loop and draws whatever state comes back.
 *
 *   Today (later steps) ──openTimer(plan)──▶ overlay appended to <body>
 *        loop every 250ms ──tickTimer(now)──▶ new state ──render()──▶ DOM
 *        buttons ──start/pause/resume/skip(now)──▶ new state ──render()
 *        engine events ──▶ options.onEvent (beeps and buzzes in step 2)
 *   Escape / Close / hashchange ──▶ close() ──▶ loop stopped, page restored
 *
 * Like the exercise sheet it lives outside #app (re-renders of Today don't
 * remove it), makes the screens behind it inert and returns focus on close.
 */

/** How often the clock display is refreshed. Time itself comes from Date.now(), so this only affects smoothness. */
const REFRESH_INTERVAL_MS = 250;

/** Selector for things that can take keyboard focus inside the overlay. */
const FOCUSABLE = "button:not([disabled])";

/** Optional hooks for whoever opens the timer. */
export interface TimerViewOptions {
  /** Called for every engine event (segment starts, finish), in order. Used to play sound and vibration. */
  onEvent?: (event: TimerEvent) => void;
  /** Called synchronously inside the Start tap, before the timer starts: the place to unlock audio (iOS needs a user gesture). */
  onStart?: () => void;
  /** Called each time the displayed remaining seconds change while running (for the 3-2-1 countdown ticks). */
  onSecondTick?: (remainingSec: number) => void;
  /** Called once after the overlay has been closed, however it was closed. */
  onClose?: () => void;
}

/** What `openTimer` gives back to the caller. */
export interface TimerHandle {
  /** Closes the overlay and stops its refresh loop. Safe to call more than once. */
  close(): void;
}

/** Opens the full-screen timer for `plan`, ready to start. The caller's focused element regains focus on close. */
export function openTimer(plan: TimerPlan, options: TimerViewOptions = {}): TimerHandle {
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  let state: TimerState = createTimerState(plan);
  let isClosed = false;
  let lastRenderedWholeSecond = -1;
  /** "segmentIndex:remainingSec" of the last second reported to onSecondTick, so each second is reported once. */
  let lastReportedSecond = "";

  const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  // --- Build the static structure once; render() only updates text/classes. ---
  const overlay = element("div", "timer-view");
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "timer-title");
  overlay.tabIndex = -1;

  const closeButton = element("button", "timer-close", "✕ Close");
  closeButton.type = "button";
  const title = element("h2", "timer-title", plan.title);
  title.id = "timer-title";
  const topBar = element("div", "timer-top", undefined);
  topBar.append(closeButton, title);

  const phaseWord = element("div", "timer-phase");
  phaseWord.setAttribute("aria-live", "polite");
  const ring = element("div", "timer-ring");
  const ringCaption = element("div", "timer-ring-caption", "ROUND");
  const ringNumber = element("div", "timer-ring-number");
  ring.append(ringCaption, ringNumber);
  const digits = element("div", "timer-digits");
  const roundCounter = element("div", "timer-round");
  const segmentLabel = element("div", "timer-label");

  const toggleButton = element("button", "timer-button timer-button-primary");
  toggleButton.type = "button";
  const skipButton = element("button", "timer-button", "Skip ›");
  skipButton.type = "button";
  const controls = element("div", "timer-controls");
  controls.append(toggleButton, skipButton);

  const body = element("div", "timer-body");
  body.append(phaseWord, ring, digits, roundCounter, segmentLabel);
  overlay.append(topBar, body, controls);

  // --- Behaviour ---

  /** Stores the engine's new state, forwards its events to the caller, and redraws. */
  function applyUpdate(update: TimerUpdate): void {
    state = update.state;
    for (const event of update.events) {
      options.onEvent?.(event);
    }
    render();
  }

  /** Draws the current engine state. Called after every state change and every loop pass. */
  function render(): void {
    const view = describeTimer(state);
    const { segment } = view;
    const isMinuteStyle = segment.phase === "minute";

    overlay.dataset.phase = segment.phase;
    overlay.dataset.status = state.status;

    phaseWord.textContent = segment.phase === "work" ? "WORK" : segment.phase === "rest" ? "REST" : "";
    phaseWord.hidden = isMinuteStyle;
    ring.hidden = !isMinuteStyle;
    roundCounter.hidden = isMinuteStyle;

    ringNumber.replaceChildren(String(view.round), element("span", "timer-ring-total", `/${view.totalRounds}`));
    roundCounter.textContent = `Round ${view.round} of ${view.totalRounds}`;
    digits.textContent = formatClock(view.remainingSec);
    segmentLabel.textContent = segment.label;

    // With reduced motion the ring only moves when the displayed second changes, rather than continuously.
    if (!prefersReducedMotion || view.remainingSec !== lastRenderedWholeSecond) {
      ring.style.setProperty("--progress", `${(view.segmentProgress * 100).toFixed(1)}%`);
    }
    lastRenderedWholeSecond = view.remainingSec;

    if (state.status === "running") {
      const secondKey = `${view.segmentIndex}:${view.remainingSec}`;
      if (secondKey !== lastReportedSecond) {
        lastReportedSecond = secondKey;
        options.onSecondTick?.(view.remainingSec);
      }
    }

    toggleButton.textContent =
      state.status === "ready" ? "Start" : state.status === "running" ? "❚❚ Pause" : state.status === "paused" ? "▶ Resume" : "Done";
    skipButton.disabled = state.status === "ready" || state.status === "finished";
  }

  /** The big button: start, pause, resume, or (when finished) close, depending on the state. */
  function handleToggle(): void {
    const now = Date.now();
    if (state.status === "ready") {
      options.onStart?.();
      applyUpdate(startTimer(state, now));
    }
    else if (state.status === "running") applyUpdate(pauseTimer(state, now));
    else if (state.status === "paused") applyUpdate(resumeTimer(state, now));
    else close();
  }

  /** Advances the clock; also run when the page becomes visible again so a sleeping phone catches up at once. */
  function refreshFromClock(): void {
    applyUpdate(tickTimer(state, Date.now()));
  }

  /** Escape closes; Tab stays inside the overlay. */
  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      close();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = Array.from(overlay.querySelectorAll<HTMLElement>(FOCUSABLE));
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  // Everything behind the overlay is made inert and the body frozen, as in the exercise sheet.
  const backgroundRegions = Array.from(document.querySelectorAll<HTMLElement>("#app > main, #app > nav"));
  const previousBodyOverflow = document.body.style.overflow;
  for (const region of backgroundRegions) {
    region.inert = true;
  }
  document.body.style.overflow = "hidden";

  const refreshLoopId = window.setInterval(refreshFromClock, REFRESH_INTERVAL_MS);

  /** Stops the loop, removes listeners and the overlay, restores the page, returns focus, then tells the caller. */
  function close(): void {
    if (isClosed) return;
    isClosed = true;

    window.clearInterval(refreshLoopId);
    document.removeEventListener("keydown", handleKeydown);
    document.removeEventListener("visibilitychange", refreshFromClock);
    window.removeEventListener("hashchange", close);
    for (const region of backgroundRegions) {
      region.inert = false;
    }
    document.body.style.overflow = previousBodyOverflow;
    overlay.remove();
    if (opener?.isConnected) {
      opener.focus();
    }
    options.onClose?.();
  }

  closeButton.addEventListener("click", close);
  toggleButton.addEventListener("click", handleToggle);
  skipButton.addEventListener("click", () => applyUpdate(skipSegment(state, Date.now())));
  document.addEventListener("keydown", handleKeydown);
  document.addEventListener("visibilitychange", refreshFromClock);
  window.addEventListener("hashchange", close);

  render();
  document.body.append(overlay);
  toggleButton.focus();

  return { close };
}
