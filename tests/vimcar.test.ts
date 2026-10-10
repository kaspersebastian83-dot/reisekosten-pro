import { describe, expect, it } from "vitest";
import { calculateDay, groupTripsByDay } from "../lib/calculations";
import { defaultSettings } from "../lib/config";
import {
  isVimcarHeaders,
  rowsToTrips,
  sameLocation,
  suggestMapping,
} from "../lib/importer";
import { normalizeState } from "../lib/storage";

const headers = [
  "Fahrzeug",
  "Kennzeichen",
  "Abfahrt_datum",
  "Abfahrt_uhrzeit",
  "Ankunft_datum",
  "Ankunft_uhrzeit",
  "Km-Stand",
  "Ankunft_kmstand",
  "Strecke_km",
  "Betrieb_km",
  "Arbeitsweg_km",
  "Privat_km",
  "Start Adresse",
  "End Adresse",
  "Geschäftspartner/in",
  "Anlass der Fahrt",
  "Fahrer/in",
  "Fahrtdauer_min",
  "Standdauer_min",
  "Bemerkung",
  "Kostenstelle",
];

const row = (values: Partial<Record<string, string>>) => ({
  Fahrzeug: "VW Passat",
  Kennzeichen: "K-RK 2026",
  Abfahrt_datum: "09.03.2026",
  Abfahrt_uhrzeit: "08:25:29",
  Ankunft_datum: "09.03.2026",
  Ankunft_uhrzeit: "17:16:49",
  "Km-Stand": "124000,000",
  Ankunft_kmstand: "124406,688",
  Strecke_km: "406,688",
  Betrieb_km: "406,688",
  Arbeitsweg_km: "0,0",
  Privat_km: "0,0",
  "Start Adresse": "Bürostraße 59, 53111 Bonn",
  "End Adresse": "Musterstraße 24, 50667 Köln",
  "Geschäftspartner/in": "Kunde Bonn",
  "Anlass der Fahrt": "Begutachtung",
  "Fahrer/in": "Max Mustermann",
  Fahrtdauer_min: "192",
  Standdauer_min: "30",
  Bemerkung: "",
  Kostenstelle: "",
  ...values,
});

describe("Vimcar-Importprofil", () => {
  it("veröffentlicht keine persönlichen Adressen als Vorgabe", () => {
    const migrated = normalizeState({
      settings: {
        ...structuredClone(defaultSettings),
        homeAddress: "",
        firstWorkplace: "",
      },
    });
    expect(migrated.settings.homeAddress).toBe("");
    expect(migrated.settings.firstWorkplace).toBe("");
  });

  it("erkennt die Anbieterstruktur und ordnet Betrieb_km statt Strecke_km zu", () => {
    expect(isVimcarHeaders(headers)).toBe(true);
    const mapping = suggestMapping(headers);
    expect(mapping.businessKm).toBe("Betrieb_km");
    expect(mapping.totalKm).toBe("Strecke_km");
    expect(mapping.commuteKm).toBe("Arbeitsweg_km");
  });

  it("importiert nur Betriebsfahrten und trennt Arbeitsweg sowie Privat", () => {
    const mapping = suggestMapping(headers);
    const result = rowsToTrips(
      [
        row({
          Abfahrt_uhrzeit: "07:00:00",
          Ankunft_uhrzeit: "07:20:00",
          Betrieb_km: "0,0",
          Arbeitsweg_km: "20,0",
          Strecke_km: "20,0",
        }),
        row({
          Abfahrt_uhrzeit: "07:30:00",
          Ankunft_uhrzeit: "07:45:00",
          Betrieb_km: "0,0",
          Privat_km: "10,0",
          Strecke_km: "10,0",
        }),
        row({}),
      ],
      mapping,
      [],
      defaultSettings.vehicles,
      defaultSettings.defaultVehicleId,
      defaultSettings.homeAddress,
      defaultSettings.firstWorkplace,
    );

    expect(result.trips).toHaveLength(1);
    expect(result.ignoredCommute).toBe(1);
    expect(result.ignoredPrivate).toBe(1);
    expect(result.trips[0].businessKm).toBe(406.688);
    expect(result.trips[0].plate).toBe("K-RK 2026");
    expect(result.trips[0].driver).toBe("Max Mustermann");
  });

  it("berechnet die Tagesabwesenheit aus erster bis letzter Betriebsfahrt", () => {
    const mapping = suggestMapping(headers);
    const result = rowsToTrips(
      [
        row({
          Abfahrt_uhrzeit: "08:25:29",
          Ankunft_uhrzeit: "10:00:00",
          Betrieb_km: "100,0",
          Strecke_km: "100,0",
        }),
        row({
          Abfahrt_uhrzeit: "15:30:00",
          Ankunft_uhrzeit: "17:16:49",
          Betrieb_km: "100,0",
          Strecke_km: "100,0",
        }),
      ],
      mapping,
      [],
      defaultSettings.vehicles,
      defaultSettings.defaultVehicleId,
    );
    const grouped = groupTripsByDay(result.trips);
    const day = calculateDay(
      "2026-03-09",
      grouped.get("2026-03-09") || [],
      defaultSettings,
    );

    expect(day.absenceMinutes).toBe(532);
    expect(day.allowanceAfter).toBe(14);
    expect(day.totalKm).toBe(200);
  });

  it("markiert eine Privatfahrt vor der ersten Betriebsfahrt", () => {
    const mapping = suggestMapping(headers);
    const result = rowsToTrips(
      [
        row({
          Abfahrt_uhrzeit: "07:30:00",
          Ankunft_uhrzeit: "08:00:00",
          Betrieb_km: "0,0",
          Privat_km: "10,0",
          Strecke_km: "10,0",
        }),
        row({}),
      ],
      mapping,
      [],
      defaultSettings.vehicles,
      defaultSettings.defaultVehicleId,
    );

    expect(result.trips[0].absenceConfirmed).toBe(false);
    expect(result.trips[0].warnings.join(" ")).toContain("Privatfahrt vor");
  });

  it("erkennt nahe GPS-Hausnummern als dieselbe Adresse", () => {
    expect(
      sameLocation(
        "Musterstraße 24, 50667 Köln",
        "Musterstraße 20, 50667 Köln",
      ),
    ).toBe(true);
    expect(
      sameLocation(
        "Musterstraße 30, 50667 Köln",
        "Musterstraße 20, 50667 Köln",
      ),
    ).toBe(false);
  });

  it("überspringt denselben Vimcar-Datensatz beim zweiten Import", () => {
    const mapping = suggestMapping(headers);
    const first = rowsToTrips([row({})], mapping, []);
    const second = rowsToTrips([row({})], mapping, first.trips);
    expect(second.trips).toHaveLength(0);
    expect(second.duplicates).toBe(1);
  });
});
