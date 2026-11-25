/*
 * Einstellungen je Gerät (Browser), die nicht in den SpesenKit-Bestand gehören.
 * Fehlt der Browserspeicher, gelten die Vorgaben.
 */
const ALLE_RICHTUNGEN = "spesenkit-beleg-alle-richtungen";

/** Belege automatisch in allen Richtungen lesen (langsam). Vorgabe: nur aufrecht, „gedreht lesen“ bei Bedarf. */
export function readAllDirections() {
  try { return localStorage.getItem(ALLE_RICHTUNGEN) === "1"; } catch { return false; }
}
export function setReadAllDirections(value: boolean) {
  try { if (value) localStorage.setItem(ALLE_RICHTUNGEN, "1"); else localStorage.removeItem(ALLE_RICHTUNGEN); } catch { /* nur Bequemlichkeit */ }
}

const EXPORT_TEILEN = "spesenkit-export-teilen";
/** Exporte teilen (true) oder herunterladen (false). Ohne eigene Wahl: teilen auf Geräten mit Fingerbedienung (Handy, Tablet). */
export function shareExports() {
  try {
    const stored = localStorage.getItem(EXPORT_TEILEN);
    if (stored === "1" || stored === "0") return stored === "1";
  } catch { /* Vorgabe */ }
  return touchDevice();
}
export function setShareExports(value: boolean) {
  try { localStorage.setItem(EXPORT_TEILEN, value ? "1" : "0"); } catch { /* nur Bequemlichkeit */ }
}
/** Hauptbedienung per Finger (Handy, Tablet) – am PC bleibt der Export unverändert ein Download. */
export function touchDevice() {
  try { return typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches; } catch { return false; }
}

const LETZTE_SICHERUNG = "spesenkit-letzte-sicherung";
/** Tag (JJJJ-MM-TT), an dem auf diesem Gerät zuletzt eine JSON-Sicherung erstellt wurde – für den Hinweis auf dem Handy. */
export function lastBackupDay() {
  try { const day = localStorage.getItem(LETZTE_SICHERUNG); return day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null; } catch { return null; }
}
export function markBackupDay(day: string) {
  try { localStorage.setItem(LETZTE_SICHERUNG, day); } catch { /* nur Bequemlichkeit */ }
}

/* ---------- Übergabe Handy → PC: Vermerke je Gerät (nicht Teil des SpesenKit-Bestands) ---------- */
const GERAET = "spesenkit-geraet", GESENDET = "spesenkit-uebergabe-gesendet", GESENDET_AM = "spesenkit-uebergabe-zuletzt";
/** Zufällige Kennung dieses Geräts, einmal angelegt. Steht in der Übergabe und im Protokoll am PC. */
export function deviceId() {
  try {
    let id = localStorage.getItem(GERAET);
    if (!id) { id = typeof crypto?.randomUUID === "function" ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`; localStorage.setItem(GERAET, id); }
    return id;
  } catch { return "unbekannt"; }
}
/** Kennung → Fingerabdruck der zuletzt gesendeten Fassung (lib/uebergabe.ts). */
export function sentRecords(): Record<string, string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(GESENDET) || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch { return {}; }
}
/** false, wenn der Vermerk nicht gespeichert werden konnte (dann gelten die Einträge weiter als offen – lieber doppelt senden). */
export function setSentRecords(value: Record<string, string>, at: string) {
  try { localStorage.setItem(GESENDET, JSON.stringify(value)); localStorage.setItem(GESENDET_AM, at); return true; } catch { return false; }
}
export function lastHandoff() {
  try { return localStorage.getItem(GESENDET_AM); } catch { return null; }
}
