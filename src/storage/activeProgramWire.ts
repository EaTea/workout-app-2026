/**
 * Wire type for the active-program key: the JSON text stored under
 * "workout-app.active-program". Only `activeProgram.ts` uses it; the rest of
 * the app sees a plain program id string.
 */

/** Stored shape, e.g. `{ "version": 1, "programId": "explosive-endurance" }`. */
export interface ActiveProgramWire {
  version: 1;
  programId: string;
}
