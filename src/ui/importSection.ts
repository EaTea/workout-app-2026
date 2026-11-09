import "./export.css";
import { parseImport, type ImportSummary } from "../export/import";
import { applyImport } from "../export/importApply";
import { element } from "./dom";

/**
 * The "Import" card on the Settings screen, under the export card: choose a
 * JSON export file, see what it holds, confirm, and the data is replaced.
 *
 *   [Import from JSON] ─file chosen─▶ parseImport ─refused──▶ inline message
 *                                          │ ok
 *                                          ▼
 *                      preview (counts, dates, problems)
 *                      [Replace my data] [Cancel]
 *                                          │ Replace
 *                                          ▼
 *                      "This replaces ... " [Yes, replace my data] [Cancel]
 *                                          │ Yes
 *                                          ▼
 *                      applyImport(storage) ─failed──▶ inline message
 *                                          │ ok
 *                                          ▼
 *                      onImported() ─▶ app.ts reloads its state and re-renders
 *
 * Built by `renderSettingsScreen`. The pure steps live in `export/import.ts`
 * (reading) and `export/importApply.ts` (writing); this file is only the
 * screen. The state lives in the DOM below: one `status` area is rewritten
 * at each step.
 */

/** What the card needs from the app shell. */
export interface ImportSectionOptions {
  /** True while previewing another date with `?date=`: importing is turned off, like every other save. */
  isPreview: boolean;

  /** Where the data lives; `localStorage` in the app. */
  storage: Storage;

  /** Called after a successful import (the backup key is passed on) so app.ts can reload its in-memory data and redraw. */
  onImported: (backupKey: string) => void;
}

/** How many parse problems the preview lists before saying "and N more". */
const MAX_PROBLEMS_SHOWN = 5;

/** "1 session" / "3 sessions". */
function countLabel(count: number, singular: string): string {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

/** The preview's bullet lines for a file's summary. Exported for tests. */
export function summaryLines(summary: ImportSummary): string[] {
  const lines = [
    countLabel(summary.sessionCount, "session"),
    countLabel(summary.setCount, "set"),
    countLabel(summary.checkCount, "weekly check"),
  ];

  if (summary.firstSessionDate !== undefined && summary.lastSessionDate !== undefined) {
    lines.push(
      summary.firstSessionDate === summary.lastSessionDate
        ? `Date: ${summary.firstSessionDate}`
        : `Dates: ${summary.firstSessionDate} to ${summary.lastSessionDate}`,
    );
  } else {
    lines.push("No logged dates");
  }

  lines.push(summary.startDate === null ? "Start date: not set" : `Start date: ${summary.startDate}`);
  return lines;
}

/** Builds a plain button with a class and click handler. */
function actionButton(className: string, label: string, onClick: () => void): HTMLButtonElement {
  const button = element("button", className, label);
  button.type = "button";
  button.addEventListener("click", onClick);
  return button;
}

/**
 * Builds the Import card. The file input is visually hidden inside a label
 * that looks like the app's big buttons, so tapping the "button" opens the
 * file picker and keyboard focus still reaches the real input.
 */
export function renderImportSection(options: ImportSectionOptions): HTMLElement {
  const section = element("section", "card export-section import-section");
  section.append(element("h2", "card-title", "Import"));

  const fileButton = element("label", "primary-button import-file-button", "Import from JSON");
  const fileInput = element("input", "import-file-input");
  fileInput.type = "file";
  fileInput.accept = ".json,application/json";
  fileInput.disabled = options.isPreview;
  fileButton.append(fileInput);
  if (options.isPreview) {
    fileButton.classList.add("import-file-button-disabled");
  }

  const status = element("div", "import-status");
  status.setAttribute("aria-live", "polite");

  /** Shows a message for the athlete in the status area; `isError` styles it as one. */
  function showMessage(text: string, isError: boolean): void {
    const message = element("p", isError ? "import-message import-error" : "import-message", text);
    if (isError) message.setAttribute("role", "alert");
    status.replaceChildren(message);
  }

  /** Clears the status area (Cancel). */
  function clearStatus(): void {
    status.replaceChildren();
  }

  /** The second step: a plain-words warning and the confirming tap. */
  function showConfirmation(importedText: string, apply: () => void): void {
    status.replaceChildren(
      element(
        "p",
        "import-message",
        `This replaces the log, weekly checks, settings and max history on this phone with the ones in the file (${importedText}). Your current data is first kept as a backup, which the next JSON export includes.`,
      ),
      actionButton("primary-button", "Yes, replace my data", apply),
      actionButton("import-secondary-button", "Cancel", clearStatus),
    );
  }

  /** Reads the chosen file and shows the preview or the refusal. */
  async function handleFileChosen(): Promise<void> {
    const file = fileInput.files?.[0];
    if (file === undefined) return;

    let fileText: string;
    try {
      fileText = await file.text();
    } catch {
      showMessage("This file could not be read. Nothing was changed.", true);
      return;
    }

    const result = parseImport(fileText);
    if (!result.ok) {
      showMessage(result.error, true);
      return;
    }

    const preview = element("div", "import-preview");
    preview.append(element("p", "import-message", `${file.name} holds:`));
    const list = element("ul", "import-summary");
    for (const line of summaryLines(result.summary)) {
      list.append(element("li", undefined, line));
    }
    preview.append(list);

    if (result.problems.length > 0) {
      const shown = result.problems.slice(0, MAX_PROBLEMS_SHOWN);
      const hidden = result.problems.length - shown.length;
      preview.append(element("p", "import-message", "Some parts could not be read and will be left out:"));
      const problemList = element("ul", "import-problems");
      for (const problem of shown) {
        problemList.append(element("li", undefined, problem));
      }
      if (hidden > 0) {
        problemList.append(element("li", undefined, `and ${hidden} more`));
      }
      preview.append(problemList);
    }

    const importedText = `${countLabel(result.summary.sessionCount, "session")}, ${countLabel(result.summary.setCount, "set")}`;
    preview.append(
      actionButton("primary-button", "Replace my data", () => {
        showConfirmation(importedText, () => {
          const outcome = applyImport(options.storage, result.data);
          if (outcome.ok) {
            options.onImported(outcome.backupKey);
          } else {
            showMessage(outcome.error, true);
          }
        });
      }),
      actionButton("import-secondary-button", "Cancel", clearStatus),
    );
    status.replaceChildren(preview);
  }

  fileInput.addEventListener("change", () => {
    void handleFileChosen().finally(() => {
      // Allow choosing the same file again after a Cancel or an error.
      fileInput.value = "";
    });
  });

  section.append(fileButton);
  if (options.isPreview) {
    section.append(element("p", "export-note", "Import is turned off while previewing another date with ?date=."));
  }
  section.append(status);
  section.append(element("p", "export-note", "Importing replaces your data with the file's. Your current data is kept as a backup first."));
  return section;
}
