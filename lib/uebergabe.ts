/*
 * Übergabe Handy → PC („An den PC senden“ / „Vom Handy übernehmen“).
 *
 * Auf dem Handy liegen die Spesen nur im Browser. Bisher führte der einzige Weg zum PC über die vollständige
 * JSON-Sicherung, deren Wiederherstellung den Bestand am PC ERSETZT. Die Übergabe ist der zweite, gefahrlose Weg:
 * Das Handy schreibt Reisen, Kosten und Belege in EINE Datei; der PC fügt sie hinzu und ersetzt nichts.
 *
 * Regeln beim Übernehmen (uebernehmen):
 *   neue Kennung                    → hinzugefügt; Reisen und Kosten kommen als „ungeprüft“ an
 *   gleiche Kennung, gleicher Inhalt → übersprungen (doppelt senden schadet nicht)
 *   gleiche Kennung, anderer Inhalt → der vorhandene Eintrag am PC bleibt; die Abweichung wird gemeldet
 *   andere Kennung, sieht gleich aus → hinzugefügt und als möglicher doppelter Eintrag gemeldet (nie still verworfen)
 *   Beleg-Eingang mit vorhandenem Belegbild → übersprungen (dasselbe Foto)
 *   Beleg-Eingang, auf dem Handy inzwischen zu Kosten geworden → am PC als erledigt vermerkt (einzige Änderung an Vorhandenem)
 *   Fahrzeuge                       → Zuordnung über Kennung, dann Kennzeichen, dann Name + Art; sonst neu angelegt
 *   Löschungen                      → werden nicht übertragen
 * Abgeschlossene Monate bleiben eingefroren; betroffene Monate werden genannt (Korrektur über eine neue Version).
 *
 * Nicht übertragen werden Einstellungen, Tarife, Abrechnungen, Regeln und das Änderungsprotokoll – gerechnet und
 * abgeschlossen wird am PC. Das SpesenKit-Speicherformat (spesenkit.json) ändert sich nicht.
 */
import { duplicateKey } from "./calculations";
import { latestStatement } from "./month-navigation";
import { FILE_ID, receiptFileId } from "./receipt-images";
import { duplicateExpense, similarExpense } from "./receipt-linking";
import { isClosedStatement, stableValue } from "./statement-comparison";
import { normalizeState } from "./storage";
import type { AppState, ChangeLog, Expense, ReceiptInboxItem, Trip, VehicleProfile } from "./types";

export const UEBERGABE_FORMAT = "spesenkit-uebergabe";
export const UEBERGABE_VERSION = 1;

export class UebergabeFehler extends Error {}

export interface Uebergabe {
  erstellt: string;
  app?: string;
  /** Zufällige Kennung des sendenden Geräts (nur zur Anzeige im Bericht und Protokoll). */
  geraet: string;
  trips: Trip[];
  expenses: Expense[];
  receiptInbox: ReceiptInboxItem[];
  /** Nur die Fahrzeuge, auf die Reisen und Kosten dieser Datei verweisen. */
  vehicles: VehicleProfile[];
  /** Belegbilder: Fingerabdruck → Daten-URL. */
  belege: Record<string, string>;
}

export interface UebergabeAuswahl { trips: Trip[]; expenses: Expense[]; receiptInbox: ReceiptInboxItem[] }

/* ---------- Handy: was ist offen, was wurde gesendet ---------- */

/** Kurzer Vergleichswert eines Eintrags (FNV-1a über den inhaltlich sortierten Text). Kein Sicherheitsmerkmal –
 *  er zeigt nur, ob sich ein Eintrag seit dem Senden geändert hat. */
export function fingerabdruck(record: unknown) {
  const text = stableValue(record);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 0x01000193); }
  return `${text.length.toString(36)}-${(hash >>> 0).toString(36)}`;
}

/** Stand „gesendet“ je Gerät: Kennung → Fingerabdruck beim Senden. Gehört nicht in den SpesenKit-Bestand. */
export type Gesendet = Record<string, string>;

