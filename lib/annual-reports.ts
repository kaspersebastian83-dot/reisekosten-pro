import { buildStatement } from './calculations';
import { projectNumber } from './receipt-linking';
import { yearOverview } from './month-navigation';
import type { AppState, Expense, StatementData, Trip } from './types';

export const reportMonthNames = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];

export interface AnnualAnalysis {
  year: number;
  months: { month: string; label: string; statement: StatementData }[];
  totals: {
    grandTotal: number;
    allowance: number;
    mileage: number;
    accommodation: number;
    fuel: number;
    other: number;
    openAmount: number;
    companyPaid: number;
    reimbursed: number;
    privatelyAdvanced: number;
    unknownPayment: number;
  };
  tripCount: number;
  businessKm: number;
  allowanceDayCount: number;
  travelDayCount: number;
  entryMonthCount: number;
  closedMonthCount: number;
  projects: { key: string; label: string; amount: number }[];
  unassignedProjectCosts: number;
}

const add = (a: number, b: number) => Math.round((a + b + Number.EPSILON) * 100) / 100;
const inYear = (date: string, year: number) => date.slice(0, 4) === String(year).padStart(4, '0');

function resolveTripProject(trip: Trip) {
  return projectNumber(trip.order);
}

function resolveExpenseProject(expense: Expense, trips: Map<string, Trip>) {
  const directValue = expense.projectNumber?.trim() || '';
  const direct = projectNumber(directValue);
  if (directValue && !direct) return '';
  const linkedTrip = expense.tripId ? trips.get(expense.tripId) : undefined;
  const linked = linkedTrip ? resolveTripProject(linkedTrip) : '';
  if (direct && linked && direct !== linked) return '';
  return direct || linked;
}

/** Builds read-only analysis from the same twelve monthly calculations used by statements. */
export function buildAnnualAnalysis(state: AppState, year: number): AnnualAnalysis {
  const yearText = String(year).padStart(4, '0');
  const months = reportMonthNames.map((label, index) => {
    const month = `${yearText}-${String(index + 1).padStart(2, '0')}`;
    return { month, label, statement: buildStatement(state, month) };
  });
  const totals = months.reduce((sum, item) => {
    const current = item.statement.totals;
    sum.allowance = add(sum.allowance, current.allowance);
    sum.mileage = add(sum.mileage, current.mileage);
    sum.accommodation = add(sum.accommodation, current.accommodation);
    sum.fuel = add(sum.fuel, current.fuel);
    sum.other = add(sum.other, current.other);
    sum.openAmount = add(sum.openAmount, current.openAmount);
    sum.companyPaid = add(sum.companyPaid, current.companyPaid);
    sum.reimbursed = add(sum.reimbursed, current.reimbursed);
    sum.privatelyAdvanced = add(sum.privatelyAdvanced, current.privatelyAdvanced);
    return sum;
  }, { allowance: 0, mileage: 0, accommodation: 0, fuel: 0, other: 0, openAmount: 0, companyPaid: 0, reimbursed: 0, privatelyAdvanced: 0, unknownPayment: 0, grandTotal: 0 });
  totals.grandTotal = add(add(add(totals.allowance, totals.mileage), totals.accommodation), add(totals.fuel, totals.other));

  const tripById = new Map(state.trips.map(trip => [trip.id, trip]));
  const expenseById = new Map(state.expenses.map(expense => [expense.id, expense]));
  const yearlyTrips = state.trips.filter(trip => trip.tripType === 'dienstlich' && trip.status !== 'storniert' && trip.date.slice(0, 4) <= yearText && (trip.endDate || trip.date).slice(0, 4) >= yearText);
  const tripIds = new Set<string>();
  const travelDays = new Set<string>();
  const allowanceDays = new Set<string>();
  const entryMonths = new Set<string>();
  let businessKm = 0;
  const projectAmounts = new Map<string, number>();
  const projectLabels = new Map<string, Set<string>>();
  let unassignedProjectCosts = 0;
  const projectCost = (key: string, amount: number) => {
    if (amount === 0) return;
    if (!key) { unassignedProjectCosts = add(unassignedProjectCosts, amount); return; }
    projectAmounts.set(key, add(projectAmounts.get(key) || 0, amount));
  };
  const rememberProjectLabel = (key: string, raw: string) => {
    const label = raw.trim().replace(/\s+/g, ' ');
    if (!key || !label || label.length <= key.length || projectNumber(label) !== key) return;
    const labels = projectLabels.get(key) || new Set<string>();
    labels.add(label);
    projectLabels.set(key, labels);
  };
  for (const trip of yearlyTrips) {
    const key = resolveTripProject(trip);
    rememberProjectLabel(key, trip.order);
  }

  for (const { month, statement } of months) {
    for (const row of statement.rows) {
      businessKm = add(businessKm, row.totalKm);
      if (row.allowanceAfter > 0) allowanceDays.add(row.date);
      if (row.trips.length) {
        entryMonths.add(month);
        for (const trip of row.trips) {
          tripIds.add(trip.id);
          travelDays.add(row.date);
        }
      }
      const rowProjectKeys = row.trips.map(resolveTripProject);
      const allowanceProject = rowProjectKeys.length && rowProjectKeys.every(Boolean) && new Set(rowProjectKeys).size === 1 ? rowProjectKeys[0] : '';
      projectCost(allowanceProject, row.allowanceAfter);
      for (const mileage of row.contributions?.mileage || []) {
        const trip = tripById.get(mileage.tripId);
        projectCost(trip ? resolveTripProject(trip) : '', mileage.amount);
      }
      for (const expenseDetail of row.contributions?.expenses || []) {
        const expense = expenseById.get(expenseDetail.id);
        if (!expense) continue;
        entryMonths.add(month);
        if (expense.paymentType === 'unbekannt') totals.unknownPayment = add(totals.unknownPayment, expense.gross);
        const key = resolveExpenseProject(expense, tripById);
        rememberProjectLabel(key, expense.projectNumber || '');
        if (!expenseDetail.excluded) projectCost(key, expense.gross);
      }
    }
  }
  // A month can contain an expense-only row without a corresponding travel day.
  for (const expense of state.expenses) {
    if (expense.status !== 'storniert' && inYear(expense.date, year)) entryMonths.add(expense.date.slice(0, 7));
  }

  const closedMonthCount = yearOverview(state, year).filter(item => item.status === 'closed').length;
  const projects = [...projectAmounts].map(([key, amount]) => {
    const labels = [...(projectLabels.get(key) || [])].sort((a, b) => b.length - a.length || a.localeCompare(b, 'de'));
    const consistentLabel = labels.length <= 1 ? labels[0] : '';
    return { key, label: consistentLabel || key, amount };
  }).sort((a, b) => b.amount - a.amount || a.key.localeCompare(b.key));
  return { year, months, totals, tripCount: tripIds.size, businessKm, allowanceDayCount: allowanceDays.size, travelDayCount: travelDays.size, entryMonthCount: entryMonths.size, closedMonthCount, projects, unassignedProjectCosts };
}
