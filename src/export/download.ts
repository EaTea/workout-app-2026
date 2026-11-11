import { todayLocalDate } from "../program/calendar";

/**
 * Getting an exported file off the phone. Desktop browsers and Android
 * download straight from an `<a download>` link. iOS Safari instead opens
 * downloads in a preview, so where the Web Share API can share files we use
 * the share sheet there ("Save to Files", AirDrop, mail...).
 *
 *   saveExportFile ─▶ chooseDeliveryMethod ─┬─ "share"    ─▶ navigator.share
 *                                           │                  └ error (not Abort) ─▶ download
 *                                           └─ "download" ─▶ <a download>.click()
 */

/** How a file is handed to the user. */
export type DeliveryMethod = "share" | "download";

/** The device facts `chooseDeliveryMethod` needs, gathered by `saveExportFile`. */
export interface DeliveryEnvironment {
  /** `navigator.canShare({ files })` is true for this file. */
  canShareFiles: boolean;
  isIos: boolean;
}

/** Pure decision: share only on iOS when files can be shared; download everywhere else. */
export function chooseDeliveryMethod(environment: DeliveryEnvironment): DeliveryMethod {
  return environment.isIos && environment.canShareFiles ? "share" : "download";
}

/**
 * True for iPhone, iPad and iPod. Recent iPadOS reports itself as "MacIntel"
 * with a touch screen, hence the `maxTouchPoints` check.
 */
export function isIosPlatform(userAgent: string, platform: string, maxTouchPoints: number): boolean {
  return /iPhone|iPad|iPod/.test(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1);
}

/** The export file name, e.g. `explosive-endurance-2026-11-09.csv`, using the real local date. */
export function exportFileName(extension: "csv" | "json", now: Date = new Date()): string {
  return `explosive-endurance-${todayLocalDate(now)}.${extension}`;
}

/** Whether an error from `navigator.share` means the user simply closed the sheet. */
export function isShareCancellation(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/**
 * Hands `text` to the user as a file called `fileName`: share sheet where
 * appropriate, otherwise (or if sharing fails for any reason other than the
 * user cancelling) a normal download. Called by the Settings export buttons.
 */
export async function saveExportFile(fileName: string, text: string, mimeType: string): Promise<void> {
  const file = new File([text], fileName, { type: mimeType });

  const canShareFiles = typeof navigator.canShare === "function" && navigator.canShare({ files: [file] });
  const isIos = isIosPlatform(navigator.userAgent, navigator.platform, navigator.maxTouchPoints);

  if (chooseDeliveryMethod({ canShareFiles, isIos }) === "share") {
    try {
      await navigator.share({ files: [file], title: fileName });
      return;
    } catch (error) {
      if (isShareCancellation(error)) {
        return; // user closed the sheet: do nothing
      }
      // Any other failure: fall through to a plain download.
    }
  }

  downloadFile(file);
}

/** Triggers a browser download of `file` through a temporary `<a download>` link. */
function downloadFile(file: File): void {
  const url = URL.createObjectURL(file);

  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();

  // Give the browser a moment to start the download before releasing the blob.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