const eintraege = (state: Pick<AppState, "trips" | "expenses" | "receiptInbox">): UebergabeAuswahl =>
  ({ trips: state.trips, expenses: state.expenses, receiptInbox: state.receiptInbox });

/** Noch nicht gesendete oder seit dem Senden geänderte Einträge. */
export function offeneEintraege(state: Pick<AppState, "trips" | "expenses" | "receiptInbox">, gesendet: Gesendet): UebergabeAuswahl {
  const offen = <T extends { id: string }>(items: T[]) => items.filter((item) => gesendet[item.id] !== fingerabdruck(item));
  const alle = eintraege(state);
  return { trips: offen(alle.trips), expenses: offen(alle.expenses), receiptInbox: offen(alle.receiptInbox) };
}
export const anzahl = (auswahl: UebergabeAuswahl) => auswahl.trips.length + auswahl.expenses.length + auswahl.receiptInbox.length;

/** Nach dem Senden: die gesendeten Einträge mit ihrem Stand vermerken. Kennungen, die es nicht mehr gibt, entfallen. */
export function alsGesendetVermerken(state: Pick<AppState, "trips" | "expenses" | "receiptInbox">, gesendet: Gesendet, auswahl: UebergabeAuswahl): Gesendet {
  const vorhanden = new Set([...state.trips, ...state.expenses, ...state.receiptInbox].map((item) => item.id));
  const next: Gesendet = Object.fromEntries(Object.entries(gesendet).filter(([id]) => vorhanden.has(id)));
  for (const item of [...auswahl.trips, ...auswahl.expenses, ...auswahl.receiptInbox]) next[item.id] = fingerabdruck(item);
  return next;
}

/** Fingerabdrücke der Belegbilder, die zu einer Auswahl gehören. */
export function belegeDerAuswahl(auswahl: UebergabeAuswahl) {
  const ids = new Set<string>();
  for (const item of [...auswahl.expenses, ...auswahl.receiptInbox]) if (item.receipt?.fileId && FILE_ID.test(item.receipt.fileId)) ids.add(item.receipt.fileId);
  return [...ids];
}

/* ---------- Datei schreiben und lesen ---------- */

export const uebergabeDateiname = (now: Date) => {
  const z = (n: number) => String(n).padStart(2, "0");
  return `SpesenKit-Uebergabe_${now.getFullYear()}-${z(now.getMonth() + 1)}-${z(now.getDate())}_${z(now.getHours())}${z(now.getMinutes())}.txt`;
};

export function uebergabeText(state: AppState, auswahl: UebergabeAuswahl, belege: Record<string, string>, meta: { erstellt: string; geraet: string; app?: string }) {
  const genutzt = new Set([...auswahl.trips, ...auswahl.expenses].map((item) => item.vehicleId).filter(Boolean));
  const ohneBild = <T extends { receipt?: { dataUrl: string } }>(item: T): T => item.receipt?.dataUrl ? { ...item, receipt: { ...item.receipt, dataUrl: "" } } : item;
  return JSON.stringify({
    format: UEBERGABE_FORMAT, version: UEBERGABE_VERSION, erstellt: meta.erstellt, ...(meta.app ? { app: meta.app } : {}), geraet: meta.geraet,
    trips: auswahl.trips, expenses: auswahl.expenses.map(ohneBild), receiptInbox: auswahl.receiptInbox.map(ohneBild),
    vehicles: (state.settings.vehicles || []).filter((vehicle) => genutzt.has(vehicle.id)),
    belege,
  });
}

const TAG = /^\d{4}-\d{2}-\d{2}$/;
const text = (value: unknown): value is string => typeof value === "string";

