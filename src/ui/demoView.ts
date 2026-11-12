import "./demoView.css";
import { createDemoRenderer } from "../demo/loadRenderer";
import type { CameraView, Demo } from "../demo/model";
import type { DemoRenderer } from "../demo/renderer";
import { frameAt, nextHoldTime, stillFrames } from "../demo/timeline";
import { closeOnBack } from "./backToClose";
import {
  NORMAL_SPEED, SLOW_SPEED, TURN_DURATION_MS, advanceClock, azimuthOf, frameDeltaMs, nextView, pauseButtonLabel,
  speedButtonLabel, stillIndexForStep, turnAzimuth, turnButtonLabel,
} from "./demoViewLogic";
import { element } from "./dom";

/**
 * The full-screen "Show me" overlay: plays one exercise's demo (src/demo/*)
 * on a black stage with a big step label, a one-line cue and three controls.
 * Modelled on the timer overlay (timerView.ts): appended outside #app, the
 * screens behind are inert, the body does not scroll, Escape / Close / the
 * phone's Back (backToClose.ts) / hashchange close it, and focus returns to
 * the button that opened it.
 *
 *   openDemoView(loadingDemo, { title, dose, opener })
 *        │
 *        ├─ at once: overlay with the header (title, dose, Close) and a black stage
 *        │
 *        ├─ when loadingDemo resolves (the demo is built in a lazy chunk, see
 *        │  demo/registry.ts): the step label, cue and controls appear, and
 *        │  createDemoRenderer(stage, demo) ──▶ 3D (three.js) or flat SVG
 *        │
 *        └─ one requestAnimationFrame loop while open and visible:
 *              delta = real time since last frame (capped)
 *              clock += delta × speed            (not while paused; a paused loop
 *                                                 goes to sleep once any turn has settled)
 *              azimuth eases towards the Turn target
 *              frameAt(demo, clock) ──▶ renderer.draw(pose, azimuth) + step label
 *
 *   Reduced motion: no loop. One still at a time; "Next step" jumps the clock
 *   to the next hold, Turn jumps straight to the next angle.
 *
 * Pure decisions (view order, labels, clock rules) live in demoViewLogic.ts.
 *
 * Test hook (used by Playwright, not by the app): the overlay root carries
 * data-step-label, data-paused, data-speed, data-view, data-renderer
 * ("3d" | "flat", empty until the renderer is ready) and data-reduced-motion.
 */

/** Things inside the overlay that can take keyboard focus (for the Tab trap). */
const FOCUSABLE = "button:not([disabled])";

/** What `openDemoView` needs to know that is not part of the demo itself. */
export interface DemoViewOptions {
  /** Exercise name for the header, e.g. "High wall sit". */
  title: string;
  /** This week's dose text, e.g. "3 × 20s"; shown in the header only (the loop shows one rep). */
  dose: string;
  /** The button that opened the view; regains focus on close. */
  opener: HTMLElement;
}

/** What `openDemoView` gives back. */
export interface DemoViewHandle {
  /** Closes the overlay and stops its loop. Safe to call more than once. */
  close(): void;
}

/**
 * Opens the "Show me" overlay at once and returns a handle to close it. The
 * demo arrives as a promise because building it is deferred until the first
 * tap (demo/registry.ts `loadDemo`); until then the overlay shows only the
 * header and the black stage. If the promise rejects or resolves to undefined,
 * the cue line says the demo could not be loaded and Close still works.
 */
