import { describe, expect, it } from "vitest";
import { dayAfter, nextExpenseDraft, nextTripDraft } from "../lib/batch-entry";
import { demoState } from "../lib/demo";
import type { Expense, Trip } from "../lib/types";

const blankTrip = (): Trip => ({ ...demoState().trips[0], id: "neu", date: "2026-10-18", endDate: "2026-10-18", startTime: "08:00", endTime: "17:00", startPlace: "", destination: "", purpose: "", customer: "", order: "", costCenter: "", businessKm: 0, privateKm: 0, overnight: false, notes: "", warnings: [], status: "ungeprüft" });
const blankExpense = (): Expense => ({ ...demoState().expenses[0], id: "neu", date: "2026-10-18", description: "", gross: 0, net: 0, receipt: undefined, tripId: undefined, projectNumber: undefined, merchant: undefined, invoiceNumber: undefined, warnings: [], status: "ungeprüft" });

describe("Stapelerfassung", () => {
  it("rechnet den Folgetag über Monats- und Jahreswechsel", () => {
    expect(dayAfter("2026-07-14")).toBe("2026-07-15");
    expect(dayAfter("2026-07-31")).toBe("2026-08-01");
    expect(dayAfter("2026-12-31")).toBe("2027-01-01");
    expect(dayAfter("2028-02-28")).toBe("2028-02-29");
    expect(dayAfter("kaputt")).toBe("kaputt");
  });

  it("belegt die nächste Reise mit Folgetag, Fahrzeug und Zeiten vor, Inhalt bleibt leer", () => {
    const prev: Trip = { ...blankTrip(), id: "alt", date: "2026-07-13", endDate: "2026-07-14", startTime: "06:30", endTime: "19:15", startPlace: "Büro", destination: "Musterstadt", purpose: "Bauleitung", order: "26.0123 Musterstadt", customer: "Kunde", businessKm: 120, overnight: true, vehicleId: "v1", vehicle: "Kombi", plate: "M-XY 1", vehicleType: "privatfahrzeug" };
    const next = nextTripDraft(prev, blankTrip());
    expect(next).toMatchObject({ id: "neu", date: "2026-07-15", endDate: "2026-07-15", startTime: "06:30", endTime: "19:15", startPlace: "Büro", vehicleId: "v1", vehicle: "Kombi", plate: "M-XY 1", vehicleType: "privatfahrzeug" });
    expect(next).toMatchObject({ destination: "", purpose: "", order: "", customer: "", businessKm: 0, overnight: false });
  });

  it("belegt die nächste Kostenposition mit Datum, Zahlungsart und Bezug vor, ohne Betrag und Beleg", () => {
    const prev: Expense = { ...blankExpense(), id: "alt", date: "2026-07-14", paymentType: "Firmenkarte", paidBy: "Firma", tripId: "t1", projectNumber: "26.0123", description: "Parkhaus", gross: 12.5, net: 10.5, merchant: "Parkhaus Mitte", invoiceNumber: "R-1", receipt: { id: "r", name: "a.pdf", type: "application/pdf", size: 1, hash: "h", dataUrl: "data:," } };
    const next = nextExpenseDraft(prev, blankExpense());
    expect(next).toMatchObject({ id: "neu", date: "2026-07-14", paymentType: "Firmenkarte", paidBy: "Firma", tripId: "t1", projectNumber: "26.0123" });
    expect(next).toMatchObject({ description: "", gross: 0, net: 0 });
    expect(next.receipt).toBeUndefined();
    expect(next.merchant).toBeUndefined();
    expect(next.invoiceNumber).toBeUndefined();
  });
});
