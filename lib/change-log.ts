import type { AppState, ChangeLog } from "./types";

/*
 * Änderungsprotokoll ohne Belegbilder: Ein Eintrag hält fest, was sich geändert hat. Das Belegbild selbst
 * steht beim Beleg; im Protokoll bleibt der Beleg über Name, Größe, Typ und Fingerabdruck (SHA-256) erkennbar.
 * Vorher speicherte jede Bearbeitung einer Kostenposition das Bild zweimal (alt und neu) – auf dem Handy füllte
 * das den Browserspeicher schnell. Format unverändert: „dataUrl“ bleibt ein Text, im Protokoll nur leer.
 */
const isFatDataUrl = (key: string, value: unknown) => key === "dataUrl" && typeof value === "string" && value.length > 0;

function hasData(value: unknown, depth = 0): boolean {
  if (!value || typeof value !== "object" || depth > 8) return false;
  if (Array.isArray(value)) return value.some((item) => hasData(item, depth + 1));
  return Object.entries(value as Record<string, unknown>).some(([key, item]) => isFatDataUrl(key, item) || hasData(item, depth + 1));
}

function slim(value: unknown, depth = 0): unknown {
  if (!value || typeof value !== "object" || depth > 8) return value;
  if (Array.isArray(value)) return value.map((item) => slim(item, depth + 1));
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, isFatDataUrl(key, item) ? "" : slim(item, depth + 1)]));
}

export const changeHasReceiptData = (change: ChangeLog) => hasData(change.oldValue) || hasData(change.newValue);

/** Gleiche Referenz zurück, wenn nichts zu verschlanken ist (kein unnötiges Speichern). */
export function slimChangeLog(state: AppState): AppState {
  if (!state.changes.some(changeHasReceiptData)) return state;
  return {
    ...state,
    changes: state.changes.map((change) => changeHasReceiptData(change) ? { ...change, oldValue: slim(change.oldValue), newValue: slim(change.newValue) } : change),
  };
}
