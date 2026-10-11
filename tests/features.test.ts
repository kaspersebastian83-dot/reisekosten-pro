import { describe, expect, it } from "vitest";
import { buildStatement, calculateDay, round2 } from "../lib/calculations";
import { csvRecordLines, rowsToTrips, suggestMapping } from "../lib/importer";
import { demoState } from "../lib/demo";
import { normalizeState } from "../lib/storage";

const mapping = { date: "date", endDate: "endDate", startTime: "start", endTime: "end", businessKm: "km" };
const source = { date: "09.03.2026", start: "08:00", end: "17:00", km: "12,50" };

describe("Importprüfung", () => {
  it("zeigt bestehende und dateiinterne Duplikate statt sie aus der Vorschau zu entfernen", () => {
    const first = rowsToTrips([source], mapping, []).trips[0];
    const result = rowsToTrips([source, source, { ...source, date: "10.03.2026" }, { ...source, date: "10.03.2026" }], mapping, [first]);
    expect(result.review.map((r) => r.status)).toEqual(["duplicate", "duplicate", "ready", "duplicate"]);
    expect(result.review[0].reason).toContain("gespeichert");
    expect(result.review[3].reason).toContain("Datei");
    expect(result.review.map((r) => r.index)).toEqual([0, 1, 2, 3]);
  });
  it.each([
    { date: "2026-02-31" }, { endDate: "31.02.2026" }, { endDate: "08.03.2026" },
    { start: "25:00" }, { km: "kaputt" }, { km: "-2" },
  ])("lässt ungültige Zeilen nicht bestätigen: %s", (patch) => {
    const result = rowsToTrips([{ ...source, ...patch }], mapping, []);
    expect(result.trips).toHaveLength(0); expect(result.review[0].status).toBe("invalid");
    expect(result.review[0].reason).toContain("korrigieren");
  });
  it("erhält optionale Leerzeiten und Excel-Uhrzeiten", () => {
    expect(rowsToTrips([{ ...source, start: "", end: "" }], mapping, []).review[0].status).toBe("ready");
    expect(rowsToTrips([{ ...source, start: 0.5 }], mapping, []).trips[0].startTime).toBe("12:00");
  });
  it("zeigt private und Arbeitsweg-Zeilen mit Gründen", () => {
    const headers = ["Abfahrt_datum", "Abfahrt_uhrzeit", "Ankunft_datum", "Ankunft_uhrzeit", "Betrieb_km", "Arbeitsweg_km", "Privat_km"];
    const rows = [{ Abfahrt_datum: source.date, Betrieb_km: 0, Arbeitsweg_km: 10, Privat_km: 0 }, { Abfahrt_datum: source.date, Betrieb_km: 0, Arbeitsweg_km: 0, Privat_km: 10 }];
    const result = rowsToTrips(rows, suggestMapping(headers), []);
    expect(result.review.map((r) => r.status)).toEqual(["excluded", "excluded"]);
    expect(result.ignoredCommute).toBe(1); expect(result.ignoredPrivate).toBe(1);
  });
  it("macht die bestehenden Nicht-Erstattungsregeln auch bei zugeordneten allgemeinen Fahrtenarten sichtbar", () => {
    const result = rowsToTrips([{ ...source, kind: "privat" }, { ...source, kind: "erste Tätigkeitsstätte" }], { ...mapping, tripType: "kind" }, []);
    expect(result.review.map((r) => r.status)).toEqual(["excluded", "excluded"]);
    expect(result.trips).toHaveLength(0);
  });
  it("verfolgt echte CSV-Quellzeilen auch bei Leerzeilen, CRLF und mehrzeiligen Feldern", () => {
    expect(csvRecordLines('Datum;Ziel\r\n\r\n09.03.2026;"Ziel\r\nmit \"\"Zitat\"\""\r\n10.03.2026;B\r\n')).toEqual([1, 3, 5]);
  });
  it("sperrt fehlerhafte CSV-Datensätze", () => {
    expect(rowsToTrips([source], mapping, [], [], "", "", "", [0]).review[0].status).toBe("invalid");
  });
});

