import { buildStatement, duplicateKey, validateTrip } from './calculations';
import { manualTripInterval } from './manual-trip';
import { isMonth, latestStatement } from './month-navigation';
import { duplicateExpense, linkingErrors, projectNumber, similarExpense, validDate } from './receipt-linking';
import type { AppState, ChangeLog, ReviewStatus, StatementSnapshot } from './types';
import { compareSnapshotWithCurrent, relatedTripsForSnapshot } from './statement-comparison';

export interface ClosingIssue {
  code: string;
  message: string;
  target?: { kind: 'trip' | 'expense'; id: string };
}
export interface ClosingCheck {
  errors: ClosingIssue[];
  warnings: ClosingIssue[];
  fingerprint: string;
}
export interface ClosingConfirmation {
  month: string;
  snapshotId: string;
  fingerprint: string;
  reviewed: boolean;
  warningsAccepted: boolean;
}

// Comparison only: no persisted keys, new snapshot format or migration.
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
}
function finiteNumbers(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  return !value || typeof value !== 'object' || Object.values(value).every(finiteNumbers);
}
const monthExpenses = (state: AppState, month: string) => state.expenses.filter(e => e.date.startsWith(month));

/** Read-only review. Calculation and reimbursement rules stay in buildStatement. */
export function checkStatementForClosing(state: AppState, month: string, snapshot?: StatementSnapshot): ClosingCheck {
  const errors: ClosingIssue[] = [];
  const warnings: ClosingIssue[] = [];
  const issue = (list: ClosingIssue[], code: string, message: string, target?: ClosingIssue['target']) => {
    if (!list.some(item => item.message === message && item.target?.id === target?.id)) list.push({ code, message, target });
  };
  if (!isMonth(month)) issue(errors, 'month', 'Der Abrechnungsmonat ist ungültig.');
  const latest = latestStatement(state, month);
  if (!snapshot || !snapshot.id || !snapshot.number || snapshot.id !== latest?.id || snapshot.month !== month || snapshot.version < 1 || !Number.isInteger(snapshot.version)) {
    issue(errors, 'draft', 'Ein gültiger aktueller Entwurf fehlt. Bitte eine neue Version erstellen.');
  }
  if (snapshot && (state.statements.filter(item => item.id === snapshot.id).length !== 1 || state.statements.filter(item => item.month === month && item.version === snapshot.version).length !== 1 || !['importiert', 'ungeprüft', 'geprüft', 'vollständig', 'zur Freigabe eingereicht', 'freigegeben', 'ausgezahlt', 'storniert'].includes(snapshot.status))) {
    issue(errors, 'draft', 'Entwurfskennung, Version oder Status sind widersprüchlich. Bitte eine neue eindeutige Version erstellen.');
  }
  if (snapshot?.locked || snapshot?.status === 'storniert' || snapshot?.status === 'freigegeben' || snapshot?.status === 'ausgezahlt') {
    issue(errors, 'protected', 'Diese Version kann nicht erneut freigegeben werden. Für einen neuen Abschluss bitte eine neue Version erstellen.');
  }
  if (snapshot && (!snapshot.data || !Array.isArray(snapshot.data.rows) || !snapshot.data.totals || snapshot.data.month !== month || !finiteNumbers(snapshot.data))) {
    issue(errors, 'snapshot', 'Der gespeicherte Abrechnungsstand enthält ungültige Berechnungsdaten. Bitte eine neue Version erstellen.');
  }
  const trips = state.trips.filter(t => t.status !== 'storniert' && t.tripType === 'dienstlich' &&
    (t.date.startsWith(month) || (t.endDate || '').startsWith(month) || (t.date <= `${month}-31` && (t.endDate || t.date) >= `${month}-01`)));
  for (const trip of trips) {
    const target = { kind: 'trip' as const, id: trip.id };
    const label = `Reise ${trip.date} · ${trip.destination || trip.purpose || trip.id}`;
    const validation = validateTrip(trip);
    if (!manualTripInterval(trip)) issue(errors, 'interval', `${label}: Abfahrt und Rückkehr sind ungültig oder widersprüchlich.`, target);
    if (!finiteNumbers(trip) || trip.businessKm < 0 || trip.privateKm < 0 || (trip.manualAbsenceMinutes != null && trip.manualAbsenceMinutes < 0) || validation.includes('Kilometerstand Ende kleiner als Start')) {
      issue(errors, 'trip-values', `${label}: Kilometer oder Abwesenheitskorrektur sind nicht valide.`, target);
    }
    if (!projectNumber(trip.order)) issue(warnings, 'project', `${label}: Projektzuordnung ist unklar.`, target);
    if (['ungeprüft', 'importiert'].includes(trip.status)) issue(warnings, 'unreviewed', `${label}: Eintrag ist noch ungeprüft.`, target);
    if (trips.some(other => other.id !== trip.id && duplicateKey(other) === duplicateKey(trip))) issue(warnings, 'duplicate', `${label}: Mögliche doppelte Reise.`, target);
    for (const warning of new Set([...validation, ...trip.warnings])) {
      if (['Negative Kilometer', 'Kilometerstand Ende kleiner als Start'].includes(warning)) continue;
      issue(warnings, 'trip-warning', `${label}: ${warning}`, target);
    }
  }
  const expenses = monthExpenses(state, month);
  if (new Set(trips.map(item => item.id)).size !== trips.length || new Set(expenses.map(item => item.id)).size !== expenses.length) issue(errors, 'identifiers', 'Reise- oder Kostenkennungen sind mehrfach vergeben. Die betroffenen Einträge müssen zuerst geprüft werden.');
  const activeExpenses = state.expenses.filter(e => e.status !== 'storniert');
  for (const expense of expenses.filter(e => e.status !== 'storniert')) {
    const target = { kind: 'expense' as const, id: expense.id };
    const label = `Kosten ${expense.date} · ${expense.description || expense.category || expense.id}`;
    if (!validDate(expense.date) || !finiteNumbers(expense) || expense.gross <= 0 || expense.net < 0 || expense.vat < 0 || expense.exchangeRate <= 0 || expense.businessShare < 0 || expense.businessShare > 100) {
      issue(errors, 'expense-values', `${label}: Rechnungsdatum oder Beträge sind nicht valide.`, target);
    }
    const linked = state.trips.find(t => t.id === expense.tripId && t.status !== 'storniert');
    if (!expense.tripId || !linked) issue(warnings, 'trip-link', `${label}: Keine eindeutige aktive Reise zugeordnet.`, target);
    const direct = projectNumber(expense.projectNumber);
    const indirect = projectNumber(linked?.order);
    if ((!direct && !indirect) || (direct && indirect && direct !== indirect)) issue(warnings, 'project', `${label}: Projektzuordnung ist unklar oder widersprüchlich.`, target);
    if (!['privat vorgestreckt', 'Unternehmen', 'Firmenkarte', 'bereits erstattet'].includes(expense.paymentType)) issue(warnings, 'payment', `${label}: Zahlungsart unbekannt; zählt nicht zur offenen persönlichen Erstattung.`, target);
    if (expense.status === 'ungeprüft' || expense.status === 'importiert') issue(warnings, 'unreviewed', `${label}: Eintrag ist noch ungeprüft.`, target);
    for (const warning of new Set([
      ...expense.warnings, ...linkingErrors(expense),
      ...(!expense.receipt ? ['Beleg fehlt'] : []),
      ...(duplicateExpense(activeExpenses, expense) || similarExpense(activeExpenses, expense) ? ['Möglicher doppelter Beleg'] : []),
    ])) issue(warnings, 'expense-warning', `${label}: ${warning}`, target);
  }
  if (!finiteNumbers(state.settings)) issue(errors, 'settings', 'Die gespeicherten Einstellungen enthalten ungültige Zahlen.');
  let current: ReturnType<typeof buildStatement> | undefined;
  // Invalid source values must not be fed into a final closing comparison.
  if (!errors.some(item => ['month', 'interval', 'trip-values', 'expense-values', 'settings'].includes(item.code))) {
    try {
      current = buildStatement(state, month);
      if (!finiteNumbers(current)) issue(errors, 'calculation', 'Die Monatsberechnung enthält ungültige Zahlen.');
      for (const row of current.rows) {
        for (const trip of row.trips) {
          if (!trip.absenceConfirmed && row.allowanceBefore > 0) issue(errors, 'absence', `Reise ${trip.date} · ${trip.destination || trip.id}: Die für die Verpflegungsberechnung benötigte Abwesenheitsdauer ist nicht bestätigt.`, { kind: 'trip', id: trip.id });
        }
        for (const warning of row.warnings) {
          if (!row.trips.some(t => [...validateTrip(t), ...t.warnings].includes(warning))) issue(warnings, 'day-warning', `${row.date}: ${warning}`, row.trips[0] ? { kind: 'trip', id: row.trips[0].id } : undefined);
        }
      }
    } catch { issue(errors, 'calculation', 'Die Monatsberechnung konnte nicht zuverlässig erstellt werden.'); }
  }
  if (snapshot && (!snapshot.settingsSnapshot || !snapshot.expensesSnapshot)) {
    issue(errors, 'legacy', 'Bei diesem älteren Entwurf fehlen Vergleichsinformationen zum Tarif-, Profil- oder Belegstand. Er bleibt lesbar; bitte eine neue Version erstellen.');
  } else if (snapshot && current) {
    const comparison = compareSnapshotWithCurrent(state, month, snapshot, current);
    if (comparison.hasChanges) issue(errors, 'stale', 'Seit Erstellung des Entwurfs haben sich abrechnungsrelevante Daten geändert. Bitte eine neue Version erstellen.');
    if (comparison.limitations.length) issue(errors, 'legacy', 'Bei diesem älteren Entwurf fehlen vollständige Vergleichsinformationen. Bitte eine neue Version erstellen.');
  }
  if (snapshot?.expensesSnapshot && !snapshot.relatedTripsSnapshot && snapshot.expensesSnapshot.some(expense => expense.status !== 'storniert' && expense.tripId && !snapshot.data.rows.some(row => row.trips.some(trip => trip.id === expense.tripId)))) issue(errors, 'legacy', 'Bei diesem älteren Entwurf fehlen Vergleichsinformationen zur zugeordneten Reise außerhalb des Rechnungsmonats. Bitte eine neue Version erstellen.');
  return { errors, warnings, fingerprint: canonical({ month, snapshot, current, relatedTrips: current ? relatedTripsForSnapshot(state, current) : [], settings: state.settings, expenses, errors, warnings }) };
}

