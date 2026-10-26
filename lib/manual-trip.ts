import type { Trip } from './types';

export function projectPlace(project: string) {
  return project.trim().match(/^\d{2}\.\d{4}\s+(.+)$/)?.[1] || '';
}

export function projectSuggestions(trips: Trip[]) {
  return [...new Set(trips.map(t => t.order.trim()).filter(projectPlace))].sort((a,b) => a.localeCompare(b, 'de'));
}

// Explicit return date: a reversed clock must never silently become tomorrow.
export function manualTripInterval(trip: Trip) {
  const endDate = trip.endDate || trip.date;
  const validDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) &&
    !Number.isNaN(Date.parse(v)) && new Date(v + 'T12:00:00Z').toISOString().slice(0,10) === v;
  const validTime = (v: string) => /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(v);
  if (!validDate(trip.date) || !validDate(endDate) || !validTime(trip.startTime) || !validTime(trip.endTime)) return null;
  const start = new Date(`${trip.date}T${trip.startTime}`);
  const end = new Date(`${endDate}T${trip.endTime}`);
  const minutes = Math.ceil((end.getTime() - start.getTime()) / 60000);
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  const nights = Math.round((Date.parse(endDate) - Date.parse(trip.date)) / 86400000);
  return { minutes, nights };
}

export function manualTripErrors(trip: Trip, originalProject?: string) {
  const errors: string[] = [];
  // Legacy/imported project references remain editable without rewriting them.
  if (!projectPlace(trip.order) && (originalProject === undefined || trip.order !== originalProject)) errors.push('Projekt im Format 26.0123 Musterstadt angeben.');
  if (!trip.purpose.trim()) errors.push('Reisegrund fehlt.');
  if (!trip.destination.trim()) errors.push('Reiseziel fehlt.');
  const interval = manualTripInterval(trip);
  if (!interval) errors.push('Abfahrt und Rückkehr vollständig angeben. Die Rückkehr muss nach der Abfahrt liegen; bei Tagwechsel das Rückkehrdatum ändern.');
  if (interval && interval.nights > 59) errors.push('Mehr als 60 Reisetage: Reise bitte in prüfbare Abschnitte aufteilen.');
  if (interval && !interval.nights && trip.overnight) errors.push('Übernachtung passt nicht zu den Reisedaten.');
  return errors;
}

export function manualTripReviewNotes(trip: Trip) {
  const notes = ['Inlandsvorschau nach gespeicherten Regeln. Ausland, erste Tätigkeitsstätte und Dreimonatsfrist bei Wiederholungseinsätzen sind nicht automatisch steuerlich geprüft.'];
  if (manualTripInterval(trip)?.nights === 1 && !trip.overnight) notes.push('Über Mitternacht ohne bestätigte Übernachtung: eine Tagespauschale für die ganze Reise, wenn insgesamt mehr als 8 Stunden – angesetzt am Kalendertag mit dem überwiegenden Teil (§ 9 Abs. 4a Satz 3 Nr. 3 EStG). Falls auswärts übernachtet wurde, oben bestätigen; dann gelten An- und Abreisetag.');
  else if (manualTripInterval(trip)?.nights && !trip.overnight) notes.push('Datumswechsel ohne bestätigte auswärtige Übernachtungen: Die bestehende Tagesberechnung setzt An-/Abreisetage an. Anspruch und Tagesaufteilung vor Abrechnung gesondert prüfen.');
  if (trip.manualAbsenceMinutes != null) notes.push('Vorhandene manuelle Abwesenheitskorrektur wirkt auf die Tagesberechnung. Unter Weitere Angaben prüfen.');
  return notes;
}
