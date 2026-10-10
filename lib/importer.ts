import Papa from "papaparse";
import type { Trip, VehicleProfile } from "./types";
import { duplicateKey, validateTrip } from "./calculations";

export const canonicalFields = [
  ["date", "Datum"],
  ["endDate", "Ankunftsdatum"],
  ["startTime", "Abfahrtszeit / Beginn"],
  ["endTime", "Rückkehrzeit / Ende"],
  ["startPlace", "Startort"],
  ["destination", "Zielort"],
  ["purpose", "Reisezweck"],
  ["customer", "Kunde"],
  ["order", "Auftrag / Aktenzeichen"],
  ["costCenter", "Kostenstelle"],
  ["plate", "Kennzeichen"],
  ["vehicle", "Fahrzeug"],
  ["kmStart", "Kilometerstand Start"],
  ["kmEnd", "Kilometerstand Ende"],
  ["businessKm", "dienstliche Kilometer"],
  ["commuteKm", "Arbeitsweg-Kilometer"],
  ["totalKm", "Gesamtstrecke"],
  ["privateKm", "private Kilometer"],
  ["driveMinutes", "reine Fahrtdauer (Minuten)"],
  ["standMinutes", "Standdauer (Minuten)"],
  ["driver", "Fahrer/in"],
  ["tripType", "Fahrtart"],
  ["notes", "Bemerkungen"],
] as const;

const aliases: Record<string, string[]> = {
  date: ["datum", "reisedatum", "tag", "fahrt datum"],
  endDate: ["ankunft datum", "ankunftsdatum", "endedatum"],
  startTime: ["abfahrt", "abfahrtszeit", "startzeit", "beginn", "von zeit"],
  endTime: [
    "rückkehr",
    "rueckkehr",
    "rückkehrzeit",
    "endzeit",
    "ende",
    "bis zeit",
  ],
  startPlace: ["startort", "von", "abfahrtsort", "start"],
  destination: ["zielort", "ziel", "nach", "reiseziel"],
  purpose: ["reisezweck", "zweck", "anlass", "geschäftszweck"],
  customer: ["kunde", "mandant"],
  order: ["auftrag", "aktenzeichen", "projekt", "auftragsnummer"],
  costCenter: ["kostenstelle", "kst"],
  plate: ["kennzeichen", "kfz"],
  vehicle: ["fahrzeug", "auto"],
  kmStart: ["kilometerstand start", "km stand start", "kmstart"],
  kmEnd: ["kilometerstand ende", "km stand ende", "kmende"],
  businessKm: [
    "dienstliche kilometer",
    "geschäftlich km",
    "gefahrene kilometer",
    "kilometer",
    "km",
  ],
  commuteKm: ["arbeitsweg km", "pendel km"],
  totalKm: ["strecke km", "gesamtstrecke"],
  privateKm: ["private kilometer", "privat km"],
  driveMinutes: ["fahrtdauer min", "fahrtdauer"],
  standMinutes: ["standdauer min", "standdauer"],
  driver: ["fahrer in", "fahrer"],
  tripType: ["fahrtart", "typ", "kategorie"],
  notes: ["bemerkungen", "notiz", "kommentar"],
};

const vimcarMapping: Record<string, string> = {
  date: "Abfahrt_datum",
  endDate: "Ankunft_datum",
  startTime: "Abfahrt_uhrzeit",
  endTime: "Ankunft_uhrzeit",
  startPlace: "Start Adresse",
  destination: "End Adresse",
  purpose: "Anlass der Fahrt",
  customer: "Geschäftspartner/in",
  costCenter: "Kostenstelle",
  plate: "Kennzeichen",
  vehicle: "Fahrzeug",
  kmStart: "Km-Stand",
  kmEnd: "Ankunft_kmstand",
  totalKm: "Strecke_km",
  businessKm: "Betrieb_km",
  commuteKm: "Arbeitsweg_km",
  privateKm: "Privat_km",
  driveMinutes: "Fahrtdauer_min",
  standMinutes: "Standdauer_min",
  driver: "Fahrer/in",
  notes: "Bemerkung",
};

