import { describe, expect, it, vi } from 'vitest';
import { buildStatement } from '../lib/calculations';
import { emptyState } from '../lib/config';
import { demoState } from '../lib/demo';
import { normalizeState } from '../lib/storage';
import { monthOverview, openActivityMonths } from '../lib/month-navigation';
import { buildAnnualAnalysis } from '../lib/annual-reports';
import { checkStatementForClosing, closeStatement, changeStatementStatus } from '../lib/statement-closing';
import { compareClosedStatementWithCurrent, createCorrectionDraft, persistCorrectionDraft, relatedTripsForSnapshot, stateForStatementVersion } from '../lib/statement-comparison';
import type { AppState, Expense, StatementSnapshot, Trip } from '../lib/types';

const month = '2026-06';
const audit = { id: 'correction-2', changeId: 'create-2', at: '2026-10-18T12:00:00Z' };
const trip = (extra: Partial<Trip> = {}): Trip => ({ ...demoState().trips[0], id: 'synthetic-trip', date: '2026-06-10', endDate: '2026-06-10', startTime: '08:00', endTime: '17:00', tripType: 'dienstlich', status: 'geprüft', absenceConfirmed: true, overnight: false, businessKm: 0, privateKm: 0, order: '26.0123 Musterstadt', purpose: 'Synthetischer Termin', destination: 'Musterstadt', warnings: [], meals: { breakfast: false, lunch: false, dinner: false }, dailyMeals: {}, ...extra });
const expense = (extra: Partial<Expense> = {}): Expense => ({ ...demoState().expenses[0], id: 'synthetic-hotel', date: '2026-06-10', category: 'Hotel', description: 'Synthetisches Hotel A', gross: 100, net: 100, vat: 0, vatRate: 0, currency: 'EUR', exchangeRate: 1, businessShare: 100, paymentType: 'privat vorgestreckt', reimbursementStatus: 'offen', tripId: 'synthetic-trip', projectNumber: '26.0123', status: 'geprüft', warnings: [], receipt: { id: 'synthetic-file', name: 'synthetic.pdf', type: 'application/pdf', size: 9, hash: 'synthetic-hash', dataUrl: 'data:application/pdf;base64,U1lOVEhFVElD' }, ...extra });
function capture(state: AppState, target = month, extra: Partial<StatementSnapshot> = {}) {
  const data = structuredClone(buildStatement(state, target));
  const snapshot: StatementSnapshot = { id: `closed-${target}`, month: target, number: `SYN-${target}`, version: 1, createdAt: '2026-07-01T10:00:00Z', status: 'freigegeben', locked: true, data, settingsSnapshot: structuredClone(state.settings), expensesSnapshot: structuredClone(state.expenses.filter(item => item.date.startsWith(target))), relatedTripsSnapshot: relatedTripsForSnapshot(state, data), ...extra };
  state.statements.push(snapshot); return snapshot;
}
function fixture() { const state = structuredClone(emptyState); state.trips = [trip()]; state.expenses = [expense()]; capture(state); return state; }
const compare = (state: AppState, target = month) => compareClosedStatementWithCurrent(state, target);
const confirm = (state: AppState) => { const draft = state.statements.at(-1)!; const check = checkStatementForClosing(state, month, draft); return { month, snapshotId: draft.id, fingerprint: check.fingerprint, reviewed: true, warningsAccepted: true }; };

