import { describe, expect, it } from "vitest";
import { emptyState } from "../lib/config";
import { demoState } from "../lib/demo";
import { buildStatement, calculateDay, groupTripsByDay } from "../lib/calculations";
import { rowsToTrips } from "../lib/importer";
import { normalizeState } from "../lib/storage";

const mapping = { date: "Datum", startTime: "Beginn", endTime: "Ende", businessKm: "km" };
const row = { Datum: "14.07.2026", Beginn: "08:00", Ende: "17:00", km: 68.5 };

describe("bestätigte Importdefekte", () => {
  it.each([68.5, "68.5", "68,5", "1.234,50"])("bewahrt Kilometerwert %s", (km) => {
    expect(rowsToTrips([{ ...row, km }], mapping, []).trips[0].businessKm).toBe(km === "1.234,50" ? 1234.5 : 68.5);
  });
  it("interpretiert leere Zeiten nicht als Mitternacht", () => {
    const trip = rowsToTrips([{ ...row, Beginn: "", Ende: "" }], mapping, []).trips[0];
    expect(trip.startTime).toBe("");
    expect(trip.endTime).toBe("");
  });
  it("weist unmögliche deutsche Kalenderdaten zurück", () => {
    expect(rowsToTrips([{ ...row, Datum: "31.02.2026" }], mapping, []).invalid).toBe(1);
  });
  it("liest Excel-Uhrzeiten als Date statt als 00:00", () => {
    const trip = rowsToTrips([{ ...row, Beginn: new Date("1899-12-30T08:30:00Z") }], mapping, []).trips[0];
    expect(trip.startTime).toBe("08:30:00");
  });
});

describe("Abrechnungsregressionen", () => {
  it("erhält Kalenderdaten auch in Zeitzonen vor UTC", () => {
    const oldTimezone = process.env.TZ;
    try {
      process.env.TZ = "Pacific/Auckland";
      const trip = { ...demoState().trips[0], date: "2026-07-14" };
      expect([...groupTripsByDay([trip]).keys()]).toEqual(["2026-07-14"]);
    } finally { if (oldTimezone === undefined) delete process.env.TZ; else process.env.TZ = oldTimezone; }
  });
  it("berücksichtigt Ausgaben ohne Fahrt und ohne Kilometer-/Spesenanspruch", () => {
    const state = demoState(); state.trips = [];
    const expense = { ...state.expenses[0], gross: 15, date: "2026-07-20", category: "Parken", paymentType: "privat vorgestreckt" as const, reimbursementStatus: "offen" as const };
    state.expenses = [expense];
    const result = buildStatement(state, "2026-07");
    expect(result.rows[0].date).toBe("2026-07-20");
    expect(result.totals.openAmount).toBe(15);
    expect(result.totals.allowance).toBe(0);
    expect(result.totals.mileage).toBe(0);
  });
  it("lässt stornierte Ausgaben aus", () => {
    const state = demoState(); state.trips = [];
    state.expenses = [{ ...state.expenses[0], status: "storniert" }];
    expect(buildStatement(state, "2026-07").rows).toHaveLength(0);
  });
  it("berücksichtigt eine Reise, die einen ganzen Monat überspannt", () => {
    const state = demoState(); state.expenses = [];
    state.trips = [{ ...state.trips[0], date: "2026-06-30", endDate: "2026-08-01", overnight: true }];
    const result = buildStatement(state, "2026-07");
    expect(result.rows).toHaveLength(31);
    expect(result.totals.allowance).toBe(31 * 28);
    expect(result.totals.mileage).toBe(0);
  });
  it("respektiert ausdrücklich auf null konfigurierte Mahlzeitenkürzungen", () => {
    const state = demoState();
    state.settings.tariffs.find((t) => t.kind === "breakfast")!.amount = 0;
    const trip = { ...state.trips[0], startTime: "08:00", endTime: "17:00", meals: { breakfast: true, lunch: false, dinner: false } };
    expect(calculateDay(trip.date, [trip], state.settings).breakfastCut).toBe(0);
  });
});

describe("kompatible und sichere Sicherungen", () => {
  it("erhält gültige Daten und ergänzt ältere optionale Sammlungen", () => {
    const state = demoState();
    const legacy = { ...state, receiptInbox: undefined, merchantRules: undefined };
    const normalized = normalizeState(legacy);
    expect(normalized.trips).toEqual(state.trips);
    expect(normalized.expenses).toEqual(state.expenses);
    expect(normalized.receiptInbox).toEqual([]);
    expect(normalized.merchantRules).toEqual([]);
  });
  it.each([null, { ...emptyState, expenses: "broken" }, { ...emptyState, trips: [null] }, { ...emptyState, settings: { tariffs: [null] } }, { ...emptyState, receiptInbox: [{ receipt: null }] }])("weist defekte Sicherungen vor einem State-Wechsel zurück", (value) => {
    expect(() => normalizeState(value as never)).toThrow("Ungültiges Datenformat");
  });
  it("weist defekte verschachtelte Abrechnungen zurück", () => {
    const state = demoState();
    state.statements = [{ id: "test", month: "2026-07", number: "TEST", createdAt: "", status: "freigegeben", version: 1, locked: true, data: { ...buildStatement(state, "2026-07"), rows: [null as never] } }];
    expect(() => normalizeState(state)).toThrow("Ungültiges Datenformat");
  });
  it("ändert die übergebene Sicherung nicht", () => {
    const state = demoState(); const copy = structuredClone(state);
    normalizeState(state); expect(state).toEqual(copy);
  });
});
