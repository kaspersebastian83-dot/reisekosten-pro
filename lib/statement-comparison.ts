import { buildStatement, round2, tariffFor } from './calculations';
import { emptyState } from './config';
import type { AppState, Expense, StatementData, StatementSnapshot, Tariff, Trip } from './types';

export interface StatementChange {
  kind: 'added' | 'removed' | 'changed';
  category: 'data' | 'document';
  label: string;
  fields: { field: string; before: string; after: string }[];
}
export interface StatementComparison {
  baseline?: StatementSnapshot;
  current?: StatementData;
  changes: StatementChange[];
  documentChanges: StatementChange[];
  limitations: string[];
  hasChanges: boolean;
  latestCancelled: boolean;
  draft?: StatementSnapshot;
  draftCurrent: boolean;
  deltas?: { allowance: number; mileage: number; accommodation: number; other: number; grandTotal: number; personal: number };
}

export function stableValue(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
}
const show = (value: unknown): string => value === undefined || value === null || value === '' ? '–' : typeof value === 'boolean' ? value ? 'Ja' : 'Nein' : typeof value === 'object' ? stableValue(value) : String(value);
const versionsFor = (state: AppState, month: string) => state.statements.filter(item => item.month === month).sort((a, b) => b.version - a.version);
export const isClosedStatement = (item: StatementSnapshot) => item.locked && ['freigegeben', 'ausgezahlt'].includes(item.status);
const snapshotTrips = (snapshot: StatementSnapshot) => [...new Map(snapshot.data.rows.flatMap(row => row.trips).map(trip => [trip.id, trip])).values()];
const activeTrips = (state: AppState, month: string) => state.trips.filter(trip => trip.status !== 'storniert' && trip.tripType === 'dienstlich' && trip.date <= `${month}-31` && (trip.endDate || trip.date) >= `${month}-01`);
const activeExpenses = (items: Expense[], month: string) => items.filter(item => item.status !== 'storniert' && item.date.startsWith(month));
export function relatedTripsForSnapshot(state: AppState, data: StatementData): Trip[] {
  const embedded = new Set(data.rows.flatMap(row => row.trips.map(trip => trip.id)));
  const referenced = new Set(activeExpenses(state.expenses, data.month).map(expense => expense.tripId).filter(Boolean));
  return structuredClone(state.trips.filter(trip => referenced.has(trip.id) && !embedded.has(trip.id)).sort((a, b) => a.id.localeCompare(b.id)));
}
const profileFields = { profileName: 'Name', employeeNumber: 'Personalnummer', company: 'Firma', department: 'Abteilung', costCenter: 'Kostenstelle', homeAddress: 'Wohnadresse', firstWorkplace: 'Erste Tätigkeitsstätte', regularSites: 'Regelmäßige Einsatzorte' } as const;
const tripFields: Partial<Record<keyof Trip, string>> = { date: 'Abfahrt Datum', endDate: 'Rückkehr Datum', startTime: 'Abfahrt Uhrzeit', endTime: 'Rückkehr Uhrzeit', startPlace: 'Abfahrtsort', destination: 'Reiseziel', purpose: 'Reisegrund', order: 'Projekt', absenceConfirmed: 'Abwesenheit bestätigt', manualAbsenceMinutes: 'Manuelle Abwesenheitsminuten', overnight: 'Übernachtung bestätigt', businessKm: 'Dienstliche Kilometer', privateKm: 'Private Kilometer', kmStart: 'Kilometerstand Start', kmEnd: 'Kilometerstand Ende', vehicleId: 'Fahrzeugzuordnung', vehicleType: 'Fahrzeugart', tripType: 'Reiseart' };
const tripDocumentFields: Partial<Record<keyof Trip, string>> = { customer: 'Kunde', costCenter: 'Kostenstelle', plate: 'Kennzeichen', vehicle: 'Fahrzeugbezeichnung', notes: 'Notizen', status: 'Prüfstatus', warnings: 'Gespeicherte Prüfhinweise' };
const expenseFields: Partial<Record<keyof Expense, string>> = { date: 'Rechnungsdatum', category: 'Kostenart', description: 'Beschreibung', gross: 'Bruttobetrag', net: 'Nettobetrag', vatRate: 'Umsatzsteuersatz', vat: 'Umsatzsteuer', currency: 'Währung', exchangeRate: 'Wechselkurs', businessShare: 'Geschäftlicher Anteil', paymentType: 'Zahlungsart', reimbursementStatus: 'Erstattungsstatus', tripId: 'Reisezuordnung', projectNumber: 'Projektzuordnung', stayStart: 'Übernachtungsbeginn', stayEnd: 'Übernachtungsende', breakfastIncluded: 'Frühstück enthalten', vehicleId: 'Fahrzeugzuordnung', fuelLiters: 'Kraftstoffmenge', odometer: 'Kilometerstand' };
const expenseDocumentFields: Partial<Record<keyof Expense, string>> = { merchant: 'Händler', invoiceNumber: 'Rechnungsnummer', paidBy: 'Bezahlt von', notes: 'Notizen', status: 'Prüfstatus', warnings: 'Gespeicherte Prüfhinweise' };

