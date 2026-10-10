import { describe, expect, it } from "vitest";
import {
  buildStatement,
  calculateDay,
  duplicateKey,
  minutesBetween,
  round2,
  tariffFor,
} from "../lib/calculations";
import { defaultSettings } from "../lib/config";
import { demoState } from "../lib/demo";
import { rowsToTrips } from "../lib/importer";
import { normalizeState } from "../lib/storage";
import type { Settings, Trip } from "../lib/types";

const base = (start: string, end: string, extra: Partial<Trip> = {}): Trip => ({
  id: Math.random().toString(),
  date: "2026-07-14",
  startTime: start,
  endTime: end,
  startPlace: "Köln",
  destination: "Bonn",
  purpose: "Ortstermin",
  customer: "Kunde",
  order: "",
  costCenter: "",
  plate: "",
  vehicle: "",
  vehicleType: "privatfahrzeug",
  businessKm: 60,
  privateKm: 0,
  tripType: "dienstlich",
  notes: "",
  overnight: false,
  absenceConfirmed: true,
  meals: { breakfast: false, lunch: false, dinner: false },
  status: "geprüft",
  sourceHash: "",
  importedAt: "2026-07-14",
  warnings: [],
  ...extra,
});
const settings = (): Settings => structuredClone(defaultSettings);

describe("Verpflegungspauschalen", () => {
  it.each([
    ["08:00", "15:59", 0],
    ["08:00", "16:00", 0],
    ["08:00", "16:01", 14],
    ["08:00", "16:30", 14],
  ])("berechnet %s–%s korrekt", (start, end, expected) =>
    expect(
      calculateDay("2026-07-14", [base(start, end)], settings()).allowanceAfter,
    ).toBe(expected),
  );
  it("setzt interne Grenze mehr als 8:30 korrekt um", () => {
    const s = settings();
    s.ruleMode = "internal";
    s.internalMinutes = 510;
    s.internalComparator = "greater";
    expect(
      calculateDay("2026-07-14", [base("08:00", "16:30")], s).allowanceAfter,
    ).toBe(0);
    expect(
      calculateDay("2026-07-14", [base("08:00", "16:31")], s).allowanceAfter,
    ).toBe(14);
  });
  it("setzt interne Grenze mindestens 8:30 korrekt um", () => {
    const s = settings();
    s.ruleMode = "internal";
    s.internalMinutes = 510;
    s.internalComparator = "atLeast";
    expect(
      calculateDay("2026-07-14", [base("08:00", "16:30")], s).allowanceAfter,
    ).toBe(14);
  });
  it("berechnet volle Zwischen-, Anreise- und Abreisetage", () => {
    const t = base("09:00", "17:00", {
      date: "2026-07-14",
      endDate: "2026-07-16",
      overnight: true,
    });
    expect(calculateDay("2026-07-14", [t], settings()).allowanceAfter).toBe(14);
    expect(calculateDay("2026-07-15", [t], settings()).allowanceAfter).toBe(28);
    expect(calculateDay("2026-07-16", [t], settings()).allowanceAfter).toBe(14);
  });
  it("kürzt Frühstück, Mittag- und Abendessen vom vollen Tagessatz", () => {
    const t = base("00:00", "23:59", {
      date: "2026-07-15",
      endDate: "2026-07-15",
      manualAbsenceMinutes: 1440,
      meals: { breakfast: true, lunch: true, dinner: false },
    });
    const c = calculateDay("2026-07-15", [t], settings());
    expect(c.allowanceBefore).toBe(28);
    expect(c.breakfastCut).toBe(5.6);
    expect(c.lunchCut).toBe(11.2);
    expect(c.allowanceAfter).toBe(11.2);
  });
  it("wird bei allen Mahlzeiten niemals negativ", () => {
    const t = base("08:00", "17:00", {
      meals: { breakfast: true, lunch: true, dinner: true },
    });
    expect(calculateDay("2026-07-14", [t], settings()).allowanceAfter).toBe(0);
  });
  it("addiert bei mehreren Fahrten nur einen Tageshöchstbetrag", () => {
    const a = base("07:00", "12:00");
    const b = base("13:00", "18:00", { id: "b" });
    const c = calculateDay("2026-07-14", [a, b], settings());
    expect(c.allowanceAfter).toBe(14);
    expect(c.totalKm).toBe(120);
  });
  it("vervielfacht Kilometer und Belege einer Mehrtagesreise nicht", () => {
    const data = buildStatement(demoState(), "2026-07");
    expect(data.rows.reduce((s, r) => s + r.totalKm, 0)).toBe(1783);
    expect(data.totals.accommodation).toBe(238);
  });
});

