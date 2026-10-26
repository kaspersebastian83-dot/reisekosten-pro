import type { AppState, Expense, ExpenseContext, Trip } from './types';

export function projectNumber(value = '') {
  return value.trim().match(/^(\d{2}\.\d{4})(?:\s|$)/)?.[1] || '';
}
export const isHotel = (category: string) => ['Hotel', 'Übernachtung'].includes(category);
export const validDate = (date = '') => /^\d{4}-\d{2}-\d{2}$/.test(date) &&
  !Number.isNaN(Date.parse(date)) && new Date(date + 'T12:00:00Z').toISOString().slice(0,10) === date;

export type LinkingInput = ExpenseContext & { category: string; date: string; tripId?: string };
export function linkingErrors(value: LinkingInput) {
  const errors: string[] = [];
  if (value.projectNumber?.trim() && !projectNumber(value.projectNumber)) errors.push('Projekt als Nummer 26.0123 oder mit Ort angeben.');
  if (isHotel(value.category) && (value.stayStart || value.stayEnd)) {
    if (!validDate(value.stayStart) || !validDate(value.stayEnd) || value.stayEnd! <= value.stayStart!) errors.push('Übernachtungsbeginn und -ende vollständig angeben; das Ende muss nach dem Beginn liegen.');
  }
  return errors;
}
export function matchingTrips(value: LinkingInput, trips: Trip[]) {
  const project = projectNumber(value.projectNumber);
  if (linkingErrors(value).length) return [];
  return trips.filter(t => {
    if (t.tripType !== 'dienstlich' || t.status === 'storniert') return false;
    if (project && projectNumber(t.order) !== project) return false;
    if (isHotel(value.category)) {
      // Invoice date is never a surrogate for a hotel's actual stay period.
      if (value.stayStart && value.stayEnd) return t.date <= value.stayStart && (t.endDate || t.date) >= value.stayEnd;
      return !!project; // Project-only possibilities require a visible period warning.
    }
    return validDate(value.date) && t.date <= value.date && (t.endDate || t.date) >= value.date;
  }).sort((a,b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}
export function cleanContext(value: ExpenseContext): ExpenseContext {
  return {
    projectNumber: projectNumber(value.projectNumber) || undefined,
    stayStart: value.stayStart || undefined,
    stayEnd: value.stayEnd || undefined,
    breakfastIncluded: value.breakfastIncluded || undefined,
    noTrip: value.noTrip || undefined,
  };
}
/**
 * Braucht diese Kostenposition keine Reise und kein Projekt? Ja, wenn sie ausdrücklich so erfasst wurde
 * („Gehört zu keiner Reise …“) oder im Innendienst. Eine trotzdem gesetzte Reise wird weiter geprüft.
 */
export const withoutTripNeeded = (value: { noTrip?: boolean; tripId?: string }, settings?: { staffRole?: string }) =>
  !value.tripId && (!!value.noTrip || settings?.staffRole === "innendienst");
const normalized = (value = '') => value.trim().toLocaleLowerCase('de-DE').replace(/\s+/g, ' ');
export function duplicateExpense(expenses: Expense[], draft: Partial<Expense>) {
  return expenses.find(e => e.id !== draft.id && (
    (!!draft.receipt?.hash && e.receipt?.hash === draft.receipt.hash) ||
    (!!normalized(draft.invoiceNumber) && !!normalized(draft.merchant) && normalized(e.invoiceNumber) === normalized(draft.invoiceNumber) && normalized(e.merchant) === normalized(draft.merchant))
  ));
}
export function duplicateMessage(state: AppState, draft: Partial<Expense>, inboxId?: string) {
  if (duplicateExpense(state.expenses, draft)) return 'Diese Rechnung ist bereits als Ausgabe erfasst. Bitte die vorhandene Ausgabe bearbeiten.';
  if (draft.receipt?.hash && state.receiptInbox.some(i => i.id !== inboxId && i.receipt.hash === draft.receipt?.hash && (!draft.id || i.expenseId !== draft.id))) return 'Dieser Beleg liegt bereits im Beleg-Eingang. Bitte dort prüfen statt erneut erfassen.';
  return '';
}
export function syncExpenseLink(state: AppState, expense: Expense) {
  // The confirmed concrete trip ID is the reference. Never recalculate it on load.
  state.receiptInbox = state.receiptInbox.map(item => item.expenseId === expense.id ? {
    ...item, tripId: expense.tripId, paymentType: expense.paymentType,
    receipt: expense.receipt || item.receipt,
    suggestion: {...item.suggestion, ...cleanContext(expense), date:expense.date, gross:expense.gross, merchant:expense.merchant, invoiceNumber:expense.invoiceNumber, category:expense.category, vatRate:expense.vatRate},
  } : item);
}
export function paymentLabel(payment: string) {
  return payment === 'privat vorgestreckt' ? 'Privat bezahlt' :
    ['Firmenkarte', 'Unternehmen'].includes(payment) ? 'Vom Unternehmen bezahlt' :
    payment === 'bereits erstattet' ? 'Bereits erstattet' : 'Zahlungsart ungeklärt – keine Auszahlung';
}
export function paymentPayer(payment: string) {
  return payment === 'privat vorgestreckt' ? 'Reisender' : ['Firmenkarte', 'Unternehmen'].includes(payment) ? 'Unternehmen' : '';
}
export function similarExpense(expenses: Expense[], draft: Partial<Expense>) {
  return expenses.find(e => e.id !== draft.id && !!normalized(draft.merchant) && normalized(e.merchant) === normalized(draft.merchant) && e.date === draft.date && e.gross === draft.gross && (!e.invoiceNumber || !draft.invoiceNumber));
}
