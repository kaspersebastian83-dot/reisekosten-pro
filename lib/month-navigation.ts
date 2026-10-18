import type { AppState, StatementSnapshot } from './types';

export const monthNames = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
export const isMonth = (month: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(month) && Number(month.slice(0,4)) > 0;
export const localCalendarMonth = (date = new Date()) => `${date.getFullYear().toString().padStart(4,'0')}-${String(date.getMonth()+1).padStart(2,'0')}`;
export function previousCalendarMonth(date = new Date()) {
  const month = date.getMonth();
  return `${String(date.getFullYear() - (month === 0 ? 1 : 0)).padStart(4,'0')}-${String(month === 0 ? 12 : month).padStart(2,'0')}`;
}
export const monthLabel = (month: string) => `${monthNames[Number(month.slice(5,7))-1]} ${month.slice(0,4)}`;
export type MonthStatus = 'closed' | 'working' | 'open' | 'review';
export const statusLabels: Record<MonthStatus, string> = {closed:'Abgeschlossen',working:'In Bearbeitung',open:'Offen',review:'Prüfung erforderlich'};

// Only already stored, concrete hints. Generic tax/scope notes and a mere
// "ungeprüft" status do not become new closing/completeness checks here.
const concreteWarnings = new Set([
  'Reisezweck fehlt', 'Reiseziel fehlt', 'Negative Kilometer',
  'Kilometerstand Ende kleiner als Start', 'Unrealistische Durchschnittsgeschwindigkeit',
  'Mahlzeitenangabe bei nicht-dienstlicher Fahrt', 'Abwesenheitsdauer muss bestätigt werden.',
  'Privatfahrt vor der ersten Betriebsfahrt – Abwesenheitsbeginn bitte bestätigen.',
  'Beleg fehlt', 'Tankbeleg ohne Fahrzeug', 'Möglicher doppelter Beleg',
  'Durch die Kilometerpauschale abgegolten – nicht zusätzlich erstattungsfähig',
]);
export function latestStatement(state: AppState, month: string): StatementSnapshot | undefined {
  // Same version ordering as the existing statement view. No snapshot mutation.
  return state.statements.filter(s=>s.month===month).sort((a,b)=>b.version-a.version)[0];
}
export function monthOverview(state: AppState, month: string) {
  // Same month overlap and business/cancellation filters as buildStatement/groupTripsByDay.
  const trips = state.trips.filter(t=>t.tripType==='dienstlich' && t.status!=='storniert' && t.date<=`${month}-31` && (t.endDate || t.date)>=`${month}-01`);
  const expenses = state.expenses.filter(e=>e.status!=='storniert' && e.date.startsWith(month));
  const latest = latestStatement(state,month);
  const approved = !!latest && ['freigegeben','ausgezahlt'].includes(latest.status);
  const closed = approved && latest?.locked === true;
  const reasons = [...new Set([...trips, ...expenses].flatMap(t=>t.warnings).filter(w=>concreteWarnings.has(w)))];
  if (latest?.status==='storniert') reasons.unshift('Die jüngste Abrechnung wurde storniert.');
  else if (latest && (approved !== (latest.locked === true))) reasons.unshift('Gespeicherter Status und Abschlusssperre passen nicht zusammen.');
  const active = trips.length > 0 || expenses.length > 0;
  const status: MonthStatus = closed ? 'closed' : reasons.length ? 'review' : active ? 'working' : 'open';
  const countedTrips = closed ? latest!.data.rows.flatMap(row=>row.trips) : trips;
  return {month, status, label:statusLabels[status], tripCount:new Set(countedTrips.map(t=>t.id)).size, active, reasons:closed ? [] : reasons};
}
export function yearOverview(state: AppState, year: number) {
  return Array.from({length:12},(_,i)=>monthOverview(state,`${String(year).padStart(4,'0')}-${String(i+1).padStart(2,'0')}`));
}
export function openActivityMonths(state: AppState, date = new Date()) {
  const current = localCalendarMonth(date);
  const candidates = new Set<string>();
  for (const trip of state.trips) {
    if (trip.tripType!=='dienstlich' || trip.status==='storniert') continue;
    let month = trip.date.slice(0,7);
    const end = (trip.endDate || trip.date).slice(0,7);
    if (!isMonth(month) || !isMonth(end)) continue;
    while (month<=end && month<current) {
      candidates.add(month);
      const year = Number(month.slice(0,4)); const n = Number(month.slice(5,7));
      month = `${String(n===12 ? year+1 : year).padStart(4,'0')}-${String(n===12 ? 1 : n+1).padStart(2,'0')}`;
    }
  }
  for (const expense of state.expenses) {
    const month = expense.date.slice(0,7);
    if (expense.status!=='storniert' && isMonth(month) && month<current) candidates.add(month);
  }
  return [...candidates].sort().map(month=>monthOverview(state,month)).filter(m=>m.active && m.status!=='closed');
}