describe("Tarife und Datenqualität", () => {
  it("bestimmt Tarife nach Reisedatum", () => {
    const s = settings();
    s.tariffs.push({
      ...s.tariffs[0],
      id: "future",
      validFrom: "2027-01-01",
      amount: 16,
    });
    expect(tariffFor(s, "2026-07-14", "partial")?.amount).toBe(14);
    expect(tariffFor(s, "2027-01-02", "partial")?.amount).toBe(16);
  });
  it("ein Snapshot bleibt von späteren Tarifänderungen unabhängig", () => {
    const snapshot = structuredClone(settings().tariffs);
    const current = settings();
    current.tariffs[0].amount = 99;
    expect(snapshot[0].amount).toBe(14);
  });
  it("erkennt identische Duplikatschlüssel", () => {
    const a = base("08:00", "17:00");
    const b = { ...a, id: "neu", importedAt: "später" };
    expect(duplicateKey(a)).toBe(duplicateKey(b));
  });
  it("behandelt Reisen über Mitternacht", () =>
    expect(minutesBetween("2026-07-14", "22:00", "02:00")).toBe(240));
  it("rundet Geldbeträge kaufmännisch auf zwei Stellen", () =>
    expect(round2(10.005)).toBe(10.01));
});

describe("Fahrzeugbezogene Kilometererstattung", () => {
  it("erstattet nur Privatwagen mit aktivierter Kilometerpauschale", () => {
    const state = demoState();
    const result = buildStatement(state, "2026-07");

    expect(result.totals.mileage).toBe(471.9);
    expect(result.rows.find((row) => row.date === "2026-07-11")?.mileage).toBe(
      0,
    );
  });

  it("berechnet bei tatsächlichen Privatwagenkosten keine Pauschale", () => {
    const state = demoState();
    const privateVehicle = state.settings.vehicles.find(
      (vehicle) => vehicle.id === "vehicle-private-default",
    );
    if (!privateVehicle) throw new Error("Testfahrzeug fehlt");
    privateVehicle.reimbursementMethod = "tatsächliche Kosten";

    expect(buildStatement(state, "2026-07").totals.mileage).toBe(0);
  });

  it("erstattet bei Kilometerpauschale keine zusätzlichen Tankkosten", () => {
    const state = demoState();
    state.expenses.push({
      ...state.expenses.find((expense) => expense.category === "Tanken")!,
      id: "private-fuel",
      date: "2026-07-01",
      tripId: "d1",
      vehicleId: "vehicle-private-default",
      gross: 100,
      net: 84.03,
      vat: 15.97,
      paymentType: "privat vorgestreckt",
      paidBy: "Reisender",
      reimbursementStatus: "offen",
    });

    const result = buildStatement(state, "2026-07");

    expect(result.totals.fuel).toBe(82.6);
    expect(result.rows.find((row) => row.date === "2026-07-01")?.fuel).toBe(0);
  });

  it("wendet den Kilometer-Tarif anhand des Fahrtages an", () => {
    const state = demoState();
    state.trips = [
      base("08:00", "17:00", {
        vehicleId: "vehicle-private-default",
        businessKm: 100,
      }),
    ];
    state.settings.tariffs.push({
      ...state.settings.tariffs.find((tariff) => tariff.kind === "mileage")!,
      id: "mileage-from-2026-07-14",
      validFrom: "2026-07-14",
      amount: 0.42,
    });

    expect(buildStatement(state, "2026-07").totals.mileage).toBe(42);
  });

  it("übernimmt das Standardfahrzeug beim Fahrtenbuchimport", () => {
    const s = settings();
    const result = rowsToTrips(
      [
        {
          Datum: "14.07.2026",
          Beginn: "08:00",
          Ende: "17:00",
          Ziel: "Bonn",
          Zweck: "Termin",
          Kilometer: "100",
        },
      ],
      {
        date: "Datum",
        startTime: "Beginn",
        endTime: "Ende",
        destination: "Ziel",
        purpose: "Zweck",
        businessKm: "Kilometer",
      },
      [],
      s.vehicles,
      "vehicle-private-default",
    );

    expect(result.trips[0].vehicleId).toBe("vehicle-private-default");
    expect(result.trips[0].vehicleType).toBe("privatfahrzeug");
  });

  it("ordnet alte Fahrten ohne Fahrzeug-ID migrationssicher zu", () => {
    const legacy = demoState();
    legacy.trips = [
      base("08:00", "17:00", {
        vehicleId: undefined,
        vehicleType: "privatfahrzeug",
      }),
    ];

    const normalized = normalizeState(legacy);

    expect(normalized.trips[0].vehicleId).toBe("vehicle-private-default");
  });
});
