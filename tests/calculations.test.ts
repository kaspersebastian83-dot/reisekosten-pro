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

describe("über Mitternacht ohne Übernachtung (§ 9 Abs. 4a Satz 3 Nr. 3 EStG)", () => {
  const s = defaultSettings as Settings;
  const tage = (trip: Trip) => [trip.date, trip.endDate!].map((date) => calculateDay(date, [trip], s));
  const teil = (date: string) => tariffFor(s, date, "partial")!.amount;
  const anreise = (date: string) => tariffFor(s, date, "arrival")!.amount;

  it("Nachtfahrt 22:00–01:00 (3 Std.): keine Pauschale, nicht zwei An-/Abreisetage", () => {
    const [a, b] = tage(base("22:00", "01:00", { endDate: "2026-07-15" }));
    expect(a.allowanceBefore + b.allowanceBefore).toBe(0);
    expect(a.absenceMinutes).toBe(180);
    expect(a.reason).toMatch(/Über Mitternacht ohne Übernachtung.*Schwelle nicht überschritten/);
    expect(b.reason).toMatch(/angesetzt am 14\.07\.2026/);
  });
  it("14:00–02:00 (12 Std., überwiegend am Abfahrtstag): eine Teilpauschale am Abfahrtstag", () => {
    const [a, b] = tage(base("14:00", "02:00", { endDate: "2026-07-15" }));
    expect(a.allowanceBefore).toBe(teil("2026-07-14"));
    expect(a.absenceMinutes).toBe(720);
    expect(b.allowanceBefore).toBe(0);
  });
  it("20:00–07:00 (11 Std., überwiegend am Folgetag): eine Teilpauschale am Rückkehrtag", () => {
    const [a, b] = tage(base("20:00", "07:00", { endDate: "2026-07-15" }));
    expect(a.allowanceBefore).toBe(0);
    expect(b.allowanceBefore).toBe(teil("2026-07-15"));
    expect(b.absenceMinutes).toBe(660);
  });
  it("gleich lang vor und nach Mitternacht: Abfahrtstag, mit Hinweis", () => {
    const [a, b] = tage(base("19:00", "05:00", { endDate: "2026-07-15" }));
    expect(a.allowanceBefore).toBe(teil("2026-07-14"));
    expect(b.allowanceBefore).toBe(0);
    expect(a.warnings.join(" ")).toMatch(/gleich lange abwesend/);
  });
  it("mit bestätigter Übernachtung: An- und Abreisetag wie bisher", () => {
    const [a, b] = tage(base("22:00", "01:00", { endDate: "2026-07-15", overnight: true }));
    expect(a.allowanceBefore).toBe(anreise("2026-07-14"));
    expect(b.allowanceBefore).toBe(tariffFor(s, "2026-07-15", "departure")!.amount);
  });
  it("mehr als ein Datumswechsel ohne Bestätigung: Berechnung wie bisher", () => {
    const [a] = tage(base("08:00", "17:00", { endDate: "2026-07-16" }));
    expect(a.allowanceBefore).toBe(anreise("2026-07-14"));
  });
  it("Nachtfahrt und Tagesfahrt am selben Tag: Zeiten zählen zusammen", () => {
    const tag = base("08:00", "12:00");
    const nacht = base("20:00", "02:00", { endDate: "2026-07-15" });
    const day = calculateDay("2026-07-14", [tag, nacht], s);
    expect(day.absenceMinutes).toBe(240 + 360);
    expect(day.allowanceBefore).toBe(teil("2026-07-14"));
    expect(calculateDay("2026-07-15", [nacht], s).allowanceBefore).toBe(0);
  });
  it("mit manueller Abwesenheitskorrektur: Berechnung wie bisher (An-/Abreisetag)", () => {
    const [a, b] = tage(base("22:00", "01:00", { endDate: "2026-07-15", manualAbsenceMinutes: 0 }));
    expect(a.allowanceBefore).toBe(anreise("2026-07-14"));
    expect(b.allowanceBefore).toBe(tariffFor(s, "2026-07-15", "departure")!.amount);
  });
  it("24 Stunden und mehr über Mitternacht ohne Übernachtung: nur die Teilpauschale", () => {
    for (const [start, end] of [["08:00", "08:00"], ["01:00", "23:00"]]) {
      const [a, b] = tage(base(start, end, { endDate: "2026-07-15" }));
      expect(a.allowanceBefore + b.allowanceBefore).toBe(teil("2026-07-14"));
      expect([a, b].some((d) => d.allowanceBefore === tariffFor(s, d.date, "full")!.amount && d.allowanceBefore !== teil(d.date))).toBe(false);
    }
  });
  it("am nicht angesetzten Tag echte Zeiten statt 00:00–23:59", () => {
    const [a, b] = tage(base("22:00", "01:00", { endDate: "2026-07-15" }));
    expect([a.firstStart, a.lastEnd]).toEqual(["22:00", "01:00"]);
    expect([b.firstStart, b.lastEnd]).toEqual(["00:00", "01:00"]);
    const [c, d] = tage(base("20:00", "07:00", { endDate: "2026-07-15" }));
    expect([c.firstStart, c.lastEnd]).toEqual(["20:00", "23:59"]);
    expect([d.firstStart, d.lastEnd]).toEqual(["20:00", "07:00"]);
  });
  it("Mahlzeiten beider Kalendertage kürzen die eine Pauschale am angesetzten Tag", () => {
    const no = { breakfast: false, lunch: false, dinner: false };
    const cut = (date: string, kind: "breakfast" | "dinner") =>
      round2(tariffFor(s, date, "full")!.amount * tariffFor(s, date, kind)!.amount / 100);
    // überwiegend am Folgetag, Abendessen am Abfahrtstag (bisher verloren)
    const [a, b] = tage(base("20:00", "07:00", { endDate: "2026-07-15", dailyMeals: { "2026-07-14": { ...no, dinner: true }, "2026-07-15": no } }));
    expect([a.dinnerCut, a.allowanceAfter]).toEqual([0, 0]);
    expect(b.dinnerCut).toBe(cut("2026-07-15", "dinner"));
    expect(b.allowanceAfter).toBe(round2(teil("2026-07-15") - cut("2026-07-15", "dinner")));
    // ältere Reisen ohne dailyMeals: meals gehören zum Abfahrtstag und wandern ebenso
    const [c, d] = tage(base("20:00", "07:00", { endDate: "2026-07-15", meals: { ...no, dinner: true } }));
    expect(c.dinnerCut + d.dinnerCut).toBe(cut("2026-07-15", "dinner"));
    expect(d.dinnerCut).toBe(cut("2026-07-15", "dinner"));
    // überwiegend am Abfahrtstag, Frühstück am Folgetag (bisher gegen 0 € gekürzt)
    const [e, f] = tage(base("14:00", "02:00", { endDate: "2026-07-15", dailyMeals: { "2026-07-14": no, "2026-07-15": { ...no, breakfast: true } } }));
    expect(e.breakfastCut).toBe(cut("2026-07-14", "breakfast"));
    expect(e.allowanceAfter).toBe(round2(teil("2026-07-14") - cut("2026-07-14", "breakfast")));
    expect([f.breakfastCut, f.allowanceAfter]).toEqual([0, 0]);
    // beide Tage zusammen, nie unter 0
    const [g, h] = tage(base("14:00", "02:00", { endDate: "2026-07-15", dailyMeals: { "2026-07-14": { ...no, dinner: true }, "2026-07-15": { ...no, breakfast: true } } }));
    expect([g.breakfastCut > 0, g.dinnerCut > 0, g.allowanceAfter]).toEqual([true, true, 0]);
    expect(h.breakfastCut + h.dinnerCut).toBe(0);
  });
  it("Tagesfahrt am nicht angesetzten Tag kürzt ihre eigenen Mahlzeiten weiter dort", () => {
    const no = { breakfast: false, lunch: false, dinner: false };
    const tag = { ...base("06:00", "16:00", { meals: { ...no, lunch: true } }), date: "2026-07-15" };
    const nacht = base("20:00", "07:00", { endDate: "2026-07-15", dailyMeals: { "2026-07-14": { ...no, dinner: true }, "2026-07-15": no } });
    const day = calculateDay("2026-07-15", [tag, nacht], s);
    expect(day.lunchCut).toBeGreaterThan(0);
    expect(day.dinnerCut).toBeGreaterThan(0);
    expect(calculateDay("2026-07-14", [nacht], s).dinnerCut).toBe(0);
  });
  it("Monatswechsel: Nacht 31.07.–01.08. zählt einmal", () => {
    const nacht = { ...base("15:00", "03:00", { endDate: "2026-08-01" }), date: "2026-07-31" };
    expect(calculateDay("2026-07-31", [nacht], s).allowanceBefore).toBe(teil("2026-07-31"));
    expect(calculateDay("2026-08-01", [nacht], s).allowanceBefore).toBe(0);
  });
});
