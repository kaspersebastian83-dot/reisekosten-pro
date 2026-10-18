import type { AppState, Expense, StatementData, Trip } from "./types";

/*
 * Kompakte Monatsansicht: je Kalendertag eine Kopfzeile (Verpflegung aus der bestehenden Monatsberechnung) und
 * darunter je Reise und Kostenposition eine Zeile. Reine Darstellung – rechnet nichts selbst.
 * Monatszuordnung wie in buildStatement: Reisen nach Überlappung, Kosten nach Rechnungsdatum.
 */
export type TimelineEntry =
  | { kind: "trip"; trip: Trip; continued: boolean; dayOfTrip: number; days: number }
  | { kind: "expense"; expense: Expense };
export interface TimelineDay {
  date: string;
  allowance: number | null;
  allowanceReason: string;
  entries: TimelineEntry[];
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);

export function monthTimeline(state: AppState, month: string, statement: StatementData): TimelineDay[] {
  const rows = new Map(statement.rows.map((row) => [row.date, row]));
  const days = new Map<string, TimelineDay>();
  const day = (date: string) => {
    if (!days.has(date)) {
      const row = rows.get(date);
      days.set(date, { date, allowance: row && row.trips.length ? row.allowanceAfter : null, allowanceReason: row?.reason || "", entries: [] });
    }
    return days.get(date)!;
  };
  // Reisen: an jedem Tag der Berechnung, an dem sie vorkommen (Folgetage als „fortgesetzt“).
  for (const row of statement.rows) {
    for (const trip of [...row.trips].sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime))) {
      const span = daysBetween(trip.date, trip.endDate || trip.date) + 1;
      day(row.date).entries.push({ kind: "trip", trip, continued: trip.date !== row.date, dayOfTrip: daysBetween(trip.date, row.date) + 1, days: span });
    }
  }
  // Kosten nach Rechnungsdatum (auch an Tagen ohne Reise); stornierte nicht.
  for (const expense of state.expenses.filter((e) => e.status !== "storniert" && e.date.startsWith(month)).sort((a, b) => a.date.localeCompare(b.date))) {
    day(expense.date).entries.push({ kind: "expense", expense });
  }
  return [...days.values()].filter((d) => d.date.startsWith(month)).sort((a, b) => a.date.localeCompare(b.date));
}

/** Filter für „Prüfen“: nur Einträge, die zur jeweiligen Prüfzeile gehören (gleiche Kriterien wie die Zählung dort). */
export type TimelineFilter = "trips" | "expenses" | "receipts" | "duplicates";
export const timelineFilterLabels: Record<TimelineFilter, string> = {
  trips: "Ungeprüfte Reisen / Reisehinweise",
  expenses: "Ungeprüfte Kosten / Kostenhinweise",
  receipts: "Fehlende Belege",
  duplicates: "Mögliche Duplikate",
};
export function matchesTimelineFilter(entry: TimelineEntry, filter: TimelineFilter): boolean {
  if (entry.kind === "trip") {
    const t = entry.trip;
    if (filter === "trips") return t.warnings.length > 0 || t.status === "ungeprüft" || t.status === "importiert";
    if (filter === "duplicates") return t.warnings.some((w) => w.toLowerCase().includes("duplikat"));
    return false;
  }
  const e = entry.expense;
  if (filter === "expenses") return e.warnings.length > 0 || e.status === "ungeprüft";
  if (filter === "receipts") return !e.receipt;
  return false;
}
export function filterTimeline(days: TimelineDay[], filter: TimelineFilter | null): TimelineDay[] {
  if (!filter) return days;
  return days.map((d) => ({ ...d, entries: d.entries.filter((e) => matchesTimelineFilter(e, filter)) })).filter((d) => d.entries.length > 0);
}
