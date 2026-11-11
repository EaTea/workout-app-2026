import "./style.css";
import { loadCatalogue, loadProgram } from "./program/load";
import { loadLog } from "./log/storage";
import { loadFatigueHistory } from "./fatigue/storage";
import { loadSettings } from "./settings/storage";
import { registerServiceWorker } from "./pwa/register";
import { showStartupError, startApp } from "./ui/app";

/**
 * Application entry point (loaded by index.html): loads programs.json, then the
 * first program it lists (program.json today), loads saved settings, the workout log and the weekly check-ins, then hands them (plus any unknown-field warnings) to the app shell. If program.json
 * can't be loaded or parsed, the error is shown on screen so Ed can see what
 * broke.
 */
async function main(): Promise<void> {
  const root = document.getElementById("app");
  if (!root) {
    throw new Error("Missing #app element in index.html");
  }

  try {
    // The active program is the first catalogue entry for now; choosing between programs comes later.
    const catalogue = await loadCatalogue();
    const { program, warnings } = await loadProgram(catalogue.entries[0]!.programUrl);
    startApp(root, program, loadSettings(), warnings, loadLog(localStorage), loadFatigueHistory(localStorage));
  } catch (error) {
    showStartupError(root, error);
  }
}

registerServiceWorker();
void main();
