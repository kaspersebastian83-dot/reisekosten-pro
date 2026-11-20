import { sameLocation } from "./importer";
import type { Settings, Trip } from "./types";

/*
 * Zwischenhalt an der ersten Tätigkeitsstätte oder zu Hause (Audit Lauf 3, C18 Teil 1 – nur Hinweis, Berechnung unverändert).
 *
 * Eintägig rechnet buildStatement die Abwesenheit von der ersten Abfahrt bis zur letzten Rückkehr des Tages. War man
 * dazwischen an der ersten Tätigkeitsstätte (Büro) oder zu Hause, zählt diese Zeit dort mit. Ob sie herausfällt, klärt Basti
 * mit dem Steuerbüro (offener Punkt); bis dahin nennt SpesenKit den Zwischenhalt und verlangt beim Abschluss eine
 * ausdrückliche Angabe: „Manuelle Abwesenheit (Min.)“ an einer Reise dieses Tages (vorhandenes Feld, kein neues Datenformat).
 */
export interface Zwischenhalt { von: string; bis: string; ort: "erste Tätigkeitsstätte" | "Wohnung" }

const aktiv = (t: Trip) => t.status !== "storniert";
const eintaegig = (t: Trip, date: string) => t.date === date && (!t.endDate || t.endDate === date);
const minuten = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + (m || 0); };
export const dauerText = (min: number) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;

function ortVon(t: Trip, settings: Settings): Zwischenhalt["ort"] | null {
  if (t.tripType === "erste Tätigkeitsstätte" || (settings.firstWorkplace && sameLocation(t.destination, settings.firstWorkplace))) return "erste Tätigkeitsstätte";
  if (settings.homeAddress && sameLocation(t.destination, settings.homeAddress)) return "Wohnung";
  return null;
}

/** Zwischenhalte eines Tages zwischen zwei Dienstfahrten. Leer bei mehrtägigen Reisen, Übernachtung oder manueller Abwesenheit. */
export function zwischenhalte(trips: Trip[], date: string, settings: Settings): Zwischenhalt[] {
  const tag = trips.filter((t) => aktiv(t) && (t.date === date || (t.endDate || t.date) === date || (t.date < date && (t.endDate || t.date) > date)));
  const dienst = tag.filter((t) => t.tripType === "dienstlich");
  if (dienst.length < 2 || dienst.some((t) => !eintaegig(t, date) || t.overnight || t.manualAbsenceMinutes != null)) return [];
  const mitZeit = tag.filter((t) => eintaegig(t, date) && /^\d{1,2}:\d{2}/.test(t.startTime) && /^\d{1,2}:\d{2}/.test(t.endTime));
  const ergebnis: Zwischenhalt[] = [];
  for (const t of mitZeit) {
    const ort = ortVon(t, settings);
    if (!ort) continue;
    const e = minuten(t.endTime);
    const vorher = dienst.some((d) => mitZeit.includes(d) && minuten(d.startTime) < e);
    const weiter = mitZeit.filter((d) => d !== t && minuten(d.startTime) >= e).sort((a, b) => minuten(a.startTime) - minuten(b.startTime));
    if (!vorher || !weiter.some((d) => d.tripType === "dienstlich")) continue;
    const bis = weiter[0].startTime.slice(0, 5);
    if (minuten(bis) > e) ergebnis.push({ von: t.endTime.slice(0, 5), bis, ort });
  }
  return ergebnis.sort((a, b) => a.von.localeCompare(b.von)).filter((z, i, l) => !i || z.von !== l[i - 1].von);
}

/** Hinweistext für die Tageszeile und den Abschluss. absence = automatisch gerechnete Abwesenheit (Minuten). */
export function zwischenhaltText(halte: Zwischenhalt[], absence: number) {
  const pause = halte.reduce((s, z) => s + minuten(z.bis) - minuten(z.von), 0);
  const orte = [...new Set(halte.map((z) => z.ort === "Wohnung" ? "zu Hause" : "an der ersten Tätigkeitsstätte"))].join(" bzw. ");
  return `Zwischenhalt ${orte} (${halte.map((z) => `${z.von}–${z.bis}`).join(", ")}): Diese Zeit zählt in der Berechnung noch als Abwesenheit (${dauerText(absence)} Std.; ohne sie ${dauerText(Math.max(0, absence - pause))} Std.). Bitte an einer Reise dieses Tages unter „Weitere Angaben“ die „Manuelle Abwesenheit (Min.)“ eintragen – auch wenn die angezeigte Dauer stimmt.`;
}
