/**
 * Wire type: the exact JSON shape of `public/programs.json`, the catalogue
 * of programs the app can run.
 *
 * Only `catalogue.ts` may import this (CLAUDE.md section 6); the rest of the
 * app uses `ProgramCatalogue`.
 *
 *   programs.json --(fetch)--> CatalogueWire --parseCatalogue()--> ProgramCatalogue
 */

/** One catalogue entry as written in programs.json. */
export interface CatalogueEntryWire {
  /** Stable program id, e.g. "explosive-endurance". Storage keys are built from it. */
  id: string;
  /** Plain file name of the program, next to programs.json, e.g. "program.json". */
  file: string;
}

/** The whole programs.json file. */
export interface CatalogueWire {
  programs: CatalogueEntryWire[];
}
