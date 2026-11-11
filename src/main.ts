import "./style.css";
import { loadAllPrograms, loadCatalogue } from "./program/load";
import { buildProgramPicker } from "./program/picker";
import { chooseStartup, hasSavedProgramData, loadActiveProgramId } from "./storage/activeProgram";
import { storageKeysForProgram } from "./storage/programKeys";
import { VERSION_1_PROGRAM_ID } from "./export/wire";
import { loadLog } from "./log/storage";
import { loadFatigueHistory } from "./fatigue/storage";
import { loadSettings } from "./settings/storage";
import { registerServiceWorker } from "./pwa/register";
import { showStartupError, startApp } from "./ui/app";
import { showProgramPicker } from "./ui/programPicker";

/**
 * Application entry point (loaded by index.html). Startup, in order:
 *
 *   programs.json ─▶ every listed program file (in parallel; a bad one only
 *   marks its own entry "broken") ─▶ chooseStartup ─┬─▶ run a program: build its storage
 *                                                   │     keys, load settings, log and
 *                                                   │     check-ins, hand all to startApp
 *                                                   ├─▶ broken choice: error card + "Switch program"
 *                                                   └─▶ picker as the whole app
 *
 * What to open is decided by `chooseStartup` from the stored choice and from
 * whether Explosive Endurance already holds data (so an existing phone is
 * unchanged). Nothing is written here; the picker saves the choice. If
 * programs.json itself can't be loaded, the error is shown on screen so Ed can
 * see what broke.
 */
async function main(): Promise<void> {
  const root = document.getElementById("app");
  if (!root) {
    throw new Error("Missing #app element in index.html");
  }

  try {
    const catalogue = await loadCatalogue();
    const loadedPrograms = await loadAllPrograms(catalogue);

    const storedProgramId = loadActiveProgramId(localStorage);
    const hasExplosiveEnduranceData = hasSavedProgramData(localStorage, storageKeysForProgram(VERSION_1_PROGRAM_ID));
    const startup = chooseStartup(loadedPrograms, storedProgramId, hasExplosiveEnduranceData);

    if (startup.kind === "picker") {
      showProgramPicker(root, buildProgramPicker(loadedPrograms, undefined));
      return;
    }

    if (startup.kind === "broken") {
      // The chosen program's file is broken: say so, and let the athlete pick another program.
      showStartupError(root, startup.error, () => showProgramPicker(root, buildProgramPicker(loadedPrograms, startup.programId)));
      return;
    }

    const activeProgram = loadedPrograms.find((candidate) => candidate.entry.programId === startup.programId);
    if (activeProgram === undefined || activeProgram.outcome.kind !== "loaded") {
      throw new Error(`Program ${startup.programId} is not loaded`); // chooseStartup only returns "run" for a loaded program
    }

    const storageKeys = storageKeysForProgram(startup.programId);
    startApp(
      root,
      activeProgram.outcome.program,
      storageKeys,
      loadSettings(localStorage, storageKeys),
      activeProgram.outcome.warnings,
      loadLog(localStorage, storageKeys),
      loadFatigueHistory(localStorage, storageKeys),
      loadedPrograms,
    );
  } catch (error) {
    showStartupError(root, error);
  }
}

registerServiceWorker();
void main();