/** Produces the existing state/snapshot format; never refreshes a draft's data. */
export function closeStatement(state: AppState, confirmation: ClosingConfirmation, audit: { id: string; at: string }): AppState {
  const snapshot = state.statements.find(item => item.id === confirmation.snapshotId);
  const result = checkStatementForClosing(state, confirmation.month, snapshot);
  if (result.fingerprint !== confirmation.fingerprint) throw new Error('Seit der angezeigten Bestätigung haben sich Daten geändert. Bitte die Abschlussprüfung erneut öffnen.');
  if (result.errors.length) throw new Error(result.errors[0].message);
  if (!confirmation.reviewed || (result.warnings.length && !confirmation.warningsAccepted)) throw new Error('Bitte die erforderlichen Abschlussbestätigungen ausdrücklich setzen.');
  const next = structuredClone(state);
  const target = next.statements.find(item => item.id === confirmation.snapshotId)!;
  const oldValue = { status: target.status, locked: target.locked };
  target.status = 'freigegeben'; target.locked = true;
  next.changes.push({ id: audit.id, entityType: 'statement', entityId: target.id, field: 'Status', oldValue, newValue: { status: target.status, locked: true }, reason: `Monatsabrechnung ausdrücklich geprüft und abgeschlossen.${result.warnings.length ? ` Akzeptierte Hinweise: ${result.warnings.map(item => item.message).join(' | ')}` : ' Keine bekannten Prüfprobleme.'}`, user: state.settings.profileName || 'Lokales Profil', changedAt: audit.at });
  return next;
}

