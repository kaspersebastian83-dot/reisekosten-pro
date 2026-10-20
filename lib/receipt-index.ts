import type { AppState, Expense, StatementData } from './types';

export type ExportExpense = Pick<Expense, 'id' | 'date' | 'category' | 'description' | 'gross' | 'currency' | 'businessShare' | 'exchangeRate'> & Partial<Omit<Expense, 'paymentType' | 'reimbursementStatus'>> & { paymentType: string; reimbursementStatus: string };
export interface ReceiptEntry {
  number: string;
  expense: ExportExpense;
  /** Ausschließlich aus dem gespeicherten Rechenstand, keine neue Erstattungsberechnung. */
  personalAmount: number | null;
  excluded: boolean;
  historicalDetailsMissing: boolean;
  archivePath?: string;
}
const safePart = (name: string) => name.replace(/[\\/\x00-\x1f]/g, '_');

/** Eine stabile Referenz je Kostenposition, auch bei fehlendem Beleg oder gleichen Dateinamen. */
export function receiptIndex(data: StatementData, state: AppState): ReceiptEntry[] {
  const captured = new Map(data.rows.flatMap(row => (row.contributions?.expenses || []).map(expense => [expense.id, { ...expense, date: row.date }] as const)));
  const expenses: ExportExpense[] = state.expenses.filter(expense => expense.status !== 'storniert' && expense.date.startsWith(data.month));
  const known = new Set(expenses.map(expense => expense.id));
  // Ältere Abschlüsse können Beträge ohne vollständige Beleg-Snapshots enthalten. Keine aktuellen Dateien ergänzen.
  for (const [id, expense] of captured) if (!known.has(id)) expenses.push(expense);
  return [...expenses].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)).map((expense, i) => ({
    number: `B-${data.month.replace('-', '')}-${String(i + 1).padStart(3, '0')}`,
    expense,
    personalAmount: captured.get(expense.id)?.openAmount ?? null,
    excluded: captured.get(expense.id)?.excluded ?? false,
    historicalDetailsMissing: !known.has(expense.id),
    archivePath: expense.receipt ? `Belege/${safePart(expense.id)}_${safePart(expense.receipt.name)}` : undefined,
  }));
}
