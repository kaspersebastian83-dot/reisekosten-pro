// „Demo-Daten laden“ ersetzt den ganzen Datenstand (auch abgeschlossene Monate) und landet sofort im
// SpesenKit-Ordner. Darum gibt es den Knopf nur für Tests und Vorführungen: Er erscheint nur, wenn die
// Adresse den Schalter „?demo“ trägt (z. B. …/reisekosten-pro/?demo=1). Die Demo-Daten selbst werden erst
// beim Klick nachgeladen und stecken nicht im Hauptteil der App.
export const DEMO_SCHALTER = "demo";

export function demoErlaubt(search: string = typeof location === "undefined" ? "" : location.search): boolean {
  return new URLSearchParams(search).has(DEMO_SCHALTER);
}