export function uebergabeLesen(inhalt: string): Uebergabe {
  let value: unknown;
  try { value = JSON.parse(inhalt.replace(/^﻿/, "")); } catch { throw new UebergabeFehler("Die Datei ist keine SpesenKit-Übergabe (kein lesbarer Inhalt)."); }
  const v = value as Record<string, unknown>;
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new UebergabeFehler("Die Datei ist keine SpesenKit-Übergabe.");
  if (v.format === "spesenkit-buerokasse-sicherung") throw new UebergabeFehler("Das ist eine Sicherung der Bürokasse. Bitte dort „Vom Handy übernehmen“ verwenden.");
  if (v.format !== UEBERGABE_FORMAT) throw new UebergabeFehler(Array.isArray(v.trips) && v.settings ? "Das ist eine vollständige JSON-Sicherung, keine Übergabe vom Handy. Eine Sicherung ersetzt den Bestand – bitte nur über „Sicherung wiederherstellen“ einspielen." : "Die Datei ist keine SpesenKit-Übergabe.");
  if (typeof v.version !== "number" || v.version > UEBERGABE_VERSION) throw new UebergabeFehler("Die Übergabe stammt aus einer neueren SpesenKit-Version. Bitte SpesenKit am PC aktualisieren und erneut übernehmen.");
  if (v.version !== UEBERGABE_VERSION || !Array.isArray(v.trips) || !Array.isArray(v.expenses) || !Array.isArray(v.receiptInbox)) throw new UebergabeFehler("Die Übergabe ist unvollständig und wurde nicht übernommen.");
  const vehicles = Array.isArray(v.vehicles) ? v.vehicles as VehicleProfile[] : [];
  let geprueft: AppState;
  try {
    // Dieselbe Prüfung wie beim Einlesen einer Sicherung; eingebettete Bilder werden dabei herausgelöst.
    geprueft = normalizeState({ trips: v.trips as Trip[], expenses: v.expenses as Expense[], receiptInbox: v.receiptInbox as ReceiptInboxItem[],
      settings: { vehicles } as AppState["settings"] });
  } catch { throw new UebergabeFehler("Die Übergabe enthält einen ungültigen Eintrag und wurde nicht übernommen."); }
  const alle = [...geprueft.trips, ...geprueft.expenses, ...geprueft.receiptInbox];
  if (alle.some((item) => !text(item.id) || !item.id) || new Set(alle.map((item) => item.id)).size !== alle.length
    || [...geprueft.trips, ...geprueft.expenses].some((item) => !TAG.test(item.date))
    || vehicles.some((vehicle) => !vehicle || !text(vehicle.id) || !text(vehicle.name) || !text(vehicle.plate) || !["dienstwagen", "privatwagen"].includes(vehicle.ownership)))
    throw new UebergabeFehler("Die Übergabe enthält einen ungültigen Eintrag und wurde nicht übernommen.");
  const belege: Record<string, string> = {};
  if (v.belege && typeof v.belege === "object" && !Array.isArray(v.belege))
    // Nur Bilder, deren Inhalt zum Fingerabdruck passt: Eine beschädigte oder veränderte Datei darf kein fremdes Bild unter
    // den Verweis eines Belegs legen. Ein verworfenes Bild meldet uebernehmen() als fehlend.
    for (const [id, url] of Object.entries(v.belege as Record<string, unknown>)) if (FILE_ID.test(id) && text(url) && receiptFileId(url) === id) belege[id] = url;
  return { erstellt: text(v.erstellt) ? v.erstellt : "", app: text(v.app) ? v.app : undefined, geraet: text(v.geraet) ? v.geraet : "",
    // Fahrzeugverweise bleiben, wie das Handy sie gesendet hat – die Zuordnung zu den Fahrzeugen am PC macht uebernehmen().
    trips: (v.trips as Trip[]).map((trip, index) => ({ ...geprueft.trips[index], vehicleId: trip.vehicleId })),
    expenses: (v.expenses as Expense[]).map((expense, index) => ({ ...geprueft.expenses[index], vehicleId: expense.vehicleId })),
    receiptInbox: geprueft.receiptInbox, vehicles, belege };
}

