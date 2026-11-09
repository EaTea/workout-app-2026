import "./style.css";
import { loadProgram } from "./program/load";
import { loadLog } from "./log/storage";
import { loadSettings } from "./settings/storage";
import { showStartupError, startApp } from "./ui/app";

/**
 * Application entry point (loaded by index.html): loads program.json once,
 * loads saved settings and the workout log, then hands them (plus any unknown-field warnings) to the app shell. If program.json
 * can't be loaded or parsed, the error is shown on screen so Ed can see what
 * broke.
 */
async function main(): Promise<void> {
  const root = document.getElementById("app");
  if (!root) {
    throw new Error("Missing #app element in index.html");
  }

  try {
    const { program, warnings } = await loadProgram();
    startApp(root, program, loadSettings(), warnings, loadLog(localStorage));
  } catch (error) {
    showStartupError(root, error);
  }
}

void main();
