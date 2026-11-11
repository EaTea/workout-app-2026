import "./style.css";
import { loadCatalogue, loadProgram } from "./program/load";
import { chooseCatalogueEntry, loadActiveProgramId } from "./storage/activeProgram";
import { storageKeysForProgram } from "./storage/programKeys";
import { loadLog } from "./log/storage";
import { loadFatigueHistory } from "./fatigue/storage";
import { loadSettings } from "./settings/storage";
import { registerServiceWorker } from "./pwa/register";
import { showStartupError, startApp } from "./ui/app";

/**
 * Application entry point (loaded by index.html): loads programs.json, then the
 * active program (the stored choice if the catalogue has it, else the first
 * entry), builds that program's storage keys, loads saved settings, the workout log and the weekly check-ins, then hands them (plus any unknown-field warnings) to the app shell. If program.json
 * can't be loaded or parsed, the error is shown on screen so Ed can see what
 * broke.
 */
async function main(): Promise<void> {
  const root = document.getElementById("app");
  if (!root) {
    throw new Error("Missing #app element in index.html");
  }

  try {
    // The stored choice wins when the catalogue still has it; nothing is written here (choosing a program comes later).
    const catalogue = await loadCatalogue();
    const activeEntry = chooseCatalogueEntry(catalogue, loadActiveProgramId(localStorage));
    const storageKeys = storageKeysForProgram(activeEntry.programId);

    const { program, warnings } = await loadProgram(activeEntry.programUrl);
    startApp(
      root,
      program,
      storageKeys,
      loadSettings(localStorage, storageKeys),
      warnings,
      loadLog(localStorage, storageKeys),
      loadFatigueHistory(localStorage, storageKeys),
    );
  } catch (error) {
    showStartupError(root, error);
  }
}

registerServiceWorker();
void main();