/* ---------- PC: übernehmen ---------- */

export interface UebernahmeBericht {
  neu: { trips: number; expenses: number; receiptInbox: number };
  /** Einträge, die es am PC schon gibt (gleiche Kennung bzw. dasselbe Belegfoto im Eingang). */
  vorhanden: number;
  /** Belege im Eingang am PC, die als erledigt vermerkt wurden, weil das Handy sie inzwischen als Kosten gesendet hat. */
  eingangErledigt: number;
  /** Gleiche Kennung, anderer Inhalt: der Eintrag am PC bleibt. */
  abweichungen: string[];
  /** Andere Kennung, sieht aus wie ein vorhandener Eintrag: hinzugefügt, bitte prüfen. */
  doppelt: string[];
  /** Neu angelegte Fahrzeuge. */
  fahrzeugeNeu: VehicleProfile[];
  /** Sonstige Hinweise (Fahrzeug mit anderer Erstattungsart, gelöste Reise-Zuordnung, fehlendes Belegbild). */
  hinweise: string[];
  /** Monate, die am PC abgeschlossen sind und neue Einträge bekommen haben. */
  geschlosseneMonate: string[];
  /** Belegbilder aus der Datei, die zu neuen Einträgen gehören (Fingerabdruck → Daten-URL) – vom Aufrufer zu speichern. */
  belege: Record<string, string>;
}
export interface Uebernahme { state: AppState; bericht: UebernahmeBericht; geaendert: boolean }

const BEZEICHNUNG: Record<string, string> = { date: "Datum", endDate: "Rückkehr Datum", startTime: "Abfahrt", endTime: "Rückkehr", startPlace: "Abfahrtsort", destination: "Reiseziel",
  purpose: "Reisegrund", order: "Projekt", businessKm: "Dienstliche Kilometer", privateKm: "Private Kilometer", vehicleId: "Fahrzeug", meals: "Mahlzeiten", dailyMeals: "Mahlzeiten je Tag",
  overnight: "Übernachtung", manualAbsenceMinutes: "Manuelle Abwesenheit", absenceConfirmed: "Abwesenheit bestätigt", notes: "Notiz", category: "Kategorie", description: "Beschreibung",
  gross: "Brutto", net: "Netto", vat: "Steuer", vatRate: "Steuersatz", currency: "Währung", exchangeRate: "Kurs", paymentType: "Zahlungsart", merchant: "Händler", invoiceNumber: "Rechnungsnummer",
  tripId: "Reise-Zuordnung", receipt: "Beleg", projectNumber: "Projekt", businessShare: "Dienstlicher Anteil", reimbursementStatus: "Erstattung", tripType: "Reiseart" };
/** Für den Vergleich unerheblich: Prüfstatus und Hinweise ändern sich am PC, ohne dass der Eintrag ein anderer wird. */
const OHNE = new Set(["status", "warnings", "importedAt"]);
const datumDe = (day: string) => day.split("-").reverse().join(".");
const vergleichbar = (record: object) => Object.fromEntries(Object.entries(record).filter(([key, value]) => !OHNE.has(key) && value !== undefined)
  .map(([key, value]) => [key, key === "receipt" && value && typeof value === "object" ? { ...(value as object), dataUrl: "" } : value]));
function unterschiede(lokal: object, eingang: object) {
  const a = vergleichbar(lokal) as Record<string, unknown>, b = vergleichbar(eingang) as Record<string, unknown>;
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((key) => stableValue(a[key] ?? null) !== stableValue(b[key] ?? null)).map((key) => BEZEICHNUNG[key] || key);
}
const reiseName = (trip: Trip) => `Reise ${datumDe(trip.date)} · ${trip.destination || trip.purpose || trip.id}`;
const kostenName = (expense: Expense) => `Kosten ${datumDe(expense.date)} · ${expense.description || expense.merchant || expense.category || expense.id}`;
const gleich = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const kennzeichen = (plate: string) => plate.replace(/[\s-]+/g, "").toLowerCase();

