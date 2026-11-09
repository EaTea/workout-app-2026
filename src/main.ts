import "./style.css";
import { APP_TITLE, buildPlaceholderHtml } from "./placeholder";

/**
 * Application entry point: mounts the placeholder screen into #app.
 * Loaded by index.html; will later boot the real router/screens.
 */
function startApp(): void {
  const root = document.getElementById("app");
  if (!root) {
    throw new Error("Missing #app element in index.html");
  }
  root.innerHTML = buildPlaceholderHtml(APP_TITLE);
}

startApp();