describe('Monatsspezifischer Vergleich historischer Abschlüsse', () => {
  it('bleibt ohne Änderungen grün, ist rein lesend und meldet keine Differenz', () => {
    const state = fixture(); const before = structuredClone(state); const result = compare(state);
    expect(result.hasChanges).toBe(false); expect(result.limitations).toEqual([]); expect(result.deltas?.personal).toBe(0);
    expect(monthOverview(state, month).status).toBe('closed'); expect(state).toEqual(before);
  });
  it('erkennt eine neue Hotelrechnung als +120 EUR, ohne eine Restzahlung zu erfinden', () => {
    const state = fixture(); state.expenses.push(expense({ id: 'late-hotel', gross: 120, description: 'Synthetische Ergänzung' }));
    const result = compare(state); expect(result.hasChanges).toBe(true); expect(result.changes.some(item => item.kind === 'added')).toBe(true);
    expect(result.deltas).toMatchObject({ accommodation: 120, grandTotal: 120, personal: 120 });
    expect(result).not.toHaveProperty('remainingPayment'); expect(monthOverview(state, month).status).toBe('closed-changed');
  });
  it('erkennt eine zusätzliche Reise und bewahrt den historischen Stand', () => {
    const state = fixture(); const before = structuredClone(state.statements); state.trips.push(trip({ id: 'new-trip', date: '2026-06-12', endDate: '2026-06-12' }));
    expect(compare(state).changes.some(item => item.kind === 'added' && item.label.includes('Dienstreise'))).toBe(true); expect(state.statements).toEqual(before);
  });
  it.each([
    ['Reisezeit', (state: AppState) => { state.trips[0].startTime = '07:30'; }],
    ['Abwesenheitsbestätigung', (state: AppState) => { state.trips[0].absenceConfirmed = false; }],
    ['Mahlzeiten', (state: AppState) => { state.trips[0].meals.breakfast = true; }],
    ['Kilometer', (state: AppState) => { state.trips[0].businessKm = 23; }],
    ['Reiseziel', (state: AppState) => { state.trips[0].destination = 'Synthetische zweite Stadt'; }],
    ['Reisegrund', (state: AppState) => { state.trips[0].purpose = 'Synthetischer anderer Termin'; }],
    ['Projekt', (state: AppState) => { state.expenses[0].projectNumber = '26.0999'; }],
    ['Zuordnung', (state: AppState) => { state.expenses[0].tripId = undefined; }],
    ['Zahlungsart', (state: AppState) => { state.expenses[0].paymentType = 'Unternehmen'; }],
    ['Erstattungsstatus', (state: AppState) => { state.expenses[0].reimbursementStatus = 'erstattet'; }],
  ])('erkennt geänderte %s auch ohne garantierte Betragsänderung', (_label, mutate) => { const state = fixture(); mutate(state); expect(compare(state).hasChanges).toBe(true); });
  it.each(['trip-removed', 'trip-cancelled', 'expense-removed', 'expense-cancelled'])('erkennt entfernte/stornierte Einträge: %s', operation => {
    const state = fixture(); if (operation === 'trip-removed') state.trips = []; if (operation === 'trip-cancelled') state.trips[0].status = 'storniert'; if (operation === 'expense-removed') state.expenses = []; if (operation === 'expense-cancelled') state.expenses[0].status = 'storniert';
    expect(compare(state).changes.some(item => item.kind === 'removed')).toBe(true); expect(monthOverview(state, month).hasClosed).toBe(true);
  });
  it('erkennt gegenläufige Rechnungsänderungen bei einer Null-Differenz', () => {
    const state = fixture(); state.expenses.push(expense({ id: 'second', description: 'Synthetisches Hotel B' })); state.statements = []; capture(state);
    state.expenses[0].gross += 20; state.expenses[1].gross -= 20;
    const result = compare(state); expect(result.deltas?.grandTotal).toBe(0); expect(result.deltas?.personal).toBe(0); expect(result.changes.filter(item => item.label.includes('Hotel'))).toHaveLength(2); expect(result.hasChanges).toBe(true);
  });
  it('erkennt ergänzte und ausgetauschte Belegdateien auch bei identischen Metadaten und Beträgen', () => {
    const state = fixture(); state.expenses[0].receipt!.dataUrl = 'data:application/pdf;base64,QU5ERVJT';
    expect(compare(state).documentChanges.some(item => item.fields.some(field => field.field.includes('Belegdatei')))).toBe(true); expect(compare(state).deltas?.grandTotal).toBe(0);
    delete state.expenses[0].receipt; state.statements = []; capture(state); state.expenses[0].receipt = expense().receipt;
    expect(compare(state).hasChanges).toBe(true);
  });
  it('berücksichtigt Rechnungsdatumsänderungen ausschließlich in den betroffenen Monaten', () => {
    const state = fixture(); capture(state, '2026-07'); capture(state, '2026-08'); state.expenses[0].date = '2026-07-02';
    expect(compare(state).deltas?.accommodation).toBe(-100); expect(compare(state, '2026-07').deltas?.accommodation).toBe(100); expect(compare(state, '2026-08').hasChanges).toBe(false);
  });
  it('berücksichtigt monatsübergreifende Reisen und nur Mahlzeiten des jeweiligen Monats', () => {
    const state = structuredClone(emptyState); state.trips = [trip({ date: '2026-06-30', endDate: '2026-07-02', overnight: true })]; capture(state); capture(state, '2026-07');
    state.trips[0].dailyMeals = { '2026-07-01': { breakfast: true, lunch: false, dinner: false } };
    expect(compare(state).hasChanges).toBe(false); expect(compare(state, '2026-07').hasChanges).toBe(true);
  });
  it('ignoriert leere Mahlzeitenvorgaben und Mahlzeiten außerhalb der zugehörigen Reise', () => {
    const state = fixture(); state.trips[0].dailyMeals = { '2026-06-10': { breakfast: false, lunch: false, dinner: false }, '2026-06-12': { breakfast: true, lunch: false, dinner: false } };
    expect(compare(state).hasChanges).toBe(false);
  });
  it('ignoriert fremde Monate, künftig gültige Tarife und unbenutzte Fahrzeugprofile', () => {
    const state = fixture(); state.expenses.push(expense({ id: 'october', date: '2026-10-10', gross: 400 }));
    state.settings.tariffs[0].validTo = '2026-12-31'; state.settings.tariffs.push({ ...state.settings.tariffs[0], id: 'future-only', validFrom: '2027-01-01', validTo: undefined, amount: 999 });
    state.settings.vehicles.push({ ...state.settings.vehicles[0], id: 'unrelated', name: 'Synthetisches unbenutztes Fahrzeug' }); state.settings.internalMinutes = 999;
    expect(compare(state).hasChanges).toBe(false); expect(monthOverview(state, month).status).toBe('closed');
    const draft = { ...structuredClone(state.statements[0]), id: 'draft', version: 2, locked: false, status: 'vollständig' as const }; state.statements.push(draft);
    expect(checkStatementForClosing(state, month, draft).errors.some(item => item.code === 'stale')).toBe(false);
  });
  it('erkennt anwendbare Tarifänderungen und trennt Profildaten von Geldbeträgen', () => {
    const state = fixture(); state.settings.profileName = 'Synthetisch aktualisiertes Profil';
    const documentOnly = compare(state); expect(documentOnly.documentChanges).toHaveLength(1); expect(documentOnly.changes).toEqual([]); expect(documentOnly.deltas?.personal).toBe(0);
    state.settings.tariffs[0].amount += 1; expect(compare(state).deltas?.allowance).toBe(1);
  });
  it('erkennt Änderungen am verwendeten Fahrzeug, ignoriert aber dessen Aktiv-Markierung', () => {
    const state = fixture(); const vehicle = state.settings.vehicles.find(item => item.id === state.trips[0].vehicleId)!;
    vehicle.active = !vehicle.active; expect(compare(state).hasChanges).toBe(false);
    vehicle.name = 'Synthetisch umbenannt'; expect(compare(state).documentChanges.length).toBeGreaterThan(0);
    vehicle.reimbursementMethod = 'tatsächliche Kosten'; expect(compare(state).changes.length).toBeGreaterThan(0);
  });
  it('vergleicht gespeicherte externe Reisezuordnungen auch im späteren Rechnungsmonat', () => {
    const state = fixture(); state.statements = []; state.trips[0].date = '2026-05-30'; state.trips[0].endDate = '2026-05-31'; capture(state);
    expect(state.statements[0].relatedTripsSnapshot).toHaveLength(1); expect(compare(state).hasChanges).toBe(false);
    state.trips[0].order = '26.0999 Anderer Ort'; expect(compare(state).documentChanges.some(item => item.label.includes('Zugeordnete Reise'))).toBe(true);
    const draft = createCorrectionDraft(state, month, audit); expect(checkStatementForClosing(draft.state, month, draft.state.statements.at(-1)).errors).toEqual([]);
    draft.state.trips[0].order = '26.0888 Noch anderer Ort'; expect(checkStatementForClosing(draft.state, month, draft.state.statements.at(-1)).errors.some(item => item.code === 'stale')).toBe(true);
  });
  it('kennzeichnet fehlende historische Vergleichsinformationen ohne Garantie einer Unverändertheit', () => {
    const state = fixture(); delete state.statements[0].settingsSnapshot; delete state.statements[0].expensesSnapshot;
    expect(compare(state).limitations.length).toBeGreaterThan(0); expect(monthOverview(state, month).status).toBe('history-review');
    expect(openActivityMonths(state, new Date(2026, 9, 18)).map(item => item.month)).toContain(month);
  });
  it('blockiert auch unvollständige ältere Entwürfe mit teilweise vorhandenen Einstellungen', () => {
    const state = fixture(); const draft = state.statements[0]; draft.locked = false; draft.status = 'vollständig';
    delete (draft.settingsSnapshot as Partial<typeof state.settings>).vehicles;
    expect(checkStatementForClosing(state, month, draft).errors.some(item => item.code === 'legacy')).toBe(true);
  });
  it('bewahrt alte Backups und validiert das optionale Referenzreisefeld ohne Migration', () => {
    const state = fixture(); const old = structuredClone(state); delete old.statements[0].relatedTripsSnapshot;
    expect(normalizeState(old).statements[0]).toEqual(old.statements[0]); expect(normalizeState(state).statements).toEqual(state.statements);
    const invalid = structuredClone(state); invalid.statements[0].relatedTripsSnapshot = [ { id: 'malformed' } as Trip ]; expect(() => normalizeState(invalid)).toThrow('Ungültiges Datenformat');
  });
});