describe("Gespeicherte Erklärung aus derselben Berechnung", () => {
  it.each([0, 20])("erklärt gestelltes Frühstück auch bei %s Prozent", (percent) => {
    const state = demoState(); state.settings.tariffs.find((t) => t.kind === "breakfast")!.amount = percent;
    const trip = { ...state.trips[0], startTime: "08:00", endTime: "17:00", meals: { breakfast: true, lunch: true, dinner: false } };
    const result = calculateDay(trip.date, [trip], state.settings);
    expect(result.calculation?.meals.breakfast).toBe(true);
    expect(result.calculation?.mealPercent.breakfast).toBe(percent);
    expect(result.breakfastCut).toBe(round2(result.calculation!.fullRate * percent / 100));
    expect(result.allowanceAfter).toBe(Math.max(0, round2(result.allowanceBefore - result.breakfastCut - result.lunchCut - result.dinnerCut)));
  });
  it.each(["dienstwagen", "privatwagen"] as const)("versöhnt %s, Ausgaben und Tages-/Monatssummen", (ownership) => {
    const state = demoState(); state.settings.vehicles[0].ownership = ownership;
    state.settings.vehicles[0].reimbursementMethod = ownership === "privatwagen" ? "pauschale" : "keine";
    state.trips = [{ ...state.trips[0], date: "2026-07-14", vehicleId: state.settings.vehicles[0].id }];
    state.expenses = [{ ...state.expenses[0], date: "2026-07-15", category: "Parken", gross: 15.55, businessShare: 50, paymentType: "privat vorgestreckt", reimbursementStatus: "offen" }];
    const result = buildStatement(state, "2026-07");
    for (const row of result.rows) {
      expect(row.mileage).toBe(round2(row.contributions!.mileage.reduce((sum, x) => sum + x.amount, 0)));
      expect(row.openAmount).toBe(round2(row.allowanceAfter + row.mileage + row.contributions!.openExpenses));
    }
    expect(result.rows[1].contributions!.expenses[0].openAmount).toBe(7.78);
    expect(result.totals.openAmount).toBe(round2(result.rows.reduce((sum, r) => sum + r.openAmount, 0)));
  });
  it("erklärt Monatsübergreifende Kilometer nur am Starttag", () => {
    const state = demoState(); state.expenses = [];
    state.trips = [{ ...state.trips[0], date: "2026-06-30", endDate: "2026-08-01" }];
    const result = buildStatement(state, "2026-07");
    expect(result.rows).toHaveLength(31);
    expect(result.rows.every((r) => r.contributions!.mileage[0].km === 0 && r.contributions!.mileage[0].reason.includes("Abfahrtstag"))).toBe(true);
  });
  it("erhält eingefrorene Erklärung und alte Sicherungen ohne erfundene Details", () => {
    const state = demoState(); const data = buildStatement(state, "2026-07");
    state.statements = [{ id: "synthetic", month: "2026-07", number: "TEST", createdAt: "2026-07-31", status: "freigegeben", locked: true, version: 1, data, settingsSnapshot: structuredClone(state.settings), expensesSnapshot: structuredClone(state.expenses) }];
    const saved = JSON.stringify(state.statements[0]); state.settings.tariffs.forEach((t) => t.amount = 0); state.expenses = [];
    expect(JSON.stringify(normalizeState(state).statements[0])).toBe(saved);
    const legacy = structuredClone(state); legacy.statements[0].data.rows.forEach((r) => { delete r.calculation; delete r.contributions; });
    expect(normalizeState(legacy).statements[0].data.rows.every((r) => !r.calculation && !r.contributions)).toBe(true);
  });  it("weist beschädigte optionale Erklärungsdaten bei JSON-Wiederherstellung zurück", () => {
    const state = demoState();
    state.statements = [{ id: "synthetic", month: "2026-07", number: "TEST", createdAt: "2026-07-31", status: "freigegeben", locked: true, version: 1, data: buildStatement(state, "2026-07") }];
    const bad = JSON.parse(JSON.stringify(state)); bad.statements[0].data.rows[0].contributions.mileage = "broken";
    expect(() => normalizeState(bad)).toThrow("Ungültiges Datenformat");
  });

});
