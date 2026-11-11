import { loadFatigueHistory, type FatigueStorage } from "../fatigue/storage";
import { listCorruptLogBackups, loadLog, type KeyListingStorage, type LogStorage } from "../log/storage";
import { loadSettings } from "../settings/storage";
import type { ExportSource } from "../ui/exportSection";

/**
 * Reads everything an export needs straight from storage, at the moment the
 * export button is tapped. The in-memory copies in app.ts can be stale (the
 * app may be open in two tabs, or a save may have failed), and an export is
 * the athlete's safety copy, so it reflects what is stored right now.
 *
 *   tap ──▶ readExportSource(localStorage) ──▶ ExportSource ──▶ logToCsv / exportToWire
 *
 * Called by app.ts through `renderSettingsScreen`'s export source callback.
 */

/** Storage as `readExportSource` needs it: reads, and key listing for the backups. */
export type ExportReadStorage = KeyListingStorage & LogStorage & FatigueStorage & Storage;

/**
 * Wraps `storage` so reads work but writes are refused. `loadLog` and
 * `loadFatigueHistory` copy unreadable text to a new backup key as a side
 * effect; an export must not create more backups on every tap, so those
 * writes are blocked (the readable data is still returned).
 */
function readOnlyView(storage: ExportReadStorage): ExportReadStorage {
  return new Proxy(storage, {
    get(target, property) {
      if (property === "setItem") {
        return () => {
          throw new Error("read-only export view");
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/** Reads settings, log, fatigue checks and corrupt-log backups fresh from `storage`. Never throws. */
export function readExportSource(storage: ExportReadStorage): ExportSource {
  const readOnlyStorage = readOnlyView(storage);

  return {
    settings: loadSettings(readOnlyStorage),
    log: loadLog(readOnlyStorage).log,
    fatigueHistory: loadFatigueHistory(readOnlyStorage).history,
    corruptLogBackups: listCorruptLogBackups(readOnlyStorage),
  };
}