/**
 * Fügt eine Übergabe in den Bestand am PC ein. Reine Funktion: ändert weder `local` noch `eingang`.
 * ctx liefert Kennung und Zeit für den Protokolleintrag; `nutzer` steht dort als Bearbeiter.
 */
export function uebernehmen(local: AppState, eingang: Uebergabe, ctx: { id: string; at: string; nutzer?: string }): Uebernahme {
  const bericht: UebernahmeBericht = { neu: { trips: 0, expenses: 0, receiptInbox: 0 }, vorhanden: 0, eingangErledigt: 0, abweichungen: [], doppelt: [], fahrzeugeNeu: [], hinweise: [], geschlosseneMonate: [], belege: {} };

  // Fahrzeuge: Kennung → Kennzeichen → Name + Art → neu
  const vehicles = [...(local.settings.vehicles || [])];
  const zuordnung = new Map<string, string>();
  for (const vehicle of eingang.vehicles) {
    const treffer = vehicles.find((v) => v.id === vehicle.id)
      || (kennzeichen(vehicle.plate) ? vehicles.find((v) => kennzeichen(v.plate) === kennzeichen(vehicle.plate)) : undefined)
      || vehicles.find((v) => v.ownership === vehicle.ownership && gleich(v.name, vehicle.name));
    if (!treffer) { vehicles.push(structuredClone(vehicle)); bericht.fahrzeugeNeu.push(vehicle); zuordnung.set(vehicle.id, vehicle.id); continue; }
    zuordnung.set(vehicle.id, treffer.id);
    if (treffer.ownership !== vehicle.ownership || treffer.reimbursementMethod !== vehicle.reimbursementMethod)
      bericht.hinweise.push(`Fahrzeug „${vehicle.name}“ ist am PC anders eingestellt (${treffer.ownership === "privatwagen" ? "Privatwagen" : "Dienstwagen"}, Erstattung: ${treffer.reimbursementMethod}) als auf dem Handy (${vehicle.ownership === "privatwagen" ? "Privatwagen" : "Dienstwagen"}, ${vehicle.reimbursementMethod}). Es gilt die Einstellung am PC – bitte die Kilometererstattung prüfen.`);
  }
  const mitFahrzeug = <T extends { vehicleId?: string }>(item: T): T => item.vehicleId && zuordnung.has(item.vehicleId) && zuordnung.get(item.vehicleId) !== item.vehicleId ? { ...item, vehicleId: zuordnung.get(item.vehicleId) } : item;
  const ankunft = <T extends { status: Trip["status"] }>(item: T): T => item.status === "storniert" ? item : { ...item, status: "ungeprüft" };

  // Reisen
  const trips = [...local.trips];
  const tripById = new Map(trips.map((trip) => [trip.id, trip]));
  for (const original of eingang.trips) {
    const trip = mitFahrzeug(original);
    const da = tripById.get(trip.id);
    if (da) {
      bericht.vorhanden++;
      const felder = unterschiede(da, trip);
      if (felder.length) bericht.abweichungen.push(`${reiseName(da)}: weicht ab (${felder.join(", ")}) – der vorhandene Eintrag bleibt.`);
      continue;
    }
    // gegen den wachsenden Bestand: auch zwei gleiche Reisen in derselben Datei werden gemeldet
    if (trip.status !== "storniert" && trips.some((other) => other.status !== "storniert" && duplicateKey(other) === duplicateKey(trip))) bericht.doppelt.push(`${reiseName(trip)}: sieht aus wie eine vorhandene Reise – bitte prüfen.`);
    if (trip.vehicleId && !vehicles.some((v) => v.id === trip.vehicleId)) bericht.hinweise.push(`${reiseName(trip)}: Das Fahrzeug ist am PC nicht bekannt – bitte in der Reise wählen.`);
    const neu = ankunft(trip);
    trips.push(neu); tripById.set(neu.id, neu); bericht.neu.trips++;
  }

  // Kosten
  const expenses = [...local.expenses];
  const expenseById = new Map(expenses.map((expense) => [expense.id, expense]));
  const neueBelege = new Set<string>();
  for (const original of eingang.expenses) {
    let expense = mitFahrzeug(original);
    const da = expenseById.get(expense.id);
    if (da) {
      bericht.vorhanden++;
      const felder = unterschiede(da, expense);
      if (felder.length) bericht.abweichungen.push(`${kostenName(da)}: weicht ab (${felder.join(", ")}) – der vorhandene Eintrag bleibt.`);
      continue;
    }
    if (expense.tripId && !tripById.has(expense.tripId)) {
      bericht.hinweise.push(`${kostenName(expense)}: Die zugeordnete Reise ist am PC nicht vorhanden – die Zuordnung wurde gelöst.`);
      const { tripId: _geloest, ...ohne } = expense; expense = ohne as Expense;
    }
    const aktiv = expenses.filter((e) => e.status !== "storniert");   // wachsender Bestand, siehe Reisen
    if (expense.status !== "storniert" && (duplicateExpense(aktiv, expense) || similarExpense(aktiv, expense)))
      bericht.doppelt.push(`${kostenName(expense)}: sieht aus wie ein vorhandener Beleg – bitte prüfen.`);
    const neu = ankunft(expense);
    expenses.push(neu); expenseById.set(neu.id, neu); bericht.neu.expenses++;
    if (neu.receipt?.fileId) neueBelege.add(neu.receipt.fileId);
  }

  // Beleg-Eingang: gleiche Kennung oder dasselbe Foto (Fingerabdruck) ist schon da
  const receiptInbox = [...local.receiptInbox];
  const fotos = new Set([...receiptInbox.map((item) => item.receipt.hash), ...expenses.map((expense) => expense.receipt?.hash)].filter(Boolean));
  for (const item of eingang.receiptInbox) {
    const index = receiptInbox.findIndex((other) => other.id === item.id);
    if (index >= 0) {
      // Gleiche Kennung: Wurde der Beleg auf dem Handy inzwischen zu einer Kostenposition, die jetzt am PC ist, gilt er auch
      // hier als erledigt – sonst läge dasselbe Foto am PC weiter zur Bearbeitung im Eingang und würde doppelt erfasst.
      const da = receiptInbox[index];
      bericht.vorhanden++;
      if (item.expenseId && expenseById.has(item.expenseId) && da.expenseId !== item.expenseId) {
        if (!da.expenseId && (da.status === "neu" || da.status === "erkannt")) {
          receiptInbox[index] = { ...da, expenseId: item.expenseId, status: item.status === "archiviert" ? "archiviert" : "zugeordnet", ...(item.tripId && tripById.has(item.tripId) ? { tripId: item.tripId } : {}) };
          bericht.eingangErledigt++;
        } else bericht.abweichungen.push(`Beleg im Eingang „${da.receipt.name}“: auf dem Handy und am PC unterschiedlich verarbeitet – der Stand am PC bleibt. Bitte auf doppelte Kosten prüfen.`);
      }
      continue;
    }
    if (item.receipt.hash && fotos.has(item.receipt.hash)) { bericht.vorhanden++; continue; }
    const { tripId, expenseId, ...rest } = item;
    // Verweise auf Reise/Kosten nur behalten, wenn es sie am PC gibt
    const neu: ReceiptInboxItem = { ...rest, ...(tripId && tripById.has(tripId) ? { tripId } : {}), ...(expenseId && expenseById.has(expenseId) ? { expenseId } : {}) };
    receiptInbox.push(neu); if (neu.receipt.hash) fotos.add(neu.receipt.hash); bericht.neu.receiptInbox++;
    if (neu.receipt.fileId) neueBelege.add(neu.receipt.fileId);
  }

  for (const fileId of neueBelege) {
    if (eingang.belege[fileId]) bericht.belege[fileId] = eingang.belege[fileId];
    else bericht.hinweise.push(`Ein Belegbild fehlt in der Übergabe (${fileId.slice(0, 8)}…). Bitte auf dem Handy „Alles erneut senden“.`);
  }

  // Abgeschlossene Monate, die neue Einträge bekommen haben
  const monate = new Set<string>();
  // jede berührte Monatsabrechnung, auch die Monate zwischen Abfahrt und Rückkehr einer langen Reise
  for (const trip of trips.slice(local.trips.length)) {
    const ende = (trip.endDate && trip.endDate > trip.date ? trip.endDate : trip.date).slice(0, 7);
    for (let [jahr, monat] = trip.date.slice(0, 7).split("-").map(Number), schritt = 0; schritt < 120; schritt++) {
      const month = `${jahr}-${String(monat).padStart(2, "0")}`;
      monate.add(month);
      if (month >= ende) break;
      if (++monat > 12) { monat = 1; jahr++; }
    }
  }
  for (const expense of expenses.slice(local.expenses.length)) monate.add(expense.date.slice(0, 7));
  bericht.geschlosseneMonate = [...monate].filter((month) => { const snapshot = latestStatement(local, month); return !!snapshot && isClosedStatement(snapshot); }).sort();

  const anzahlNeu = bericht.neu.trips + bericht.neu.expenses + bericht.neu.receiptInbox;
  const geaendert = anzahlNeu > 0 || bericht.fahrzeugeNeu.length > 0 || bericht.eingangErledigt > 0;
  if (!geaendert) return { state: local, bericht, geaendert };
  const eintrag: ChangeLog = { id: ctx.id, entityType: "settings", entityId: "uebergabe", field: "Vom Handy übernommen", oldValue: null,
    newValue: { ...bericht.neu, vorhanden: bericht.vorhanden, eingangErledigt: bericht.eingangErledigt, abweichungen: bericht.abweichungen.length, fahrzeugeNeu: bericht.fahrzeugeNeu.map((v) => v.name), geraet: eingang.geraet, erstellt: eingang.erstellt },
    reason: berichtKurz(bericht), user: ctx.nutzer || local.settings.profileName || "", changedAt: ctx.at };
  return { geaendert, bericht,
    state: { ...local, trips, expenses, receiptInbox, settings: bericht.fahrzeugeNeu.length ? { ...local.settings, vehicles } : local.settings, changes: [eintrag, ...local.changes] } };
}