export function openDemoView(loadingDemo: Promise<Demo | undefined>, options: DemoViewOptions): DemoViewHandle {
  const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  // --- State that exists before the demo has loaded ---
  let isClosed = false;
  /** Stops the loop, frees the renderer and removes the listeners that only exist while a demo is playing; replaced by playDemo. */
  let stopDemo: () => void = () => {};

  // --- Structure that needs no demo (built once) ---
  const overlay = element("div", "demo-view");
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", `${options.title}, how to do it`);
  overlay.tabIndex = -1;

  const closeButton = element("button", "demo-close", "‹ Close");
  closeButton.type = "button";
  const heading = element("h2", "demo-title");
  heading.append(element("span", "demo-title-name", options.title), " · ", element("span", "demo-title-dose", options.dose));
  const topBar = element("div", "demo-top");
  topBar.append(closeButton, heading);

  // Stays black until the demo has loaded and a renderer is drawing into it.
  const stage = element("div", "demo-stage");
  stage.setAttribute("role", "img");
  stage.setAttribute("aria-label", `${options.title}, loading the demonstration`);

  overlay.append(topBar, stage);

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

  // The screens behind are made inert and the body frozen, as in the timer.
  const backgroundRegions = Array.from(document.querySelectorAll<HTMLElement>("#app > main, #app > nav"));
  const previousBodyOverflow = document.body.style.overflow;
  for (const region of backgroundRegions) region.inert = true;
  document.body.style.overflow = "hidden";

  /** Lets the Back button close the overlay; released in close(). */
  const backToClose = closeOnBack(window.history, window, () => close());

  /** Stops the loop, frees the renderer, restores the page and returns focus to the opener. */
  function close(): void {
    if (isClosed) return;
    isClosed = true;

    stopDemo();
    document.removeEventListener("keydown", handleKeydown);
    window.removeEventListener("hashchange", close);
    backToClose.release();
    for (const region of backgroundRegions) region.inert = false;
    document.body.style.overflow = previousBodyOverflow;
    overlay.remove();
    if (options.opener.isConnected) options.opener.focus();
  }

  /**
   * Once the demo has loaded: adds the step label, cue and controls under the
   * stage, starts the renderer (the 3D chunk loads on first use) and the loop.
   * Everything it sets up is undone by `stopDemo`, which close() calls.
   */
  function playDemo(demo: Demo): void {
    // --- State that needs the demo ---
    let isPaused = false;
    let speed = NORMAL_SPEED;
    /** Milliseconds into the demo's loop. */
    let clockMs = 0;

    const cycle = demo.views;
    let currentView: CameraView = demo.views[0]!;
    let currentAzimuth = azimuthOf(currentView);
    let turnFromAzimuth = currentAzimuth;
    let turnToAzimuth = currentAzimuth;
    let sinceTurnStartMs = Number.POSITIVE_INFINITY;

    let renderer: DemoRenderer | null = null;
    let animationFrameId: number | null = null;
    let previousTimestamp: number | null = null;

    const stills = stillFrames(demo);
    stage.setAttribute("aria-label", demo.ariaLabel);

    // --- Structure (built once; updateControls/draw only change text and attributes) ---
    // Purely visual and not a live region: the cue and the aria label already say what happens.
    const stepLabel = element("div", "demo-step");
    stepLabel.setAttribute("aria-hidden", "true");
    const cue = element("p", "demo-cue", demo.cue);

    // Reduced motion only: "Start → Hold" with the current still highlighted.
    const stillCaption = element("p", "demo-stills");
    const stillCaptionItems = stills.map((still) => element("span", "demo-still", still.label));
    stillCaptionItems.forEach((item, index) => {
      if (index > 0) stillCaption.append(" → ");
      stillCaption.append(item);
    });
    stillCaption.hidden = !prefersReducedMotion;

    const primaryButton = element("button", "demo-button");
    primaryButton.type = "button";
    const speedButton = element("button", "demo-button");
    speedButton.type = "button";
    speedButton.hidden = prefersReducedMotion;
    const turnButton = element("button", "demo-button");
    turnButton.type = "button";
    const controls = element("div", "demo-controls");
    // With only one useful angle there is nothing to turn to.
    turnButton.hidden = cycle.length < 2;
    controls.append(primaryButton, speedButton, turnButton);

    overlay.append(stepLabel, cue, stillCaption, controls);

    // --- Behaviour ---

    /** Updates button texts and the test-hook attributes from the current state. */
    function updateControls(): void {
      primaryButton.textContent = prefersReducedMotion ? "Next step" : pauseButtonLabel(isPaused);
      speedButton.textContent = speedButtonLabel(speed);
      turnButton.textContent = turnButtonLabel(nextView(cycle, currentView));

      overlay.dataset.paused = String(isPaused);
      overlay.dataset.speed = String(speed);
      overlay.dataset.view = currentView;
      overlay.dataset.reducedMotion = String(prefersReducedMotion);
    }

    /** Draws the frame for the current clock and azimuth, and updates the step label. Called by the loop and after any change while it is not running. */
    function drawNow(): void {
      const frame = frameAt(demo, clockMs);
      stepLabel.textContent = frame.label;
      overlay.dataset.stepLabel = frame.label;

      const currentStill = stillIndexForStep(demo, frame.stepIndex);
      stillCaptionItems.forEach((item, index) => item.classList.toggle("demo-still-current", index === currentStill));

      renderer?.draw(frame.pose, currentAzimuth);
    }

    /** One animation frame: advance the clock and the camera by the real time since the last frame, then draw. */
    function onAnimationFrame(timestamp: number): void {
      animationFrameId = null;
      if (isClosed || document.hidden) return;

      const deltaMs = frameDeltaMs(previousTimestamp, timestamp);
      previousTimestamp = timestamp;

      clockMs = advanceClock(clockMs, deltaMs, speed, isPaused);
      sinceTurnStartMs += deltaMs;
      currentAzimuth = turnAzimuth(turnFromAzimuth, turnToAzimuth, sinceTurnStartMs);

      drawNow();

      // Paused with no turn still swinging: the picture cannot change, so stop redrawing
      // every frame (saves battery). Play, Turn, a resize or the page coming back restart it.
      if (isPaused && sinceTurnStartMs >= TURN_DURATION_MS) return;
      animationFrameId = window.requestAnimationFrame(onAnimationFrame);
    }

    /** Starts the loop if it should be running (open, visible, motion allowed, renderer ready). */
    function startLoop(): void {
      if (isClosed || prefersReducedMotion || renderer === null || document.hidden || animationFrameId !== null) return;
      // The first frame after (re)starting counts as zero time, so the clock never jumps.
      previousTimestamp = null;
      animationFrameId = window.requestAnimationFrame(onAnimationFrame);
    }

    /** Stops the loop (on close and while the page is hidden). */
    function stopLoop(): void {
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
    }

    /** Stops the loop while the page is hidden and restarts it, with a fresh time base, when it comes back. */
    function handleVisibilityChange(): void {
      if (document.hidden) stopLoop();
      else startLoop();
    }

    /** Pause/Play, or with reduced motion "Next step": jump the clock to the next hold. */
    function handlePrimary(): void {
      if (prefersReducedMotion) {
        clockMs = nextHoldTime(demo, clockMs);
        drawNow();
      } else {
        isPaused = !isPaused;
        if (!isPaused) startLoop();
      }
      updateControls();
    }

    /** Toggles between normal and half speed. */
    function handleSpeed(): void {
      speed = speed === NORMAL_SPEED ? SLOW_SPEED : NORMAL_SPEED;
      updateControls();
    }

    /** Turns the camera to the next angle: eased over ~0.8 s, or at once with reduced motion. The demo clock is untouched. */
    function handleTurn(): void {
      currentView = nextView(cycle, currentView);
      turnFromAzimuth = currentAzimuth;
      turnToAzimuth = azimuthOf(currentView);
      sinceTurnStartMs = 0;
      if (prefersReducedMotion) {
        currentAzimuth = turnToAzimuth;
        drawNow();
      } else {
        startLoop(); // The loop may be asleep while paused; it needs to run to animate the swing.
      }
      updateControls();
    }

    /** Re-fits the picture when the window changes size (a phone turned on its side, say). */
    function handleResize(): void {
      renderer?.resize();
      if (renderer !== null && (prefersReducedMotion || isPaused)) drawNow();
    }

    // --- Wiring ---
    primaryButton.addEventListener("click", handlePrimary);
    speedButton.addEventListener("click", handleSpeed);
    turnButton.addEventListener("click", handleTurn);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("resize", handleResize);

    stopDemo = () => {
      stopLoop();
      renderer?.dispose();
      renderer = null;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("resize", handleResize);
    };

    updateControls();
    drawNow();
    primaryButton.focus();

    // The renderer arrives a moment later (the 3D chunk loads on first use). If the view was closed meanwhile, free it at once.
    void createDemoRenderer(stage, demo).then(({ renderer: created, kind }) => {
      if (isClosed) {
        created.dispose();
        return;
      }
      renderer = created;
      overlay.dataset.renderer = kind;
      renderer.resize();
      drawNow();
      startLoop();
    });
  }

  /** The demo could not be built or fetched: say so in the cue line; Close still works. */
  function showLoadFailure(): void {
    overlay.append(element("p", "demo-cue", "Sorry, this demonstration could not be loaded."));
    overlay.dataset.renderer = "";
  }

  closeButton.addEventListener("click", close);
  document.addEventListener("keydown", handleKeydown);
  window.addEventListener("hashchange", close);

  overlay.dataset.renderer = "";
  document.body.append(overlay);
  closeButton.focus();

  loadingDemo.then(
    (demo) => {
      if (isClosed) return;
      if (demo === undefined) showLoadFailure();
      else playDemo(demo);
    },
    () => {
      if (!isClosed) showLoadFailure();
    },
  );

  return { close };
}
