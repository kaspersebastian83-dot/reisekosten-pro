import { describe, expect, it, vi } from 'vitest';
import { buildStatement, expenseReimbursable } from '../lib/calculations';
import { emptyState } from '../lib/config';
import { demoState } from '../lib/demo';
import { monthOverview } from '../lib/month-navigation';
import { changeStatementStatus, checkStatementForClosing, closeStatement, persistStatementClosing, type ClosingConfirmation } from '../lib/statement-closing';
import type { AppState, StatementSnapshot } from '../lib/types';

const month = '2026-06';
const audit = { id: 'synthetic-close', at: '2026-07-01T12:00:00Z' };
function capture(state: AppState, version = 1): StatementSnapshot {
  const snapshot: StatementSnapshot = { id: `draft-${version}`, month, number: 'SYN-202606', createdAt: audit.at, status: 'vollständig', version, locked: false, data: structuredClone(buildStatement(state, month)), settingsSnapshot: structuredClone(state.settings), expensesSnapshot: structuredClone(state.expenses.filter(e => e.date.startsWith(month))) };
  state.statements.push(snapshot);
  return snapshot;
}
function fixture() {
  const state = structuredClone(emptyState);
  state.trips = [{ ...demoState().trips[0], id: 'synthetic-trip', date: '2026-06-10', endDate: '2026-06-10', startTime: '08:00', endTime: '17:00', purpose: 'Synthetischer Termin', destination: 'Musterstadt', order: '26.0123 Musterstadt', businessKm: 0, privateKm: 0, tripType: 'dienstlich', status: 'geprüft', absenceConfirmed: true, overnight: false, meals: { breakfast: false, lunch: false, dinner: false }, warnings: [] }];
  return state;
}
function addExpense(state: AppState, extra = {}) {
  state.expenses.push({ ...demoState().expenses[0], id: 'synthetic-expense', date: '2026-06-10', category: 'Parken', description: 'Synthetisches Parken', gross: 25, net: 25, vat: 0, vatRate: 0, exchangeRate: 1, businessShare: 100, tripId: state.trips[0]?.id, projectNumber: '26.0123', paymentType: 'privat vorgestreckt', reimbursementStatus: 'offen', status: 'geprüft', warnings: [], receipt: { id: 'synthetic-receipt', name: 'synthetic.pdf', type: 'application/pdf', size: 10, hash: 'synthetic-hash', dataUrl: 'data:application/pdf;base64,U1lOVEhFVElD' }, ...extra });
}
function confirmation(state: AppState, snapshot = state.statements.at(-1)!): ClosingConfirmation {
  return { month, snapshotId: snapshot.id, fingerprint: checkStatementForClosing(state, month, snapshot).fingerprint, reviewed: true, warningsAccepted: true };
}
const codes = (state: AppState) => checkStatementForClosing(state, month, state.statements.at(-1)).errors.map(item => item.code);

