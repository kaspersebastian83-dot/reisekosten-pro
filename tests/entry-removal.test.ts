import { describe, expect, it } from "vitest";
import { demoState } from "../lib/demo";
import { openInboxItems, removeExpense, removeTrip } from "../lib/entry-removal";
import { buildStatement } from "../lib/calculations";
import { filterTimeline, monthTimeline } from "../lib/month-timeline";
import type { ReceiptInboxItem } from "../lib/types";

const ctx = { id: "chg", user: "Test", at: "2026-10-18T10:00:00.000Z" };
const inbox = (id: string, over: Partial<ReceiptInboxItem> = {}): ReceiptInboxItem => ({ id, receipt: { id: `r-${id}`, name: `${id}.pdf`, type: "application/pdf", size: 1, hash: id, dataUrl: "data:," }, capturedAt: `2026-07-0${id.length}T10:00:00Z`, status: "neu", suggestion: { confidence: 0 }, notes: "", ...over });

describe("Löschen aus dem Bearbeitungsfenster", () => {
  it("entfernt eine Reise mit Protokolleintrag und lässt Abrechnungen unberührt", () => {
    const state = demoState(); const trip = state.trips[0]; const statements = structuredClone(state.statements);
    removeTrip(state, trip.id, ctx);
    expect(state.trips.some((t) => t.id === trip.id)).toBe(false);
    expect(state.changes.at(-1)).toMatchObject({ entityType: "trip", entityId: trip.id, newValue: "gelöscht", reason: "Manuell gelöscht", oldValue: trip });
    expect(state.statements).toEqual(statements);
  });

  it("entfernt eine Kostenposition und gibt den Beleg in den Eingang zurück", () => {
    const state = demoState(); const expense = state.expenses[0];
    state.receiptInbox = [inbox("a", { status: "zugeordnet", expenseId: expense.id }), inbox("bb", { status: "zugeordnet", expenseId: "andere" })];
    const { returnedToInbox } = removeExpense(state, expense.id, ctx);
    expect(returnedToInbox).toBe(1);
    expect(state.expenses.some((e) => e.id === expense.id)).toBe(false);
    expect(state.receiptInbox[0]).toMatchObject({ status: "neu", expenseId: undefined });
    expect(state.receiptInbox[1]).toMatchObject({ status: "zugeordnet", expenseId: "andere" });
    expect(state.changes.at(-1)).toMatchObject({ entityType: "expense", entityId: expense.id, newValue: "gelöscht" });
  });

  it("tut bei unbekannter ID nichts", () => {
    const state = demoState(); const before = structuredClone(state);
    removeTrip(state, "gibt-es-nicht", ctx); removeExpense(state, "gibt-es-nicht", ctx);
    expect(state).toEqual(before);
  });
});

describe("Beleg-Eingang der Reihe nach", () => {
  it("liefert nur offene Belege, älteste zuerst", () => {
    const state = demoState();
    state.receiptInbox = [inbox("ccc"), inbox("a", { status: "erkannt" }), inbox("bb", { status: "zugeordnet" }), inbox("dddd", { status: "archiviert" })];
    expect(openInboxItems(state).map((i) => i.id)).toEqual(["a", "ccc"]);
  });
});

describe("Zeitleistenfilter aus „Prüfen“", () => {
  it("zeigt nur passende Einträge und blendet leere Tage aus", () => {
    const state = demoState(); const month = "2026-07";
    const days = monthTimeline(state, month, buildStatement(state, month));
    const missing = filterTimeline(days, "receipts").flatMap((d) => d.entries);
    expect(missing.length).toBeGreaterThan(0);
    expect(missing.every((e) => e.kind === "expense" && !e.expense.receipt)).toBe(true);
    expect(filterTimeline(days, "receipts").every((d) => d.entries.length > 0)).toBe(true);
    expect(filterTimeline(days, null)).toBe(days);
    const trips = filterTimeline(days, "trips").flatMap((d) => d.entries);
    expect(trips.every((e) => e.kind === "trip" && (e.trip.warnings.length > 0 || ["ungeprüft", "importiert"].includes(e.trip.status)))).toBe(true);
  });
});
