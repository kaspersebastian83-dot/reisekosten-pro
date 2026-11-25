import { describe, expect, it } from 'vitest';
import { buildStatement, overnightUnconfirmed } from '../lib/calculations';
import { emptyState } from '../lib/config';
import { demoState } from '../lib/demo';
import { closingPreview } from '../lib/statement-closing';
import type { AppState, Trip } from '../lib/types';

// Mehrtägige Reise ohne bestätigte Übernachtung: An-/Abreisetag gibt es nur mit Übernachtung (§ 9 Abs. 4a Satz 3 Nr. 2 EStG).
// Die Berechnung bleibt unverändert; der Abschluss verlangt die Bestätigung oder eine Aufteilung in einzelne Tage.
const month = '2026-11';
let n = 0;
const reise = (o: Partial<Trip>): Trip => ({ ...demoState().trips[0], id: `u${++n}`, date: '2026-11-10', endDate: '2026-11-12', startTime: '15:00', endTime: '09:00',
  startPlace: 'Würselen', destination: 'Hamburg', purpose: 'Ortstermin', order: '26.0123 Hamburg', businessKm: 0, privateKm: 0, tripType: 'dienstlich', status: 'geprüft',
  absenceConfirmed: true, overnight: false, meals: { breakfast: false, lunch: false, dinner: false }, dailyMeals: undefined, warnings: [], manualAbsenceMinutes: undefined, ...o });
const zustand = (...trips: Trip[]): AppState => ({ ...structuredClone(emptyState), trips });
const fehler = (s: AppState) => closingPreview(s, month).errors.filter(e => e.code === 'overnight');
const pauschalen = (s: AppState) => buildStatement(s, month).rows.map(r => r.allowanceAfter);

describe('Mehrtägige Reise ohne bestätigte Übernachtung', () => {
  it('zwei Datumswechsel ohne Haken: eine Meldung je Reise, Abschluss gesperrt – Berechnung wie bisher', () => {
    const s = zustand(reise({}));
    expect(pauschalen(s)).toEqual([14, 28, 14]);   // unverändert
    const e = fehler(s);
    expect(e).toHaveLength(1);
    expect(e[0].target).toEqual({ kind: 'trip', id: s.trips[0].id });
    expect(e[0].message).toMatch(/^Reise 2026-11-10 · Hamburg: Mehrtägige Reise ohne bestätigte auswärtige Übernachtung .*\(und volle Zwischentage\).*einzelne Tage aufteilen\.$/);
  });
  it('mit bestätigter Übernachtung ist der Abschluss frei', () => {
    const s = zustand(reise({ overnight: true }));
    expect(fehler(s)).toEqual([]);
    expect(pauschalen(s)).toEqual([14, 28, 14]);
  });
  it('ein Datumswechsel ohne Übernachtung: Mitternachtsregel greift, keine Meldung', () => {
    const s = zustand(reise({ endDate: '2026-11-11', startTime: '18:00', endTime: '05:00' }));
    expect(overnightUnconfirmed(s.trips[0])).toBe(false);
    expect(fehler(s)).toEqual([]);
    expect(pauschalen(s)).toEqual([14, 0]);   // 11 Std., überwiegend am Abfahrtstag
  });
  it('ein Datumswechsel mit manueller Abwesenheit: Mitternachtsregel greift nicht → Meldung nennt die manuelle Abwesenheit', () => {
    const s = zustand(reise({ endDate: '2026-11-11', startTime: '18:00', endTime: '05:00', manualAbsenceMinutes: 300 }));
    expect(pauschalen(s)).toEqual([14, 14]);   // unverändert: An- und Abreisetag
    expect(fehler(s)).toHaveLength(1);
    expect(fehler(s)[0].message).toMatch(/An- und Abreisetag, die es nur mit Übernachtung gibt.*„Manuelle Abwesenheit \(Min\.\)“ entfernen/);
    expect(fehler(s)[0].message).not.toMatch(/Zwischentage/);
  });
  it('keine Meldung: eintägig, storniert, nicht dienstlich', () => {
    for (const o of [{ endDate: '2026-11-10', startTime: '07:00', endTime: '18:00' }, { status: 'storniert' as const }, { tripType: 'privat' as const }])
      expect(fehler(zustand(reise(o)))).toEqual([]);
  });
});
