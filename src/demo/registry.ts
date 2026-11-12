/**
 * Looks up the "Show me" demo for an exercise in a program. The Show me
 * buttons (a later PR 21 step) call this to decide whether to appear at all,
 * and ui/demoView.ts then plays the demo it returns.
 *
 * The key is program id AND exercise id because the same exercise id may be
 * done differently in different programs; Explosive Endurance has no entry,
 * so it never shows a button.
 */
import type { Demo } from "./model";
import { steadyStrengthDemos } from "./steadyStrength";

/** Demos per program id (the ids in public/programs.json). */
const demosByProgram: Record<string, Record<string, Demo>> = {
  "steady-strength": steadyStrengthDemos,
};

/** The demo for `exerciseId` in program `programId`, or undefined if it has none. */
export function demoFor(programId: string, exerciseId: string): Demo | undefined {
  const programDemos = demosByProgram[programId];
  if (programDemos === undefined || !Object.prototype.hasOwnProperty.call(programDemos, exerciseId)) {
    return undefined;
  }
  return programDemos[exerciseId];
}
