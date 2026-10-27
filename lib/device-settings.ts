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