export async function persistStatementClosing(state: AppState, confirmation: ClosingConfirmation, audit: { id: string; at: string }, save: (next: AppState, expected: AppState) => Promise<void>) {
  const next = closeStatement(state, confirmation, audit);
  await save(next, state);
  return next;
}

/** The status selector cannot approve, reapprove, or pay an unlocked draft. */
export function changeStatementStatus(state: AppState, id: string, status: ReviewStatus, audit: { id: string; at: string }): AppState {
  const snapshot = state.statements.find(item => item.id === id);
  if (!snapshot || snapshot.status === status) return state;
  if (latestStatement(state, snapshot.month)?.id !== snapshot.id) throw new Error('Historische Versionen können nur angesehen werden. Bitte die aktuelle Version auswählen.');
  const allowed = snapshot.locked
    ? (status === 'storniert' || (snapshot.status === 'freigegeben' && status === 'ausgezahlt'))
    : ['vollständig', 'zur Freigabe eingereicht', 'storniert'].includes(status);
  if (!allowed) throw new Error('Eine Freigabe ist nur über den geprüften Monatsabschluss möglich.');
  const next = structuredClone(state);
  next.statements.find(item => item.id === id)!.status = status;
  const change: ChangeLog = { id: audit.id, entityType: 'statement', entityId: id, field: 'Status', oldValue: snapshot.status, newValue: status, reason: 'Status geändert', user: state.settings.profileName || 'Lokales Profil', changedAt: audit.at };
  next.changes.push(change);
  return next;
}

/** Gleichartige Prüfprobleme zusammenfassen (z. B. „Projektzuordnung ist unklar“ bei 14 Reisen). Reine Darstellung. */
export interface ClosingIssueGroup { title: string; items: { label: string; issue: ClosingIssue }[] }
export function groupClosingIssues(issues: ClosingIssue[]): ClosingIssueGroup[] {
  const groups = new Map<string, ClosingIssueGroup>();
  for (const issue of issues) {
    const split = issue.target ? issue.message.indexOf(': ') : -1;
    const label = split > 0 ? issue.message.slice(0, split) : '';
    const title = split > 0 ? issue.message.slice(split + 2) : issue.message;
    const group = groups.get(title) || { title, items: [] };
    group.items.push({ label, issue });
    groups.set(title, group);
  }
  return [...groups.values()];
}

/**
 * Vorschau vor dem Entwurf: dieselbe Prüfung wie beim Abschluss, ohne die Fehler, die nur den (noch nicht
 * vorhandenen) Entwurf selbst betreffen. Ändert nichts.
 */
export function closingPreview(state: AppState, month: string) {
  const result = checkStatementForClosing(state, month, undefined);
  return { errors: result.errors.filter(item => !['draft', 'protected', 'snapshot', 'legacy', 'stale'].includes(item.code)), warnings: result.warnings };
}