export function snapshotHistoryLimitations(snapshot: StatementSnapshot): string[] {
  const limitations: string[] = [];
  if (!snapshot.expensesSnapshot) limitations.push('Historische Belegdateien und vollständige Kosten-/Zuordnungsdaten fehlen.');
  if (!snapshot.settingsSnapshot) limitations.push('Historische Profil- und Fahrzeugeinstellungen fehlen.');
  else if (Object.keys(profileFields).some(key => !(key in snapshot.settingsSnapshot!)) || !Array.isArray(snapshot.settingsSnapshot.vehicles)) limitations.push('Historische Dokument- oder Fahrzeugeinstellungen sind unvollständig.');
  if (!snapshot.settingsSnapshot?.tariffs && !snapshot.data.tariffSnapshot) limitations.push('Historischer Tarifstand fehlt.');
  const embedded = new Set(snapshotTrips(snapshot).map(trip => trip.id));
  if (snapshot.expensesSnapshot?.some(expense => expense.status !== 'storniert' && expense.tripId && !embedded.has(expense.tripId)) && !snapshot.relatedTripsSnapshot) limitations.push('Historische Daten zu zugeordneten Reisen außerhalb des Rechnungsmonats fehlen.');
  return limitations;
}

function fieldChanges<T extends object>(before: T, after: T, labels: Partial<Record<keyof T, string>>, knownOnly = false) {
  return (Object.keys(labels) as (keyof T)[]).flatMap(key => {
    if (knownOnly && !(key in before)) return [];
    let oldValue: unknown = before[key] ?? ''; let newValue: unknown = after[key] ?? '';
    if (key === 'warnings') { oldValue = [...(oldValue as string[] || [])].sort(); newValue = [...(newValue as string[] || [])].sort(); }
    return stableValue(oldValue) === stableValue(newValue) ? [] : [{ field: labels[key]!, before: show(oldValue), after: show(newValue) }];
  });
}
function mealDays(trip: Trip, month: string) {
  const meals: Record<string, unknown> = {};
  const candidates = { [trip.date]: trip.meals, ...trip.dailyMeals };
  for (const [date, selected] of Object.entries(candidates)) {
    // Empty UI defaults and meal entries outside this trip do not change a day.
    if (date.startsWith(month) && date >= trip.date && date <= (trip.endDate || trip.date) && (selected.breakfast || selected.lunch || selected.dinner)) {
      meals[date] = { breakfast: !!selected.breakfast, lunch: !!selected.lunch, dinner: !!selected.dinner };
    }
  }
  return meals;
}
function showMeals(value: Record<string, unknown>) {
  return Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([date, meals]) => `${date}: ${Object.entries({ breakfast: 'Frühstück', lunch: 'Mittagessen', dinner: 'Abendessen' }).filter(([key]) => (meals as Record<string, boolean>)?.[key]).map(([, label]) => label).join(', ')}`).join(' · ') || 'Keine gestellten Mahlzeiten im Monat';
}
const tariffLabel = (tariff?: Tariff) => tariff ? `${tariff.label} · ${tariff.amount.toLocaleString('de-DE')} ${tariff.unit === 'percent' ? '%' : 'EUR'} · ab ${tariff.validFrom}${tariff.validTo ? ` bis ${tariff.validTo}` : ''} · ${tariff.source} · Prüfstand ${tariff.checkedAt}` : 'Kein anwendbarer Tarif';
type ComparedExpense = Omit<Partial<Expense>, 'paymentType' | 'reimbursementStatus'> & Pick<Expense, 'id' | 'date' | 'category' | 'description'> & { paymentType?: string; reimbursementStatus?: string };
function receiptLabel(expense: ComparedExpense) {
  return expense.receipt ? `${expense.receipt.name} · ${expense.receipt.type} · ${expense.receipt.size} Bytes` : 'Kein Beleg gespeichert';
}

