import { describe, expect, it } from 'vitest';
import { buildStatement } from '../lib/calculations';
import { emptyState } from '../lib/config';
import { demoState } from '../lib/demo';
import { buildAnnualAnalysis } from '../lib/annual-reports';
import type { Expense, Trip } from '../lib/types';

const trip = (extra: Partial<Trip> = {}): Trip => ({
  ...demoState().trips[0], id: 'annual-trip', date: '2026-03-10', endDate: '2026-03-12',
  startTime: '08:00', endTime: '17:00', tripType: 'dienstlich', status: 'geprüft',
  absenceConfirmed: true, businessKm: 0, order: '26.0123 Musterstadt', customer: 'Kunde unabhängig vom Projekt',
  warnings: [], ...extra,
});
const expense = (extra: Partial<Expense> = {}): Expense => ({
  ...demoState().expenses[0], id: 'annual-expense', date: '2026-03-11', category: 'Hotel', gross: 100,
  net: 100, vat: 0, paymentType: 'privat vorgestreckt', reimbursementStatus: 'offen', businessShare: 100,
  exchangeRate: 1, projectNumber: '26.0123', tripId: 'annual-trip', status: 'geprüft', warnings: [], receipt: undefined,
  ...extra,
});
const fresh = () => structuredClone(emptyState);

