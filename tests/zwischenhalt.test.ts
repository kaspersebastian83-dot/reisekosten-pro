import { describe, expect, it } from 'vitest';
import { buildStatement } from '../lib/calculations';
import { emptyState } from '../lib/config';
import { demoState } from '../lib/demo';
import { closingPreview } from '../lib/statement-closing';
import { zwischenhalte } from '../lib/zwischenhalt';
import type { AppState, Trip } from '../lib/types';

// Audit Lauf 3, C18 Teil 1: Zwischenhalt an der ersten Tätigkeitsstätte / zu Hause → Hinweis und Pflichtangabe beim Abschluss.
// Die Berechnung selbst bleibt unverändert (offener Punkt bis zur Bestätigung durch das Steuerbüro).
const month = '2026-11', date = '2026-11-10';
let n = 0;
const fahrt = (o: Partial<Trip>): Trip => ({ ...demoState().trips[0], id: `t${++n}`, date, endDate: date, startTime: '07:00', endTime: '10:00', startPlace: 'Zuhause', destination: 'Köln',
  purpose: 'Ortstermin', order: '26.0123 Köln', businessKm: 10, privateKm: 0, tripType: 'dienstlich', status: 'geprüft', absenceConfirmed: true, overnight: false,
  meals: { breakfast: false, lunch: false, dinner: false }, warnings: [], manualAbsenceMinutes: undefined, ...o });
function zustand(trips: Trip[]): AppState {
  const s = structuredClone(emptyState);
  s.settings = { ...s.settings, firstWorkplace: 'Gouleystraße 59, 52146 Würselen', homeAddress: 'Am Hang 3, 52146 Würselen' };
  s.trips = trips; return s;
}
const buero = [
  fahrt({ startTime: '07:00', endTime: '10:00', destination: 'Köln' }),
  fahrt({ startTime: '10:00', endTime: '10:45', startPlace: 'Köln', destination: 'Gouleystraße 59, 52146 Würselen', tripType: 'erste Tätigkeitsstätte', businessKm: 0 }),
  fahrt({ startTime: '16:00', endTime: '19:00', startPlace: 'Gouleystraße 59, 52146 Würselen', destination: 'Düren' }),
];
const fehler = (s: AppState) => closingPreview(s, month).errors.filter(e => e.code === 'zwischenhalt');

describe('Zwischenhalt im Büro oder zu Hause (C18 Teil 1)', () => {
  it('nennt den Zwischenhalt und verlangt eine Angabe – die Berechnung bleibt wie bisher', () => {
    const s = zustand(structuredClone(buero));
    expect(zwischenhalte(s.trips, date, s.settings)).toEqual([{ von: '10:45', bis: '16:00', ort: 'erste Tätigkeitsstätte' }]);
    const e = fehler(s);
    expect(e).toHaveLength(1);
    expect(e[0].message).toMatch(/^Reise 2026-11-10 · Köln: Zwischenhalt an der ersten Tätigkeitsstätte \(10:45–16:00\): .*\(12:00 Std\.; ohne sie 6:45 Std\.\)/);
    const row = buildStatement(s, month).rows[0];
    expect([row.absenceMinutes, row.allowanceAfter]).toEqual([720, 14]);   // unverändert
  });
  it('mit „Manuelle Abwesenheit (Min.)“ an einer Reise des Tages ist der Abschluss frei – die Angabe wirkt wie bisher', () => {
    const s = zustand(structuredClone(buero)); s.trips[2].manualAbsenceMinutes = 405;
    expect(fehler(s)).toEqual([]);
    expect(buildStatement(s, month).rows[0].allowanceAfter).toBe(0);
  });
  it('Ziel = erste Tätigkeitsstätte laut Einstellungen oder Wohnadresse zählt auch bei Fahrtart „dienstlich“', () => {
    const s = zustand([fahrt({ startTime: '07:00', endTime: '11:00' }), fahrt({ startTime: '11:00', endTime: '11:30', destination: 'Am Hang 3, 52146 Würselen' }), fahrt({ startTime: '13:00', endTime: '17:30', startPlace: 'Am Hang 3', destination: 'Aachen' })]);
    expect(zwischenhalte(s.trips, date, s.settings)).toEqual([{ von: '11:30', bis: '13:00', ort: 'Wohnung' }]);
    expect(fehler(s)).toHaveLength(1);
  });
  it('kein Hinweis: Rückkehr ins Büro erst am Tagesende, keine Pauschale, mehrtägige Reise, kein Ort hinterlegt', () => {
    expect(fehler(zustand([fahrt({ startTime: '07:00', endTime: '12:00' }), fahrt({ startTime: '12:00', endTime: '17:00', startPlace: 'Köln', destination: 'Düren' }), fahrt({ startTime: '17:00', endTime: '17:45', destination: 'Gouleystraße 59, Würselen', tripType: 'erste Tätigkeitsstätte' })]))).toEqual([]);
    const kurz = structuredClone(buero); kurz[2] = { ...kurz[2], startTime: '16:00', endTime: '16:30' };   // 9:30 Std. → Pauschale
    expect(fehler(zustand(kurz))).toHaveLength(1);
    const knapp = structuredClone(buero); knapp[0] = { ...knapp[0], startTime: '09:00' }; knapp[2] = { ...knapp[2], endTime: '16:30' };   // 7:30 Std. → keine Pauschale
    expect(fehler(zustand(knapp))).toEqual([]);
    const mehr = structuredClone(buero); mehr[2] = { ...mehr[2], endDate: '2026-11-11', overnight: true };
    expect(fehler(zustand(mehr))).toEqual([]);
    const s = zustand(structuredClone(buero)); s.settings.firstWorkplace = ''; s.trips[1].tripType = 'dienstlich';
    expect(fehler(s)).toEqual([]);
  });
});