/** Compares only the selected month's stored and current evidence. No snapshot mutation. */
export function compareSnapshotWithCurrent(state: AppState, month: string, snapshot: StatementSnapshot, suppliedCurrent?: StatementData): StatementComparison {
  const result: StatementComparison = { baseline: snapshot, changes: [], documentChanges: [], limitations: snapshotHistoryLimitations(snapshot), hasChanges: false, latestCancelled: false, draftCurrent: false };
  const add = (category: StatementChange['category'], label: string, fields: StatementChange['fields'], kind: StatementChange['kind'] = 'changed') => {
    if (fields.length) (category === 'data' ? result.changes : result.documentChanges).push({ category, label, fields, kind });
  };
  if (snapshot.data.month !== month) result.limitations.push('Die gespeicherte Monatskennung der Berechnung ist widersprüchlich.');
  try { result.current = suppliedCurrent || buildStatement(state, month); }
  catch { result.limitations.push('Der aktuelle Monatsstand konnte nicht zuverlässig berechnet werden.'); }
  const previousTrips = snapshotTrips(snapshot); const currentTrips = activeTrips(state, month);
  const compareEntries = <T extends Trip | ComparedExpense>(before: T[], after: T[], type: 'trip' | 'expense', labels: Partial<Record<keyof T, string>>, documentLabels: Partial<Record<keyof T, string>>, knownOnly = false) => {
    const oldMap = new Map(before.map(item => [item.id, item])); const newMap = new Map(after.map(item => [item.id, item]));
    if (oldMap.size !== before.length || newMap.size !== after.length) result.limitations.push('Mehrfach vergebene Eintragskennungen schränken den Vergleich ein.');
    for (const id of new Set([...oldMap.keys(), ...newMap.keys()])) {
      const old = oldMap.get(id); const current = newMap.get(id); const entry = current || old!;
      const label = type === 'trip' ? `Dienstreise ${entry.date} · ${(entry as Trip).destination || (entry as Trip).purpose || id}` : `${(entry as Expense).category} ${entry.date} · ${(entry as Expense).description || id}`;
      if (!old || !current) {
        const raw = type === 'trip' ? state.trips.find(item => item.id === id) : state.expenses.find(item => item.id === id);
        add('data', label, [{ field: 'Monatszugehörigkeit', before: old ? 'Im gespeicherten Monatsstand' : 'Nicht im gespeicherten Monatsstand', after: current ? 'Im aktuellen Monatsstand' : raw?.status === 'storniert' ? 'Status: storniert' : raw ? `Nicht mehr im Monatsstand · Datum ${raw.date}` : 'Eintrag nicht mehr vorhanden' }, { field: type === 'trip' ? 'Reisezeit' : 'Bruttobetrag', before: old ? type === 'trip' ? `${(old as Trip).startTime} – ${(old as Trip).endTime}` : show((old as Expense).gross) : '–', after: current ? type === 'trip' ? `${(current as Trip).startTime} – ${(current as Trip).endTime}` : show((current as Expense).gross) : '–' }], old ? 'removed' : 'added');
        continue;
      }
      add('data', label, fieldChanges(old, current, labels, knownOnly));
      add('document', label, fieldChanges(old, current, documentLabels, knownOnly));
      if (type === 'trip') {
        const oldMeals = mealDays(old as Trip, month); const newMeals = mealDays(current as Trip, month);
        if (stableValue(oldMeals) !== stableValue(newMeals)) add('data', label, [{ field: 'Gestellte Mahlzeiten im Monat', before: showMeals(oldMeals), after: showMeals(newMeals) }]);
      } else if (!knownOnly && stableValue((old as Expense).receipt) !== stableValue((current as Expense).receipt)) {
        add('document', label, [{ field: 'Belegdatei / Dateiinhalt', before: receiptLabel(old as Expense), after: `${receiptLabel(current as Expense)}${receiptLabel(old as Expense) === receiptLabel(current as Expense) ? ' · Dateiinhalt oder gespeicherte Belegmetadaten geändert' : ''}` }]);
      }
    }
  };
  compareEntries(previousTrips, currentTrips, 'trip', tripFields, tripDocumentFields);
  const oldExpenses: ComparedExpense[] = snapshot.expensesSnapshot ? activeExpenses(snapshot.expensesSnapshot, month) : snapshot.data.rows.flatMap(row => row.contributions?.expenses.map(item => ({ ...item, date: row.date })) || []);
  const currentExpenses = activeExpenses(state.expenses, month);
  compareEntries(oldExpenses, currentExpenses, 'expense', expenseFields, snapshot.expensesSnapshot ? expenseDocumentFields : {}, !snapshot.expensesSnapshot);
  const embeddedIds = new Set([...previousTrips, ...currentTrips].map(trip => trip.id));
  const referencedIds = new Set([...oldExpenses, ...currentExpenses].map(expense => expense.tripId).filter((id): id is string => !!id && !embeddedIds.has(id)));
  for (const id of referencedIds) {
    if (oldExpenses.some(expense => expense.tripId === id) && !snapshot.relatedTripsSnapshot) continue;
    const previous = snapshot.relatedTripsSnapshot?.find(trip => trip.id === id);
    const current = state.trips.find(trip => trip.id === id);
    if (!previous || !current) { if (stableValue(previous) !== stableValue(current)) add('document', `Zugeordnete Reise ${id}`, [{ field: 'Zuordnungsgrundlage', before: previous ? `${previous.date} · ${previous.order}` : 'Keine Reise gespeichert', after: current ? `${current.date} · ${current.order}` : 'Reise nicht mehr vorhanden' }]); }
    else add('document', `Zugeordnete Reise ${previous.date} · ${previous.destination}`, fieldChanges(previous, current, { date: 'Abfahrt Datum', endDate: 'Rückkehr Datum', order: 'Projekt', destination: 'Reiseziel', vehicleId: 'Fahrzeugzuordnung', vehicleType: 'Fahrzeugart', status: 'Status' }));
  }

  const oldSettings = snapshot.settingsSnapshot;
  if (oldSettings) {
    add('document', 'Dokument- und Profildaten', fieldChanges(oldSettings, state.settings, profileFields, true));
    if (previousTrips.length || currentTrips.length) {
      add('data', 'Berechnungseinstellungen', fieldChanges(oldSettings, state.settings, { ruleMode: 'Berechnungsmodus', ...(oldSettings.ruleMode === 'internal' || state.settings.ruleMode === 'internal' ? { internalMinutes: 'Interne Abwesenheitsschwelle', internalComparator: 'Interner Vergleich' } : {}) }));
      if ([...previousTrips, ...currentTrips].some(trip => trip.businessKm > 0 && !trip.vehicleId)) add('data', 'Kilometer-Berechnung ohne Fahrzeugprofil', fieldChanges(oldSettings, state.settings, { mileageMethod: 'Erstattungsmethode' }));
    }
    const vehicleIds = new Set([...previousTrips, ...currentTrips, ...(snapshot.relatedTripsSnapshot || []), ...state.trips.filter(trip => referencedIds.has(trip.id)), ...oldExpenses, ...currentExpenses].map(item => item.vehicleId).filter(Boolean));
    for (const id of vehicleIds) {
      const old = (oldSettings.vehicles || []).find(item => item.id === id); const current = state.settings.vehicles.find(item => item.id === id);
      if (!old || !current) { if (stableValue(old) !== stableValue(current)) add('data', `Verwendetes Fahrzeug ${id}`, [{ field: 'Fahrzeugprofil', before: old ? show(old) : 'Nicht vorhanden', after: current ? show(current) : 'Nicht vorhanden' }]); continue; }
      add('data', `Verwendetes Fahrzeug ${old.name}`, fieldChanges(old, current, { ownership: 'Fahrzeugart', reimbursementMethod: 'Erstattungsmethode' }));
      add('document', `Verwendetes Fahrzeug ${old.name}`, fieldChanges(old, current, { name: 'Bezeichnung', plate: 'Kennzeichen' }));
    }
  }
  const oldTariffs = oldSettings?.tariffs || snapshot.data.tariffSnapshot;
  const oldTariffSettings = { ...state.settings, tariffs: oldTariffs || [] };
  const oldRows = new Map(snapshot.data.rows.map(row => [row.date, row]));
  const newRows = new Map((result.current?.rows || []).map(row => [row.date, row]));
  for (const date of new Set([...oldRows.keys(), ...newRows.keys()])) {
    const old = oldRows.get(date); const current = newRows.get(date);
    const kinds = new Set<Tariff['kind']>();
    for (const row of [old, current]) {
      if (!row?.trips.length) continue;
      for (const id of row.tariffIds || []) { const tariff = [...(oldTariffs || []), ...state.settings.tariffs].find(item => item.id === id); if (tariff) kinds.add(tariff.kind); }
      for (const meal of ['breakfast', 'lunch', 'dinner'] as const) if (row.calculation?.meals[meal]) kinds.add(meal);
      if (row.contributions?.mileage.some(item => item.km > 0)) kinds.add('mileage');
    }
    for (const kind of kinds) {
      const previous = tariffFor(oldTariffSettings, date, kind); const next = tariffFor(state.settings, date, kind);
      if (oldTariffs && stableValue(previous) !== stableValue(next)) {
        if (!previous || !next || previous.amount !== next.amount || previous.unit !== next.unit || previous.country !== next.country) add('data', `Anwendbarer Tarif ${date}`, [{ field: 'Tarifstand', before: tariffLabel(previous), after: tariffLabel(next) }]);
        else add('document', `Tarifdokumentation ${date}`, fieldChanges(previous, next, { label: 'Tarifbezeichnung', source: 'Quelle', checkedAt: 'Prüfstand', validFrom: 'Gültig ab' }));
        // A changed future end date is immaterial when both rates cover this day.
      }
    }
    if (old && current) {
      add('data', `Berechnung ${date}`, fieldChanges(old, current, { firstStart: 'Erster Beginn', lastEnd: 'Letzte Rückkehr', absenceMinutes: 'Abwesenheitsminuten', totalKm: 'Kilometer im Monat', allowanceBefore: 'Verpflegung vor Kürzungen', breakfastCut: 'Frühstückskürzung', lunchCut: 'Mittagskürzung', dinnerCut: 'Abendkürzung', allowanceAfter: 'Verpflegung nach Kürzungen', mileage: 'Kilometererstattung', fuel: 'Tanken', accommodation: 'Hotel', other: 'Weitere Kosten', companyPaid: 'Vom Unternehmen bezahlt', reimbursed: 'Als erstattet erfasste Kosten', privatelyAdvanced: 'Privat vorgestreckt', openAmount: 'Persönlicher Erstattungsbetrag laut Rechenstand' }));
      if (old.warnings.slice().sort().join('|') !== current.warnings.slice().sort().join('|')) add('document', `Berechnungsprüfung ${date}`, [{ field: 'Prüfhinweise', before: show(old.warnings), after: show(current.warnings) }]);
    }
  }
  if (result.current) {
    const old = snapshot.data.totals; const current = result.current.totals;
    result.deltas = { allowance: round2(current.allowance - old.allowance), mileage: round2(current.mileage - old.mileage), accommodation: round2(current.accommodation - old.accommodation), other: round2(current.other + current.fuel - old.other - old.fuel), grandTotal: round2(current.grandTotal - old.grandTotal), personal: round2(current.openAmount - old.openAmount) };
    if (Object.values(result.deltas).some(value => !Number.isFinite(value))) { result.deltas = undefined; result.limitations.push('Mindestens ein Berechnungsbetrag ist nicht valide.'); }
  }
  result.hasChanges = !!(result.changes.length || result.documentChanges.length || (result.deltas && Object.values(result.deltas).some(value => value !== 0)));
  return result;
}