const mehrzahl = (n: number, eins: string, viele: string) => `${n} ${n === 1 ? eins : viele}`;
/** Eine Zeile für Meldung und Protokoll. */
export function berichtKurz(bericht: UebernahmeBericht) {
  const teile = [bericht.neu.trips && mehrzahl(bericht.neu.trips, "Reise", "Reisen"), bericht.neu.expenses && mehrzahl(bericht.neu.expenses, "Kostenposition", "Kostenpositionen"),
    bericht.neu.receiptInbox && mehrzahl(bericht.neu.receiptInbox, "Beleg im Eingang", "Belege im Eingang")].filter(Boolean) as string[];
  const neu = teile.length ? `Vom Handy übernommen: ${teile.join(", ")}.` : "Nichts Neues – alle Einträge sind schon am PC.";
  return [neu, bericht.vorhanden ? `${mehrzahl(bericht.vorhanden, "Eintrag war", "Einträge waren")} schon vorhanden.` : "",
    bericht.eingangErledigt ? `${mehrzahl(bericht.eingangErledigt, "Beleg im Eingang", "Belege im Eingang")} als erledigt vermerkt.` : "",
    bericht.abweichungen.length ? `${mehrzahl(bericht.abweichungen.length, "Abweichung", "Abweichungen")} – der Stand am PC bleibt.` : ""].filter(Boolean).join(" ");
}
