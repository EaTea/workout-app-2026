/**
 * Looks up the "Show me" demo for an exercise in a program, in two cheap-then-
 * expensive halves so that opening Today stays fast:
 *
 *   hasDemo(programId, exerciseId)    sync, reads a small list of ids kept in
 *        │                            THIS file; the Show me buttons
 *        │                            (ui/showMeButton.ts) use it to decide
 *        │                            whether to appear at all
 *        ▼ (button tapped)
 *   loadDemo(programId, exerciseId)   async, dynamic-imports ./steadyStrength
 *                                     (its own lazy chunk: building every demo
 *                                     runs many least-squares solves), then
 *                                     memoises the result; ui/demoView.ts plays
 *                                     what it returns
 *
 * The key is program id AND exercise id because the same exercise id may be
 * done differently in different programs; Explosive Endurance has no entry,
 * so it never shows a button.
 *
 * Do not import steadyStrength.ts (or poseTools.ts) statically from anything
 * in the main bundle. steadyStrength.test.ts checks that the id list below
 * matches the keys of the built demos, so the two cannot drift apart.
 */
import type { Demo } from "./model";

/** Exercise ids that have a demo, per program id (the ids in public/programs.json). Must match the keys of the built demos. */
export const DEMO_EXERCISE_IDS: Readonly<Record<string, readonly string[]>> = {
  "steady-strength": [
    "head_turns",
    "neck_retraction",
    "standing_back_extension",
    "ankle_pumps",
    "single_leg_stand",
    "heel_to_toe_stand",
    "sideways_walking",
    "high_wall_sit",
    "glute_bridge_hold",
    "pallof_press_hold",
    "sit_to_stand",
    "heel_toe_raises",
    "side_hip_raise",
    "standing_bird_dog",
    "slow_walk",
    "calf_stretch",
    "doorway_chest_stretch",
    "comfortable_walk",
  ],
};

/** Lazily loads the built demos of one program, keyed by exercise id; only programs listed in DEMO_EXERCISE_IDS have a loader. */
const programDemoLoaders: Record<string, () => Promise<Record<string, Demo>>> = {
  "steady-strength": async () => (await import("./steadyStrength")).steadyStrengthDemos,
};

/** Memoised loads, so each program's demos are imported and built at most once. */
const loadedProgramDemos = new Map<string, Promise<Record<string, Demo>>>();

/** True when `exerciseId` has a demo in program `programId`. Cheap and synchronous: safe to call for every row of a screen. */
export function hasDemo(programId: string, exerciseId: string): boolean {
  if (!Object.prototype.hasOwnProperty.call(DEMO_EXERCISE_IDS, programId)) {
    return false;
  }
  return DEMO_EXERCISE_IDS[programId]!.includes(exerciseId);
}

/**
 * The demo for `exerciseId` in program `programId`, or undefined if it has
 * none. The first call for a program loads and builds its demos (the view
 * shows its header meanwhile); later calls reuse them. A failed import (offline
 * before the chunk was cached) rejects, and is not memoised so a retry works.
 */
export async function loadDemo(programId: string, exerciseId: string): Promise<Demo | undefined> {
  if (!hasDemo(programId, exerciseId)) {
    return undefined;
  }

  let loading = loadedProgramDemos.get(programId);
  if (loading === undefined) {
    loading = programDemoLoaders[programId]!();
    loadedProgramDemos.set(programId, loading);
    loading.catch(() => loadedProgramDemos.delete(programId));
  }
  return (await loading)[exerciseId];
}