export function compareClosedStatementWithCurrent(state: AppState, month: string, current?: StatementData): StatementComparison {
  const versions = versionsFor(state, month); const baseline = versions.find(isClosedStatement);
  if (!baseline) return { changes: [], documentChanges: [], limitations: [], hasChanges: false, latestCancelled: versions[0]?.status === 'storniert', draftCurrent: false };
  const result = compareSnapshotWithCurrent(state, month, baseline, current);
  result.latestCancelled = versions[0]?.status === 'storniert';
  if (result.latestCancelled) result.limitations.push('Die jüngste Version ist storniert. Die ältere abgeschlossene Version dient nur als historische Vergleichsbasis und wird nicht reaktiviert.');
  const latest = versions[0];
  if (latest.version > baseline.version && !latest.locked && latest.status !== 'storniert') {
    result.draft = latest;
    const check = compareSnapshotWithCurrent(state, month, latest, result.current);
    result.draftCurrent = !check.hasChanges && !check.limitations.length;
  }
  return result;
}

/** One new version in the existing snapshot list; identical active drafts are reused. */
export function createCorrectionDraft(state: AppState, month: string, audit: { id: string; changeId: string; at: string }) {
  const comparison = compareClosedStatementWithCurrent(state, month);
  if (!comparison.baseline) throw new Error('Für diesen Monat ist kein nicht stornierter Abschluss vorhanden.');
  if (comparison.draft && comparison.draftCurrent) return { state, snapshotId: comparison.draft.id, created: false };
  if (!comparison.hasChanges && !comparison.limitations.length && !comparison.draft) throw new Error('Keine relevanten Änderungen gegenüber dem Abschluss erkannt.');
  if (!comparison.current) throw new Error('Der aktuelle Monatsstand konnte nicht zuverlässig berechnet werden.');
  if (state.statements.some(item => item.id === audit.id)) throw new Error('Diese Versionskennung ist bereits vorhanden. Bitte erneut versuchen.');
  const latest = versionsFor(state, month)[0];
  const next = structuredClone(state);
  const snapshot: StatementSnapshot = { id: audit.id, month, number: latest.number, version: Math.max(...versionsFor(state, month).map(item => item.version)) + 1, createdAt: audit.at, status: 'vollständig', locked: false, data: structuredClone(comparison.current), settingsSnapshot: structuredClone(state.settings), expensesSnapshot: structuredClone(state.expenses.filter(item => item.date.startsWith(month))), relatedTripsSnapshot: relatedTripsForSnapshot(state, comparison.current) };
  next.statements.push(snapshot);
  next.changes.push({ id: audit.changeId, entityType: 'statement', entityId: snapshot.id, field: 'Korrekturentwurf', oldValue: { id: comparison.baseline.id, version: comparison.baseline.version }, newValue: { id: snapshot.id, version: snapshot.version }, reason: 'Korrekturentwurf ausdrücklich aus aktuellem Monatsstand erstellt. Rechnerische Differenzen sind keine dokumentierten Zahlungen.', user: state.settings.profileName || 'Lokales Profil', changedAt: audit.at });
  return { state: next, snapshotId: snapshot.id, created: true };
}

export async function persistCorrectionDraft(state: AppState, month: string, audit: { id: string; changeId: string; at: string }, save: (next: AppState, expected: AppState) => Promise<void>) {
  const result = createCorrectionDraft(state, month, audit);
  if (result.created) await save(result.state, state);
  return result;
}

/** Historical exports never borrow files or profile details from newer versions. */
export function stateForStatementVersion(state: AppState, snapshot: StatementSnapshot): AppState {
  const stored = snapshot.settingsSnapshot;
  const settings = { ...structuredClone(emptyState.settings), profileName: '', company: '', ...stored, vehicles: stored?.vehicles || [], defaultVehicleId: stored?.defaultVehicleId || '', tariffs: stored?.tariffs || structuredClone(snapshot.data.tariffSnapshot || []) };
  return { ...state, trips: [...snapshotTrips(snapshot), ...(snapshot.relatedTripsSnapshot || [])], settings, expenses: snapshot.expensesSnapshot || [] };
}