describe('Sicherer Monatsabschluss', () => {
  it('prüft rein lesend; ein Entwurf ist noch kein grüner Monat', () => {
    const state = fixture(); const draft = capture(state); const before = structuredClone(state);
    expect(checkStatementForClosing(state, month, draft).errors).toEqual([]);
    expect(checkStatementForClosing(state, month, draft).warnings).toEqual([]);
    expect(monthOverview(state, month).status).toBe('working');
    expect(state).toEqual(before);
  });
  it('blockiert einen fehlenden, ungültigen oder nicht jüngsten Entwurf', () => {
    const state = fixture(); expect(codes(state)).toContain('draft');
    const old = capture(state); capture(state, 2);
    expect(checkStatementForClosing(state, month, old).errors.map(item => item.code)).toContain('draft');
    state.statements[1].data.month = '2026-05'; expect(codes(state)).toContain('snapshot');
    state.statements[1].number = ''; expect(codes(state)).toContain('draft');
  });
  it('blockiert technisch mehrdeutige Entwurfs- und Eintragskennungen', () => {
    const state = fixture(); const draft = capture(state); state.statements.push(structuredClone(draft));
    expect(codes(state)).toContain('draft');
    state.statements.pop(); state.trips.push(structuredClone(state.trips[0]));
    expect(codes(state)).toContain('identifiers');
  });
  it.each([{ endTime: '07:00' }, { date: '2026-06-31', endDate: '2026-06-31' }, { startTime: '25:00' }, { endTime: '08:00' }])('blockiert widersprüchliche Zeitintervalle %j', extra => {
    const state = fixture(); capture(state); Object.assign(state.trips[0], extra);
    expect(codes(state)).toContain('interval');
  });
  it.each([NaN, Infinity, -1])('blockiert nicht valide Beträge %s', gross => {
    const state = fixture(); addExpense(state); capture(state); state.expenses[0].gross = gross;
    expect(codes(state)).toContain('expense-values');
  });
  it('blockiert unbestätigte Abwesenheit mit Einfluss auf die Verpflegung', () => {
    const state = fixture(); state.trips[0].absenceConfirmed = false; capture(state);
    expect(codes(state)).toContain('absence');
  });
  it('behandelt eine unbestätigte kurze Reise ohne Verpflegungsansatz als Hinweis', () => {
    const state = fixture(); state.trips[0].endTime = '10:00'; state.trips[0].absenceConfirmed = false; capture(state);
    const result = checkStatementForClosing(state, month, state.statements[0]);
    expect(result.errors).toEqual([]); expect(result.warnings.some(item => item.message.includes('Abwesenheitsdauer'))).toBe(true);
  });
  it('macht ungeprüfte Einträge, fehlende Belege und unklare Zuordnungen zu konkreten Warnungen', () => {
    const state = fixture(); state.trips[0].status = 'ungeprüft'; state.trips[0].order = '';
    addExpense(state, { receipt: undefined, tripId: undefined, projectNumber: undefined, status: 'ungeprüft' }); const draft = capture(state);
    const result = checkStatementForClosing(state, month, draft);
    expect(result.errors).toEqual([]);
    for (const text of ['noch ungeprüft', 'Beleg fehlt', 'Projektzuordnung', 'Keine eindeutige aktive Reise']) expect(result.warnings.some(item => item.message.includes(text))).toBe(true);
    expect(result.warnings.filter(item => item.target?.id === 'synthetic-expense').length).toBeGreaterThan(0);
  });
  it('lässt unbekannte Zahlungsarten als Warnung stehen und zählt sie nicht zur offenen Erstattung', () => {
    const state = fixture(); addExpense(state, { paymentType: 'unbekannt' }); const draft = capture(state);
    expect(expenseReimbursable(state.expenses[0])).toBe(0);
    expect(draft.data.totals.openAmount).toBe(draft.data.totals.allowance);
    expect(checkStatementForClosing(state, month, draft).warnings.some(item => item.code === 'payment')).toBe(true);
  });
  it('zeigt mögliche Dubletten als bestätigbare Warnung', () => {
    const state = fixture(); state.trips.push({ ...state.trips[0], id: 'duplicate-trip' }); const draft = capture(state);
    const result = checkStatementForClosing(state, month, draft);
    expect(result.errors).toEqual([]); expect(result.warnings.some(item => item.code === 'duplicate')).toBe(true);
  });
  it('verlangt die persönliche Prüfung sowie eine zusätzliche Bestätigung verbleibender Warnungen', () => {
    const state = fixture(); addExpense(state, { receipt: undefined }); capture(state);
    expect(() => closeStatement(state, { ...confirmation(state), reviewed: false }, audit)).toThrow('ausdrücklich');
    expect(() => closeStatement(state, { ...confirmation(state), warningsAccepted: false }, audit)).toThrow('ausdrücklich');
    expect(closeStatement(state, confirmation(state), audit).statements[0].locked).toBe(true);
  });
  it('verhindert einen Abschluss trotz Bestätigung bei blockierenden Fehlern', () => {
    const state = fixture(); state.trips[0].absenceConfirmed = false; capture(state);
    expect(() => closeStatement(state, confirmation(state), audit)).toThrow('Abwesenheitsdauer');
  });
  it('erkennt nachträglich ergänzte Hotelkosten und überschreibt den alten Entwurf nicht', () => {
    const state = fixture(); const draft = capture(state); const frozen = structuredClone(draft); addExpense(state, { category: 'Hotel', gross: 120 });
    expect(codes(state)).toContain('stale'); expect(() => closeStatement(state, confirmation(state), audit)).toThrow('geändert');
    expect(draft).toEqual(frozen);
  });
  it('erkennt gleichbleibende Gesamtbeträge mit geänderten Einzelpositionen', () => {
    const state = fixture(); addExpense(state); addExpense(state, { id: 'second', receipt: undefined }); capture(state);
    const before = buildStatement(state, month).totals.grandTotal;
    state.expenses[0].gross += 5; state.expenses[1].gross -= 5;
    expect(buildStatement(state, month).totals.grandTotal).toBe(before); expect(codes(state)).toContain('stale');
  });
  it('erkennt geänderte Reise-, Profil-, Tarif- und Belegdetails ohne Betragsänderung', () => {
    for (const mutate of [
      (s: AppState) => { s.trips[0].purpose = 'Anderer Termin'; },
      (s: AppState) => { s.settings.profileName = 'Anderes synthetisches Profil'; },
      (s: AppState) => { s.settings.tariffs[0].source = 'Anderer Quellenstand'; },
      (s: AppState) => { s.expenses[0].receipt!.dataUrl = 'data:application/pdf;base64,QU5ERVJT'; },
    ]) {
      const state = fixture(); addExpense(state); capture(state); mutate(state); expect(codes(state)).toContain('stale');
    }
  });
  it('erkennt Änderungen nach der angezeigten finalen Bestätigung erneut', () => {
    const state = fixture(); capture(state); const intent = confirmation(state);
    state.trips[0].purpose = 'Nach Bestätigung verändert';
    expect(() => closeStatement(state, intent, audit)).toThrow('Seit der angezeigten Bestätigung');
  });
  it('macht Altentwürfe ohne Vergleichsinformationen lesbar, aber nicht ungeprüft freigebbar', () => {
    const state = fixture(); const draft = capture(state); delete draft.settingsSnapshot; delete draft.expensesSnapshot;
    const before = structuredClone(state); expect(codes(state)).toContain('legacy'); expect(state).toEqual(before);
  });
  it('sperrt exakt den Entwurf, protokolliert akzeptierte Hinweise und zahlt nicht automatisch aus', () => {
    const state = fixture(); addExpense(state, { receipt: undefined }); const draft = capture(state); const before = structuredClone(state);
    const next = closeStatement(state, confirmation(state), audit);
    expect(next.statements[0]).toEqual({ ...draft, status: 'freigegeben', locked: true });
    expect(next.changes).toHaveLength(1); expect(next.changes[0].reason).toContain('Beleg fehlt');
    expect(monthOverview(next, month).status).toBe('closed'); expect(state).toEqual(before);
    expect(() => closeStatement(next, confirmation(state), audit)).toThrow();
    expect(next.changes).toHaveLength(1);
  });
  it('bewahrt ältere abgeschlossene Versionen und historische Auszahlungen', () => {
    const state = fixture(); const old = capture(state); old.locked = true; old.status = 'ausgezahlt'; const before = structuredClone(old); capture(state, 2);
    const next = closeStatement(state, confirmation(state), audit); expect(next.statements[0]).toEqual(before);
    expect(next.statements[1].status).toBe('freigegeben');
  });
  it('bestätigt bei abgewiesenem Speichern keinen Abschluss und verändert den Ausgangsstand nicht', async () => {
    const state = fixture(); capture(state); const before = structuredClone(state); const save = vi.fn().mockRejectedValue(new Error('Synthetischer Speicherfehler'));
    await expect(persistStatementClosing(state, confirmation(state), audit, save)).rejects.toThrow('Speicherfehler');
    expect(state).toEqual(before); expect(monthOverview(state, month).status).toBe('working');
    expect(save).toHaveBeenCalledTimes(1); expect(save.mock.calls[0][1]).toBe(state);
  });
  it('gibt den abgeschlossenen Stand erst nach der erfolgreichen Speicherung zurück', async () => {
    const state = fixture(); capture(state); let stored = false;
    const result = await persistStatementClosing(state, confirmation(state), audit, async next => { expect(next.statements[0].locked).toBe(true); stored = true; });
    expect(stored).toBe(true); expect(result.statements[0].status).toBe('freigegeben');
  });
  it('verhindert Freigabe-Umgehungen und ermöglicht einen getrennten Auszahlungsstatus', () => {
    const state = fixture(); capture(state);
    for (const status of ['freigegeben', 'ausgezahlt'] as const) expect(() => changeStatementStatus(state, 'draft-1', status, audit)).toThrow('Monatsabschluss');
    const closed = closeStatement(state, confirmation(state), audit);
    const paid = changeStatementStatus(closed, 'draft-1', 'ausgezahlt', audit);
    expect(paid.statements[0].data).toEqual(closed.statements[0].data);
    expect(paid.statements[0].locked).toBe(true); expect(() => changeStatementStatus(paid, 'draft-1', 'freigegeben', audit)).toThrow('Monatsabschluss');
    const cancelled = changeStatementStatus(closed, 'draft-1', 'storniert', audit);
    expect(() => changeStatementStatus(cancelled, 'draft-1', 'freigegeben', audit)).toThrow('Monatsabschluss');
  });
});