const norm = (s: unknown) =>
  String(s ?? "")
    .toLowerCase()
    .trim()
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ");

export function suggestMapping(headers: string[]) {
  if (isVimcarHeaders(headers)) return { ...vimcarMapping };
  const mapping: Record<string, string> = {};
  for (const [field] of canonicalFields) {
    const found = headers.find((h) =>
      aliases[field]?.some((a) => norm(h) === a || norm(h).includes(a)),
    );
    if (found) mapping[field] = found;
  }
  return mapping;
}

export function isVimcarHeaders(headers: string[]) {
  const set = new Set(headers.map(norm));
  return [
    "abfahrt datum",
    "ankunft datum",
    "betrieb km",
    "arbeitsweg km",
    "privat km",
  ].every((header) => set.has(header));
}

export async function parseImportFile(file: File): Promise<{
  sheets: Record<string, Record<string, unknown>[]>;
  warning?: string;
  format: "vimcar" | "generic";
}> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".pdf"))
    throw new Error(
      "Der Vimcar-PDF-Export enthält keine Abfahrts- und Ankunftszeiten. Eine zuverlässige Spesenberechnung ist daraus nicht möglich. Bitte laden Sie den CSV-Export desselben Zeitraums hoch und bewahren Sie den PDF-Bericht separat als Nachweis auf.",
    );
  if (lower.endsWith(".csv")) {
    const text = await file.text();
    const parsed = Papa.parse<Record<string, unknown>>(text, {
      header: true,
      skipEmptyLines: true,
      delimiter: "",
    });
    if (parsed.errors.length && !parsed.data.length)
      throw new Error(
        parsed.errors[0]?.message || "CSV konnte nicht gelesen werden.",
      );
    const headers = Object.keys(parsed.data[0] || {});
    return {
      sheets: { CSV: parsed.data },
      format: isVimcarHeaders(headers) ? "vimcar" : "generic",
      warning: parsed.errors.length
        ? `${parsed.errors.length} CSV-Hinweis(e)`
        : undefined,
    };
  }
  if (!/\.xlsx$/i.test(lower))
    throw new Error(
      "Unterstützt werden XLSX und CSV. Für Vimcar verwenden Sie bitte den CSV-Export mit Abfahrts- und Ankunftszeiten.",
    );
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    new Uint8Array(await file.arrayBuffer()) as unknown as import("exceljs").Buffer,
  );
  const sheets: Record<string, Record<string, unknown>[]> = {};
  workbook.eachSheet((worksheet) => {
    let headerRowNumber = 0;
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const values = Array.isArray(row.values)
        ? row.values.slice(1)
        : Object.values(row.values);
      if (
        !headerRowNumber &&
        values.some((value) => String(value ?? "").trim())
      )
        headerRowNumber = rowNumber;
    });
    if (!headerRowNumber) {
      sheets[worksheet.name] = [];
      return;
    }
    const headerRow = worksheet.getRow(headerRowNumber);
    const headers: { index: number; name: string }[] = [];
    headerRow.eachCell({ includeEmpty: false }, (cell, index) => {
      const name = cell.text.trim();
      if (name) headers.push({ index, name });
    });
    const rows: Record<string, unknown>[] = [];
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber <= headerRowNumber) return;
      const record: Record<string, unknown> = {};
      let hasValue = false;
      for (const header of headers) {
        const cell = row.getCell(header.index);
        const value = spreadsheetCellValue(cell);
        record[header.name] = value;
        if (String(value ?? "").trim()) hasValue = true;
      }
      if (hasValue) rows.push(record);
    });
    sheets[worksheet.name] = rows;
  });
  const firstRows = sheets[Object.keys(sheets)[0]] || [];
  return {
    sheets,
    format: isVimcarHeaders(Object.keys(firstRows[0] || {}))
      ? "vimcar"
      : "generic",
  };
}

function spreadsheetCellValue(cell: import("exceljs").Cell): unknown {
  const value = cell.value;
  if (value == null) return "";
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value instanceof Date
  )
    return value;
  if (typeof value === "object" && "result" in value && value.result != null)
    return value.result;
  return cell.text;
}