describe('Korrekturentwürfe, historischer Export und erneuter sicherer Abschluss', () => {
  it('erstellt genau eine neue ungesperrte Version, ohne den historischen Auszahlungsstatus zu übertragen', () => {
    const state = fixture(); state.statements[0].status = 'ausgezahlt'; const frozen = structuredClone(state.statements[0]); state.expenses.push(expense({ id: 'late', gross: 120 }));
    const result = createCorrectionDraft(state, month, audit); expect(result.created).toBe(true); expect(result.state.statements[0]).toEqual(frozen);
    expect(result.state.statements[1]).toMatchObject({ version: 2, locked: false, status: 'vollständig' });
    expect(monthOverview(result.state, month).status).toBe('correction'); expect(result.state.statements[1].data.totals.openAmount - frozen.data.totals.openAmount).toBe(120);
    const again = createCorrectionDraft(result.state, month, { ...audit, id: 'double-click', changeId: 'duplicate-log' }); expect(again.created).toBe(false); expect(again.snapshotId).toBe(result.snapshotId); expect(again.state.statements).toHaveLength(2);
  });
  it('erzeugt aus einem veralteten Korrekturentwurf eine weitere Version ohne Überschreiben', () => {
    const state = fixture(); state.expenses[0].gross += 10; const first = createCorrectionDraft(state, month, audit); const preserved = structuredClone(first.state.statements);
    first.state.expenses[0].gross += 5; expect(compare(first.state).draftCurrent).toBe(false);
    expect(checkStatementForClosing(first.state, month, first.state.statements[1]).errors.some(item => item.code === 'stale')).toBe(true);
    const next = createCorrectionDraft(first.state, month, { ...audit, id: 'third', changeId: 'third-log' }); expect(next.state.statements).toHaveLength(3); expect(next.state.statements.slice(0, 2)).toEqual(preserved);
  });
  it('verwendet für die Korrektur dieselben Fehler-, Warnungs- und Bestätigungsprüfungen aus 3.2a', () => {
    const state = fixture(); state.expenses.push(expense({ id: 'missing', receipt: undefined })); const created = createCorrectionDraft(state, month, audit).state;
    expect(() => closeStatement(created, { ...confirm(created), warningsAccepted: false }, { id: 'close', at: audit.at })).toThrow('ausdrücklich');
    created.trips[0].absenceConfirmed = false;
    expect(checkStatementForClosing(created, month, created.statements[1]).errors.some(item => item.code === 'absence')).toBe(true);
  });
  it('schließt eine Korrektur explizit und unverändert über closeStatement ab; keine automatische Auszahlung', () => {
    const state = fixture(); state.expenses[0].gross += 120; const created = createCorrectionDraft(state, month, audit).state; const previous = structuredClone(created.statements[0]);
    const closed = closeStatement(created, confirm(created), { id: 'close', at: audit.at });
    expect(closed.statements[1]).toMatchObject({ locked: true, status: 'freigegeben' }); expect(closed.statements[0]).toEqual(previous); expect(monthOverview(closed, month).status).toBe('closed');
  });
  it('weist positive, negative und Null-Differenzen rein rechnerisch aus', () => {
    const state = fixture(); state.expenses[0].gross += 120; expect(compare(state).deltas?.personal).toBe(120);
    state.expenses[0].gross -= 155; expect(compare(state).deltas?.personal).toBe(-35);
    state.expenses[0].gross += 35; state.expenses[0].description = 'Andere synthetische Beschreibung'; expect(compare(state).deltas?.personal).toBe(0); expect(compare(state).hasChanges).toBe(true);
  });
  it('reaktiviert nach Stornierung einer neueren Version keinen älteren Abschluss', () => {
    const state = fixture(); state.statements[0].status = 'ausgezahlt'; state.expenses[0].gross += 10; const created = createCorrectionDraft(state, month, audit).state;
    const closed = closeStatement(created, confirm(created), { id: 'close', at: audit.at }); const cancelled = changeStatementStatus(closed, audit.id, 'storniert', { id: 'cancel', at: audit.at });
    const before = structuredClone(cancelled.statements); expect(compare(cancelled).baseline?.version).toBe(1); expect(compare(cancelled).latestCancelled).toBe(true); expect(monthOverview(cancelled, month).status).toBe('history-review'); expect(cancelled.statements).toEqual(before);
    expect(() => changeStatementStatus(cancelled, cancelled.statements[0].id, 'freigegeben', { id: 'bypass', at: audit.at })).toThrow('Historische Version');
  });
  it('exportiert jede gewählte Version mit deren gespeicherten Beträgen, Belegen und Einstellungen', () => {
    const state = fixture(); const historical = structuredClone(state.statements[0]); state.expenses[0].gross = 250; state.expenses[0].receipt!.name = 'synthetic-new.pdf'; state.settings.company = 'Synthetisch neue Firma';
    const selected = stateForStatementVersion(state, historical); expect(selected.expenses[0].gross).toBe(100); expect(selected.expenses[0].receipt!.name).toBe('synthetic.pdf'); expect(selected.settings.company).toBe(historical.settingsSnapshot!.company);
    expect(historical.data.totals.accommodation).toBe(100); expect(state.statements[0]).toEqual(historical);
    delete historical.expensesSnapshot; delete historical.settingsSnapshot; const legacy = stateForStatementVersion(state, historical); expect(legacy.expenses).toEqual([]); expect(legacy.settings.company).toBe('');
  });
  it('behält Jahresbeträge und dokumentierte Abschlüsse während offener Korrekturen bei', () => {
    const state = fixture(); state.expenses[0].gross += 10; const result = createCorrectionDraft(state, month, audit).state;
    const annual = buildAnnualAnalysis(result, 2026); expect(annual.closedMonthCount).toBe(1); expect(annual.totals.grandTotal).toBe(buildStatement(result, month).totals.grandTotal);
  });
  it('bestätigt keinen Korrekturentwurf, wenn die bestehende lokale Transaktion fehlschlägt', async () => {
    const state = fixture(); state.expenses[0].gross += 10; const before = structuredClone(state); const save = vi.fn().mockRejectedValue(new Error('Synthetischer Mehrtab- oder Speicherfehler'));
    await expect(persistCorrectionDraft(state, month, audit, save)).rejects.toThrow('Speicherfehler'); expect(state).toEqual(before); expect(save).toHaveBeenCalledTimes(1); expect(save.mock.calls[0][1]).toBe(state);
  });
  it('legt unveränderte Abschlüsse nicht unnötig neu an und speichert fortgesetzte Entwürfe nicht doppelt', async () => {
    const state = fixture(); expect(() => createCorrectionDraft(state, month, audit)).toThrow('Keine relevanten Änderungen');
    state.expenses[0].gross += 1; const created = createCorrectionDraft(state, month, audit).state; const save = vi.fn();
    const resumed = await persistCorrectionDraft(created, month, { ...audit, id: 'unused', changeId: 'unused' }, save); expect(resumed.created).toBe(false); expect(save).not.toHaveBeenCalled();
  });
});
