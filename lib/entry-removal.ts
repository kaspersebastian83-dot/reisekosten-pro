import type { AppState } from "./types";

/*
 * Löschen einzelner Reisen und Kostenpositionen mit Eintrag im Änderungsprotokoll.
 * Gespeicherte Abrechnungen bleiben unberührt (sie enthalten eigene Kopien).
 */
export interface RemovalContext { id: string; user: string; at: string }

export function removeTrip(state: AppState, tripId: string, ctx: RemovalContext): AppState {
  const old = state.trips.find((t) => t.id === tripId);
  if (!old) return state;
  state.changes.push({ id: ctx.id, entityType: "trip", entityId: tripId, field: "Status", oldValue: old, newValue: "gelöscht", reason: "Manuell gelöscht", user: ctx.user, changedAt: ctx.at });
  state.trips = state.trips.filter((t) => t.id !== tripId);
  return state;
}

/**
 * Entfernt eine Kostenposition. Ein Beleg, der aus dem Beleg-Eingang stammt, geht nicht verloren:
 * der Eingangseintrag wird wieder „offen“ (ohne Zuordnung), damit er neu zugeordnet oder bewusst archiviert werden kann.
 */
export function removeExpense(state: AppState, expenseId: string, ctx: RemovalContext): { state: AppState; returnedToInbox: number } {
  const old = state.expenses.find((e) => e.id === expenseId);
  if (!old) return { state, returnedToInbox: 0 };
  state.changes.push({ id: ctx.id, entityType: "expense", entityId: expenseId, field: "Status", oldValue: old, newValue: "gelöscht", reason: "Manuell gelöscht", user: ctx.user, changedAt: ctx.at });
  state.expenses = state.expenses.filter((e) => e.id !== expenseId);
  let returnedToInbox = 0;
  state.receiptInbox = state.receiptInbox.map((item) => {
    if (item.expenseId !== expenseId) return item;
    returnedToInbox++;
    return { ...item, status: item.suggestion.rawText ? "erkannt" : "neu", expenseId: undefined };
  });
  return { state, returnedToInbox };
}

/** Offene Belege im Eingang (noch keiner Kostenposition zugeordnet, nicht archiviert), älteste zuerst. */
export function openInboxItems(state: AppState) {
  return state.receiptInbox.filter((item) => item.status === "neu" || item.status === "erkannt").sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
}