describe('Jahresauswertungen aus Monatsberechnungen', () => {
  it('ist rein lesend und liefert immer zwölf Monate in Kalenderreihenfolge', () => {
    const state = fresh();
    const before = structuredClone(state);
    const result = buildAnnualAnalysis(state, 2026);
    expect(result.months.map(item => item.month)).toEqual(Array.from({ length: 12 }, (_, index) => `2026-${String(index + 1).padStart(2, '0')}`));
    expect(result.months.map(item => item.label)).toEqual(['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember']);
    expect(state).toEqual(before);
    expect(result.totals.grandTotal).toBe(0);
    expect(result.projects).toEqual([]);
    expect(result.unassignedProjectCosts).toBe(0);
  });

  it('summiert Jahreswerte exakt aus den zwölf bestehenden buildStatement-Ergebnissen', () => {
    const state = fresh();
    state.trips = [trip()]; state.expenses = [expense()];
    const result = buildAnnualAnalysis(state, 2026);
    const sums = Array.from({ length: 12 }, (_, index) => buildStatement(state, `2026-${String(index + 1).padStart(2, '0')}`).totals);
    expect(result.totals.allowance).toBeCloseTo(sums.reduce((value, month) => value + month.allowance, 0), 2);
    expect(result.totals.grandTotal).toBeCloseTo(sums.reduce((value, month) => value + month.grandTotal, 0), 2);
    expect(result.totals.openAmount).toBeCloseTo(sums.reduce((value, month) => value + month.openAmount, 0), 2);
  });

  it('zählt mehrtägige Reisen nur einmal und Reisetage einzeln', () => {
    const state = fresh(); state.trips = [trip()];
    const result = buildAnnualAnalysis(state, 2026);
    expect(result.tripCount).toBe(1);
    expect(result.travelDayCount).toBe(3);
    expect(result.entryMonthCount).toBe(1);
  });

  it('berücksichtigt eine Reise über den Jahreswechsel in beiden Jahren, ohne doppelte Reisenzählung', () => {
    const state = fresh(); state.trips = [trip({ date: '2025-12-31', endDate: '2026-01-02', order: '26.0123 Musterstadt', businessKm: 120 })];
    const current = buildAnnualAnalysis(state, 2026); const prior = buildAnnualAnalysis(state, 2025);
    expect(current.tripCount).toBe(1); expect(current.travelDayCount).toBe(2);
    expect(prior.tripCount).toBe(1); expect(prior.travelDayCount).toBe(1);
    expect(current.months[0].statement.rows.map(row => row.date)).toEqual(['2026-01-01', '2026-01-02']);
    expect(prior.businessKm).toBe(120);
    expect(current.businessKm).toBe(0);
  });

  it('belässt Rechnungen im Belegdatum-Monat, auch wenn die Reise im Vormonat liegt', () => {
    const state = fresh(); state.trips = [trip({ date: '2026-02-27', endDate: '2026-03-01' })];
    state.expenses = [expense({ date: '2026-03-02', tripId: 'annual-trip' })];
    expect(buildAnnualAnalysis(state, 2026).months[1].statement.totals.accommodation).toBe(0);
    expect(buildAnnualAnalysis(state, 2026).months[2].statement.totals.accommodation).toBe(100);
  });

  it('zählt ausschließlich nicht stornierte Einträge und nur dienstliche Reisen', () => {
    const state = fresh(); state.trips = [trip(), trip({ id: 'cancelled-trip', status: 'storniert' }), trip({ id: 'private-trip', tripType: 'privat' })];
    state.expenses = [expense(), expense({ id: 'cancelled-expense', status: 'storniert', date: '2026-05-01' })];
    const result = buildAnnualAnalysis(state, 2026);
    expect(result.tripCount).toBe(1);
    expect(result.entryMonthCount).toBe(1);
    expect(result.totals.accommodation).toBe(100);
  });

  it('hält private Ausgaben, Firmenzahlungen, Erstattungen und unbekannte Zahlungsarten getrennt', () => {
    const state = fresh(); state.expenses = [
      expense({ id: 'private-open', gross: 100, paymentType: 'privat vorgestreckt', reimbursementStatus: 'offen' }),
      expense({ id: 'private-paid-back', gross: 40, paymentType: 'privat vorgestreckt', reimbursementStatus: 'erstattet' }),
      expense({ id: 'company', gross: 70, paymentType: 'Unternehmen', reimbursementStatus: 'nicht erstattungsfähig' }),
      expense({ id: 'card', gross: 30, paymentType: 'Firmenkarte', reimbursementStatus: 'nicht erstattungsfähig' }),
      expense({ id: 'unknown', gross: 25, paymentType: 'unbekannt', reimbursementStatus: 'offen' }),
    ];
    const result = buildAnnualAnalysis(state, 2026);
    expect(result.totals.privatelyAdvanced).toBe(140);
    expect(result.totals.companyPaid).toBe(100);
    expect(result.totals.reimbursed).toBe(40);
    expect(result.totals.unknownPayment).toBe(25);
    expect(result.totals.openAmount).toBe(100);
  });

  it('ordnet Kosten einem Projekt anhand der bestehenden Projektnummer zu, nicht anhand des Kunden', () => {
    const state = fresh(); state.trips = [trip()]; state.expenses = [expense()];
    const result = buildAnnualAnalysis(state, 2026);
    expect(result.projects).toEqual([{ key: '26.0123', label: '26.0123 Musterstadt', amount: result.totals.grandTotal }]);
    expect(result.projects[0].label).not.toContain('Kunde unabhängig');
    expect(result.unassignedProjectCosts).toBe(0);
  });

  it('ordnet Tagespauschalen bei mehreren Projekten am selben Tag nicht mehrfach zu', () => {
    const state = fresh(); state.trips = [trip(), trip({ id: 'second-project', order: '26.0145 Köln', startTime: '09:00', endTime: '18:00' })];
    const result = buildAnnualAnalysis(state, 2026);
    expect(result.unassignedProjectCosts).toBe(result.totals.allowance);
    expect(result.projects).toEqual([]);
    expect(result.tripCount).toBe(2);
  });

  it('ordnet einen gemeinsamen Tagesbetrag nur zu, wenn alle Reisen dasselbe bekannte Projekt tragen', () => {
    const state = fresh(); state.trips = [trip(), trip({ id: 'same-project', startTime: '09:00', endTime: '18:00' })];
    const result = buildAnnualAnalysis(state, 2026);
    expect(result.projects.reduce((sum, project) => sum + project.amount, 0)).toBe(result.totals.grandTotal);
    expect(result.unassignedProjectCosts).toBe(0);
  });

  it('rundet Kilometerbeiträge je Projekt und Tag wie die Monatsabrechnung und weist Centreste transparent aus', () => {
    const state = fresh();
    state.trips = [
      trip({ id: 'mileage-a', date: '2026-03-10', endDate: '2026-03-10', startTime: '08:00', endTime: '12:00', businessKm: 1.25, vehicleId: 'vehicle-private-default', vehicleType: 'privatfahrzeug', order: '26.0123 Musterstadt' }),
      trip({ id: 'mileage-b', date: '2026-03-10', endDate: '2026-03-10', startTime: '13:00', endTime: '17:00', businessKm: 1.25, vehicleId: 'vehicle-private-default', vehicleType: 'privatfahrzeug', order: '26.0145 Köln' }),
    ];

    const result = buildAnnualAnalysis(state, 2026);
    const march = result.months[2].statement;

    expect(march.rows[0].contributions?.mileage.map(item => item.amount)).toEqual([0.375, 0.375]);
    expect(march.rows[0].mileage).toBe(0.75);
    expect(march.totals.mileage).toBe(0.75);
    expect(result.projects.map(project => project.amount)).toEqual([0.38, 0.38]);
    expect(result.projectRoundingAdjustment).toBe(-0.01);
    expect(result.projects.reduce((sum, project) => sum + project.amount, 0) + result.unassignedProjectCosts + result.projectRoundingAdjustment).toBe(result.totals.grandTotal);
  });

  it('rundet mehrere Kilometerbeiträge desselben Projekts gemeinsam statt jeden Fahrtanteil einzeln', () => {
    const state = fresh();
    state.trips = [
      trip({ id: 'mileage-a', date: '2026-03-10', endDate: '2026-03-10', startTime: '08:00', endTime: '12:00', businessKm: 1.25, vehicleId: 'vehicle-private-default', vehicleType: 'privatfahrzeug' }),
      trip({ id: 'mileage-b', date: '2026-03-10', endDate: '2026-03-10', startTime: '13:00', endTime: '17:00', businessKm: 1.25, vehicleId: 'vehicle-private-default', vehicleType: 'privatfahrzeug' }),
    ];

    const result = buildAnnualAnalysis(state, 2026);

    expect(result.months[2].statement.totals.mileage).toBe(0.75);
    expect(result.projects.find(project => project.key === '26.0123')?.amount).toBe(result.totals.allowance + 0.75);
    expect(result.projectRoundingAdjustment).toBe(0);
  });

  it('zeigt Reisen ohne eindeutige Projektnummer als nicht zugeordnet', () => {
    const state = fresh(); state.trips = [trip({ order: '' })];
    const result = buildAnnualAnalysis(state, 2026);
    expect(result.projects).toEqual([]);
    expect(result.unassignedProjectCosts).toBe(result.totals.grandTotal);
  });

  it('ordnet einen Beleg nicht zu, wenn Projektfeld und verknüpfte Reise widersprechen', () => {
    const state = fresh(); state.trips = [trip()];
    state.expenses = [expense({ projectNumber: '26.0145', tripId: 'annual-trip' })];
    const result = buildAnnualAnalysis(state, 2026);
    expect(result.unassignedProjectCosts).toBe(100);
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0].amount).toBe(result.totals.allowance);
  });

  it('weist nicht zugeordnete Projektkosten aus, ohne Gleichverteilung oder Schätzung', () => {
    const state = fresh(); state.expenses = [expense({ tripId: undefined, projectNumber: undefined, gross: 55 })];
    const result = buildAnnualAnalysis(state, 2026);
    expect(result.projects).toEqual([]);
    expect(result.unassignedProjectCosts).toBe(55);
    expect(result.unassignedProjectCosts).toBe(result.totals.grandTotal);
  });

  it('schließt firmenwagen-Tankkosten, die bestehende Monatsrechnung ausschließt, aus Summen und Projekten aus', () => {
    const state = fresh(); state.trips = [trip()];
    state.trips[0].vehicleType = 'privatfahrzeug';
    state.expenses = [expense({ category: 'Tanken', gross: 60, projectNumber: '26.0123', tripId: 'annual-trip' })];
    const result = buildAnnualAnalysis(state, 2026);
    expect(result.totals.fuel).toBe(0);
    expect(result.projects.reduce((sum, project) => sum + project.amount, 0) + result.unassignedProjectCosts).toBe(result.totals.grandTotal);
  });

  it('zählt Monate mit ausschließlich Ausgaben und historische Abschlüsse nur über gespeicherte gesperrte Abrechnungen', () => {
    const state = fresh(); state.expenses = [expense({ tripId: undefined, date: '2026-11-04', gross: 12 })];
    state.statements = [{ id: 'locked', month: '2026-11', number: 'SYN-1', createdAt: '2026-12-01', status: 'freigegeben', version: 1, locked: true, data: buildStatement(state, '2026-11') }];
    const before = structuredClone(state.statements);
    const result = buildAnnualAnalysis(state, 2026);
    expect(result.entryMonthCount).toBe(1);
    expect(result.closedMonthCount).toBe(1);
    expect(state.statements).toEqual(before);
  });

  it('verändert keine gespeicherten abgeschlossenen Snapshots', () => {
    const state = fresh(); state.trips = [trip()];
    state.statements = [{ id: 'locked', month: '2026-03', number: 'SYN-1', createdAt: '2026-04-01', status: 'freigegeben', version: 1, locked: true, data: buildStatement(state, '2026-03') }];
    const before = structuredClone(state.statements);
    buildAnnualAnalysis(state, 2026);
    expect(state.statements).toEqual(before);
  });
});

describe('Jahresauswertung in Euro (1.8.6)', () => {
  it('Fremdwährung: Projektaufteilung passt zur Jahressumme', () => {
    const state = fresh(); state.trips = [trip()];
    state.expenses = [expense({ currency: 'CHF', gross: 100, net: 100, exchangeRate: 0.95 })];
    const result = buildAnnualAnalysis(state, 2026);
    expect(result.totals.accommodation).toBe(95);
    const project = result.projects.find(item => item.label.includes('26.0123'));
    expect(project?.amount).toBe(Math.round((95 + (result.totals.allowance || 0) + (result.totals.mileage || 0)) * 100) / 100);
  });
});
