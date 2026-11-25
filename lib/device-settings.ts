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
