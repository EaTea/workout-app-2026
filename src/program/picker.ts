/**
 * Program picker view model: what each card on the "Choose your program"
 * screen shows, worked out from the programs loaded at startup.
 *
 *   LoadedCatalogueEntry[] ─┐
 *                           ├─▶ buildProgramPicker ─▶ ProgramPickerCard[] ─▶ src/ui/programPicker.ts (renders it)
 *   active program id ──────┘
 *
 * Pure and DOM-free. The weekly numbers come from `buildProgramOverview`, the
 * same view model the Overview uses, so a card and the Overview it leads to
 * always agree; the UI words them with `formatOverviewHeadline`.
 */

import type { LoadedCatalogueEntry } from "./load";
import { buildProgramOverview } from "./overview";

/** A program whose file loaded: everything a card shows comes from the program's own data. */
export interface AvailableProgramCard {
  kind: "available";
  programId: string;
  name: string;
  goal: string;
  lengthWeeks: number;
  trainingDaysPerWeek: number;
  weeklyMinutes: number;
  /** True for the program the app is running now (a running app marks it "Current"). */
  isCurrent: boolean;
}

/** A program whose file failed to load or parse: shown disabled with the reason. */
export interface BrokenProgramCard {
  kind: "broken";
  programId: string;
  /** The loader's message; it already names the file. */
  error: string;
  isCurrent: boolean;
}

/** One card on the picker, in catalogue order. */
export type ProgramPickerCard = AvailableProgramCard | BrokenProgramCard;

/**
 * Builds one card per catalogue entry, in catalogue order.
 *
 * @param loadedPrograms every catalogue entry with the outcome of loading its file
 * @param activeProgramId the id of the program the app is running, or undefined when the picker is the whole app
 */
export function buildProgramPicker(loadedPrograms: LoadedCatalogueEntry[], activeProgramId: string | undefined): ProgramPickerCard[] {
  return loadedPrograms.map(({ entry, outcome }): ProgramPickerCard => {
    const isCurrent = entry.programId === activeProgramId;

    if (outcome.kind === "broken") {
      return { kind: "broken", programId: entry.programId, error: outcome.error, isCurrent };
    }

    // "No start date" is only a neutral status: just the program's own numbers are used.
    const overview = buildProgramOverview(outcome.program, { kind: "noStartDate" });
    return {
      kind: "available",
      programId: entry.programId,
      name: overview.name,
      goal: overview.goal,
      lengthWeeks: overview.lengthWeeks,
      trainingDaysPerWeek: overview.trainingDaysPerWeek,
      weeklyMinutes: overview.weeklyMinutes,
      isCurrent,
    };
  });
}

/**
 * Display names of the programs that loaded, by id. The Import card uses them
 * so its messages say "Steady Strength" instead of "steady-strength"; a program
 * that is broken has no name here and is shown by its id.
 */
export function programNamesById(loadedPrograms: LoadedCatalogueEntry[]): Record<string, string> {
  const names: Record<string, string> = {};
  for (const { entry, outcome } of loadedPrograms) {
    if (outcome.kind === "loaded") names[entry.programId] = outcome.program.name;
  }
  return names;
}
