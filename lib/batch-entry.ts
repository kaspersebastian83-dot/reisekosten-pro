import type { Expense, Trip } from "./types";

/*
 * Stapelerfassung („Speichern & nächste“): Vorbelegung des nächsten Entwurfs aus dem gerade gespeicherten.
 * Übernommen wird nur, was sich innerhalb eines Stapels typischerweise wiederholt; alles Inhaltliche bleibt leer,
 * damit nichts unbemerkt doppelt erfasst wird. Rechnet nichts und ändert keine gespeicherten Daten.
 */

/** Tag nach dem angegebenen Datum (YYYY-MM-DD), kalendersicher über Monats- und Jahreswechsel. */
export function dayAfter(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Nächste Reise: Datum = Tag nach dem Ende der vorigen, Fahrzeug, Startort und Uhrzeiten bleiben. */
export function nextTripDraft(previous: Trip, blank: Trip): Trip {
  const date = dayAfter(previous.endDate || previous.date);
  return {
    ...blank,
    date,
    endDate: date,
    startTime: previous.startTime || blank.startTime,
    endTime: previous.endTime || blank.endTime,
    startPlace: previous.startPlace,
    vehicleId: previous.vehicleId,
    vehicle: previous.vehicle,
    plate: previous.plate,
    vehicleType: previous.vehicleType,
  };
}

/** Nächste Kostenposition: Datum, Zahlungsart und Reise-/Projektbezug bleiben; Betrag, Beschreibung und Beleg sind leer. */
export function nextExpenseDraft(previous: Expense, blank: Expense): Expense {
  return {
    ...blank,
    date: previous.date,
    paymentType: previous.paymentType,
    paidBy: previous.paidBy,
    tripId: previous.tripId,
    projectNumber: previous.projectNumber,
  };
}