function excelDate(value: unknown) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const s = String(value ?? "").trim();
  const de = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (de)
    return `${de[3].length === 2 ? "20" + de[3] : de[3]}-${de[2].padStart(2, "0")}-${de[1].padStart(2, "0")}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

function time(value: unknown) {
  const s = String(value ?? "").trim();
  const m = s.match(/(\d{1,2})[:.](\d{2})(?::(\d{2}))?/);
  if (m) return `${m[1].padStart(2, "0")}:${m[2]}${m[3] ? `:${m[3]}` : ""}`;
  const num = Number(s.replace(",", "."));
  if (num >= 0 && num < 1) {
    const mins = Math.round(num * 1440);
    return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
  }
  return "";
}

const num = (v: unknown) =>
  Number(
    String(v ?? "0")
      .replace(/\./g, "")
      .replace(",", ".")
      .replace(/[^0-9.-]/g, ""),
  ) || 0;

export function rowsToTrips(
  rows: Record<string, unknown>[],
  mapping: Record<string, string>,
  existing: Trip[],
  vehicles: VehicleProfile[] = [],
  defaultVehicleId = "",
  homeAddress = "",
  firstWorkplace = "",
) {
  const existingKeys = new Set(existing.map(duplicateKey));
  let duplicates = 0;
  let invalid = 0;
  let ignoredCommute = 0;
  let ignoredPrivate = 0;
  const trips: Trip[] = [];
  const vimcar = mapping.businessKm === "Betrieb_km";
  const rowKind = (row: Record<string, unknown>) => {
    const getMapped = (field: string) =>
      mapping[field] ? row[mapping[field]] : "";
    const business = num(getMapped("businessKm"));
    const commute = num(getMapped("commuteKm"));
    const privateKm = num(getMapped("privateKm"));
    if (business > 0) return "dienstlich" as const;
    if (commute > 0) return "erste Tätigkeitsstätte" as const;
    if (privateKm > 0) return "privat" as const;
    return "unbekannt" as const;
  };
  const privateBeforeBusinessDays = new Set<string>();
  if (vimcar) {
    const byDate = new Map<string, Record<string, unknown>[]>();
    for (const row of rows) {
      const date = excelDate(mapping.date ? row[mapping.date] : "");
      if (date) byDate.set(date, [...(byDate.get(date) || []), row]);
    }
    for (const [date, dayRows] of byDate) {
      const businessRows = dayRows.filter(
        (row) => rowKind(row) === "dienstlich",
      );
      if (!businessRows.length) continue;
      const firstBusiness = businessRows
        .map((row) => time(row[mapping.startTime]))
        .filter(Boolean)
        .sort()[0];
      if (
        dayRows.some(
          (row) =>
            rowKind(row) === "privat" &&
            time(row[mapping.startTime]) < firstBusiness,
        )
      )
        privateBeforeBusinessDays.add(date);
    }
  }
  for (const row of rows) {
    const get = (f: string) => (mapping[f] ? row[mapping[f]] : "");
    const date = excelDate(get("date"));
    if (!date) {
      invalid++;
      continue;
    }
    const kind = vimcar ? rowKind(row) : undefined;
    if (kind === "erste Tätigkeitsstätte") {
      ignoredCommute++;
      continue;
    }
    if (kind === "privat") {
      ignoredPrivate++;
      continue;
    }
    if (vimcar && kind !== "dienstlich") {
      invalid++;
      continue;
    }
    const importedVehicle = String(get("vehicle") || "").trim();
    const importedPlate = String(get("plate") || "").trim();
    const normalizedVehicle = norm(importedVehicle);
    const normalizedPlate = norm(importedPlate);
    const selectedVehicle =
      vehicles.find(
        (vehicle) =>
          (normalizedVehicle && norm(vehicle.name) === normalizedVehicle) ||
          (normalizedPlate && norm(vehicle.plate) === normalizedPlate),
      ) || vehicles.find((vehicle) => vehicle.id === defaultVehicleId);
    const trip: Trip = {
      id:
        typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `rk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
      date,
      endDate: excelDate(get("endDate")) || undefined,
      startTime: time(get("startTime")),
      endTime: time(get("endTime")),
      startPlace: String(get("startPlace") || ""),
      destination: String(get("destination") || ""),
      purpose: String(get("purpose") || ""),
      customer: String(get("customer") || ""),
      order: String(get("order") || ""),
      costCenter: String(get("costCenter") || ""),
      plate: importedPlate || selectedVehicle?.plate || "",
      vehicle: importedVehicle || selectedVehicle?.name || "",
      vehicleId: selectedVehicle?.id,
      vehicleType:
        selectedVehicle?.ownership === "privatwagen"
          ? "privatfahrzeug"
          : "firmenfahrzeug",
      kmStart: get("kmStart") ? num(get("kmStart")) : undefined,
      kmEnd: get("kmEnd") ? num(get("kmEnd")) : undefined,
      businessKm: num(get("businessKm")),
      totalKm: num(get("totalKm")) || undefined,
      commuteKm: num(get("commuteKm")) || undefined,
      privateKm: num(get("privateKm")),
      driveMinutes: num(get("driveMinutes")) || undefined,
      standMinutes: num(get("standMinutes")) || undefined,
      driver: String(get("driver") || ""),
      importSource: vimcar ? "Vimcar CSV" : "Dateiimport",
      tripType:
        kind === "dienstlich"
          ? "dienstlich"
          : norm(get("tripType")).includes("privat")
            ? "privat"
            : norm(get("tripType")).includes("tätigkeitsstätte")
              ? "erste Tätigkeitsstätte"
              : "dienstlich",
      notes: String(get("notes") || ""),
      overnight: false,
      absenceConfirmed: vimcar && !privateBeforeBusinessDays.has(date),
      meals: { breakfast: false, lunch: false, dinner: false },
      status: "importiert",
      sourceHash: "",
      importedAt: new Date().toISOString(),
      warnings: [],
    };
    trip.sourceHash = duplicateKey(trip);
    trip.warnings = validateTrip(trip);
    if (privateBeforeBusinessDays.has(date))
      trip.warnings = [
        ...new Set([
          ...trip.warnings,
          "Privatfahrt vor der ersten Betriebsfahrt – Abwesenheitsbeginn bitte bestätigen.",
        ]),
      ];
    if (
      vimcar &&
      homeAddress &&
      (sameLocation(trip.startPlace, homeAddress) ||
        sameLocation(trip.destination, homeAddress))
    )
      trip.notes = [trip.notes, "Wohnadresse erkannt"]
        .filter(Boolean)
        .join(" · ");
    if (
      vimcar &&
      firstWorkplace &&
      (sameLocation(trip.startPlace, firstWorkplace) ||
        sameLocation(trip.destination, firstWorkplace))
    )
      trip.notes = [trip.notes, "Erste Tätigkeitsstätte erkannt"]
        .filter(Boolean)
        .join(" · ");
    if (
      existingKeys.has(trip.sourceHash) ||
      trips.some((t) => t.sourceHash === trip.sourceHash)
    ) {
      duplicates++;
      continue;
    }
    trips.push(trip);
  }
  return {
    trips,
    duplicates,
    invalid,
    ignoredCommute,
    ignoredPrivate,
    format: vimcar ? ("vimcar" as const) : ("generic" as const),
  };
}

function addressParts(value: string) {
  const normalized = norm(value)
    .replace(/straße/g, "strasse")
    .replace(/\bst\.?\b/g, "strasse");
  const postcode = normalized.match(/\b\d{5}\b/)?.[0] || "";
  const house = Number(normalized.match(/\b(\d{1,4})[a-z]?\b/)?.[1] || 0);
  const street = normalized
    .split(",")[0]
    .replace(/\b\d{1,4}[a-z]?\b/g, "")
    .trim();
  return { normalized, postcode, house, street };
}

export function sameLocation(a: string, b: string) {
  if (!a || !b) return false;
  const left = addressParts(a);
  const right = addressParts(b);
  if (left.normalized === right.normalized) return true;
  return (
    !!left.postcode &&
    left.postcode === right.postcode &&
    left.street === right.street &&
    !!left.house &&
    !!right.house &&
    Math.abs(left.house - right.house) <= 4
  );
}
