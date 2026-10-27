import JSZip from "jszip";
import Papa from "papaparse";
import type { AppState, StatementData } from "./types";
import { buildStatementPdf, statementPdfBytes } from "./pdf-statement";
import { receiptIndex } from "./receipt-index";
import { withAllReceiptImages, withReceiptImages } from "./receipt-images";
import { correctionExportNotice, statementAmountLabel, type StatementExportContext } from "./export-context";
export { correctionExportNotice, statementAmountLabel, type StatementExportContext } from "./export-context";

const euro = (n: number) =>
  n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });

const versionSuffix = (context?: StatementExportContext) => context ? `V${String(context.version).padStart(2, '0')}` : 'Entwurf';
export const statementExportFilename = (month: string, extension: string, context?: StatementExportContext, datev = false) => `${datev ? 'DATEV_' : ''}Reisekosten_${month}_${versionSuffix(context)}.${extension}`;

function vehicleDetails(
  state: AppState,
  trip: StatementData["rows"][number]["trips"][number],
) {
  const profile = (state.settings.vehicles || []).find(
    (vehicle) => vehicle.id === trip.vehicleId,
  );
  return {
    name: trip.vehicle || profile?.name || "Fahrzeug nicht angegeben",
    type: profile
      ? profile.ownership === "privatwagen" ? "Privatwagen" : "Dienstwagen"
      : trip.vehicleType === "privatfahrzeug" ? "Privatwagen"
        : trip.vehicleType === "firmenfahrzeug" ? "Dienstwagen" : trip.vehicleType,
    plate: trip.plate || profile?.plate || "ohne Kennzeichen",
  };
}

function vehiclesForStatement(data: StatementData, state: AppState) {
  const details = [
    ...data.rows.flatMap((row) =>
      row.trips.map((trip) => vehicleDetails(state, trip)),
    ),
    ...state.expenses
      .filter(
        (expense) => expense.date.startsWith(data.month) && expense.vehicleId,
      )
      .flatMap((expense) => {
        const vehicle = (state.settings.vehicles || []).find(
          (item) => item.id === expense.vehicleId,
        );
        return vehicle
          ? [
              {
                name: vehicle.name,
                type:
                  vehicle.ownership === "privatwagen"
                    ? "Privatwagen"
                    : "Dienstwagen",
                plate: vehicle.plate || "ohne Kennzeichen",
              },
            ]
          : [];
      }),
  ];
  return [
    ...new Map(
      details.map((vehicle) => [
        `${vehicle.name}|${vehicle.type}|${vehicle.plate}`,
        vehicle,
      ]),
    ).values(),
  ];
}

const vehicleLabel = (
  vehicle: ReturnType<typeof vehiclesForStatement>[number],
) => `${vehicle.name} · ${vehicle.type} · ${vehicle.plate}`;

function download(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Bestehende synchrone Dokument-API; Datei-Exporte ergänzen Original-PDF-Belege. */
export const buildPdfDocument = buildStatementPdf;

/** Vollständige PDF mit Bild- und Original-PDF-Belegen für Download und Ordnerablage. */
export async function pdfFile(data: StatementData, state: AppState, number: string, context?: StatementExportContext) {
  const bytes = await statementPdfBytes(data, state, number, context);
  return { name: statementExportFilename(data.month, 'pdf', context), blob: new Blob([bytes as BlobPart], { type: 'application/pdf' }) };
}

export async function printPdf(data: StatementData, state: AppState, number: string, context?: StatementExportContext) {
  const bytes = await statementPdfBytes(data, state, number, context, true);
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const opened = window.open(url, '_blank');
  if (!opened) download(blob, statementExportFilename(data.month, 'pdf', context));
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function exportPdf(data: StatementData, state: AppState, number: string, context?: StatementExportContext) {
  const file = await pdfFile(data, state, number, context);
  download(file.blob, file.name);
}

const MONEY_COLUMNS = new Set(["SpesenVorKürzung", "Frühstückskürzung", "Mittagessenkürzung", "Abendessenkürzung", "SpesenNachKürzung", "Kilometererstattung", "Tankkosten", "Übernachtung", "SonstigeKosten", "OffenerBetrag"]);

const rowsForExport = (data: StatementData, state: AppState) =>
  data.rows.map((r) => {
    const vehicles = [
      ...new Map(
        r.trips.map((trip) => {
          const vehicle = vehicleDetails(state, trip);
          return [vehicleLabel(vehicle), vehicle] as const;
        }),
      ).values(),
    ];
    return {
      Name: state.settings.profileName,
      Abrechnungsmonat: data.month,
      Fahrzeug: vehicles.map((vehicle) => vehicle.name).join(", "),
      Fahrzeugart: vehicles.map((vehicle) => vehicle.type).join(", "),
      Kennzeichen: vehicles.map((vehicle) => vehicle.plate).join(", "),
      Datum: r.date,
      Beginn: r.firstStart,
      Ende: r.lastEnd,
      Abwesenheitsminuten: r.absenceMinutes,
      Reiseziel: r.destinations.join(", "),
      Reisezweck: r.trips.map((t) => t.purpose).join(", "),
      Kunde: r.customers.join(", "),
      Kilometer: r.totalKm,
      SpesenVorKürzung: r.allowanceBefore,
      Frühstückskürzung: r.breakfastCut,
      Mittagessenkürzung: r.lunchCut,
      Abendessenkürzung: r.dinnerCut,
      SpesenNachKürzung: r.allowanceAfter,
      Kilometererstattung: r.mileage,
      Tankkosten: r.fuel,
      Übernachtung: r.accommodation,
      SonstigeKosten: r.other,
      OffenerBetrag: r.openAmount,
      Berechnung: r.reason,
    };
  });

export async function exportExcel(data: StatementData, state: AppState, context?: StatementExportContext) {
  const file = await excelFile(data, state, context);
  download(file.blob, file.name);
}

/** Dieselbe Excel-Datei wie „Excel“-Export, ohne Download. */
export async function excelFile(data: StatementData, state: AppState, context?: StatementExportContext) {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "SpesenKit";
  workbook.created = new Date();
  const vehicles = vehiclesForStatement(data, state);
  const overview = workbook.addWorksheet("Übersicht");
  overview.addRows([
    ["Reisekostenabrechnung"],
    ["Name", state.settings.profileName],
    ["Firma", state.settings.company],
    ["Abteilung", state.settings.department],
    ["Kostenstelle", state.settings.costCenter],
    ["Abrechnungsmonat", data.month],
    [],
    ["Fahrzeug", "Fahrzeugart", "Kennzeichen"],
    ...vehicles.map((vehicle) => [vehicle.name, vehicle.type, vehicle.plate]),
  ]);
  overview.getRow(1).font = { bold: true, size: 16 };
  overview.getRow(8).font = { bold: true };
  overview.columns = [{ width: 28 }, { width: 28 }, { width: 20 }];
  overview.addRow([]);
  // Summen dieses Abrechnungsstands (dieselben Werte wie in der App und im PDF).
  const sumHead = overview.addRow(["Summen", "Betrag"]); sumHead.font = { bold: true };
  for (const [label, value] of [
    ["Verpflegungspauschalen (nach Kürzung)", data.totals.allowance],
    ["Kilometererstattung", data.totals.mileage],
    ["Tankkosten", data.totals.fuel],
    ["Übernachtung", data.totals.accommodation],
    ["Sonstige Kosten", data.totals.other],
    ["Gesamtkosten", data.totals.grandTotal],
    ["Persönliche Erstattung (offener Betrag)", data.totals.openAmount],
  ] as const) overview.addRow([label, value]).getCell(2).numFmt = '#,##0.00 "€"';
  overview.addRow([]);
  overview.addRow(['Abrechnungsversion', context ? `Version ${context.version}` : 'Nicht gespeicherter Entwurf']);
  for (const text of [statementAmountLabel + ': Die Spalte OffenerBetrag enthält den rechnerischen Betrag dieses Abrechnungsstands, keine dokumentierte Restzahlung.', ...(context?.correction ? [correctionExportNotice] : [])]) {
    const row = overview.addRow([text]);
    overview.mergeCells(row.number, 1, row.number, 3);
    row.alignment = { wrapText: true, vertical: 'top' }; row.height = 60;
  }

  const expenses = workbook.addWorksheet("Reisekosten");
  const rows = rowsForExport(data, state);
  if (rows.length) {
    const headers = Object.keys(rows[0]);
    expenses.addRow(headers);
    for (const row of rows)
      expenses.addRow(headers.map((header) => row[header as keyof typeof row]));
    expenses.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    expenses.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF174F3A" },
    };
    expenses.views = [{ state: "frozen", ySplit: 1 }];
    expenses.columns.forEach((column) => {
      column.width = 18;
    });
    // Beträge mit Euro-Format, Kilometer mit einer Nachkommastelle. Die Datenzeilen bleiben reine Tabelle (Summen im Blatt „Übersicht“).
    headers.forEach((header, index) => {
      const column = expenses.getColumn(index + 1);
      if (MONEY_COLUMNS.has(header)) column.numFmt = '#,##0.00 "€"';
      else if (header === "Kilometer") column.numFmt = "#,##0.0";
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return {
    name: statementExportFilename(data.month, 'xlsx', context),
    blob: new Blob([buffer as unknown as BlobPart], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  };
}

function datevText(r: StatementData["rows"][number], state: AppState) {
  const vehicles = [...new Set(r.trips.map((trip) => vehicleDetails(state, trip).name).filter(Boolean))];
  const categories = [...new Set((r.contributions?.expenses || []).filter((e) => e.openAmount > 0).map((e) => e.category))];
  const what = r.trips.length ? `Reisekosten ${r.destinations.join(", ")}`.trim() : `Auslagen ${categories.join(", ")}`.trim();
  return [what, vehicles.join(", ")].filter(Boolean).join(" · ");
}

export function exportCsv(data: StatementData, state: AppState, datev = false, context?: StatementExportContext) {
  // DATEV: nur Tage mit einem Betrag (keine 0,00-Zeilen); Buchungstext ohne leere Teile.
  const rows: Record<string, unknown>[] = datev
    ? data.rows.filter((r) => r.openAmount !== 0).map((r) => ({
        Belegdatum: r.date.replaceAll("-", ""),
        Buchungstext: datevText(r, state),
        Betrag: r.openAmount.toFixed(2).replace(".", ","),
        Währung: "EUR",
        Kostenstelle: r.trips[0]?.costCenter || "",
      }))
    : (rowsForExport(data, state) as Record<string, unknown>[]);
  const csv = Papa.unparse(rows, { delimiter: ";" });
  download(
    new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }),
    statementExportFilename(data.month, 'csv', context, datev),
  );
}

/** JSON-Sicherung: alle Belegbilder eingebettet – die Datei ist für sich allein vollständig. */
export async function exportBackup(state: AppState) {
  state = await withAllReceiptImages(state);
  download(
    new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }),
    `Reisekosten_Backup_${new Date().toISOString().slice(0, 10)}.json`,
  );
}

export async function exportZip(
  data: StatementData,
  state: AppState,
  number: string,
  context?: StatementExportContext,
) {
  const file = await zipFile(data, state, number, context);
  download(file.blob, file.name);
}

/** Dasselbe Paket wie „ZIP + Belege“, ohne Download. */
export async function zipFile(
  data: StatementData,
  state: AppState,
  number: string,
  context?: StatementExportContext,
  /** Bereits erzeugte PDF derselben Version (Ablage): nicht ein zweites Mal aufbauen. */
  existingPdf?: Promise<{ name: string; blob: Blob }>,
) {
  const zip = new JSZip();
  state = await withReceiptImages(state, data.month);
  const pdf = await (existingPdf ?? pdfFile(data, state, number, context));
  zip.file(
    statementExportFilename(data.month, 'pdf', context),
    await pdf.blob.arrayBuffer(),
  );
  zip.file(
    `Abrechnung_${data.month}_${versionSuffix(context)}.json`,
    JSON.stringify({ number, data }, null, 2),
  );
  const entries = receiptIndex(data, state);
  for (const entry of entries) if (entry.expense.receipt && entry.archivePath) {
    const base64 = entry.expense.receipt.dataUrl.split(',')[1];
    zip.file(entry.archivePath, base64, { base64: true });
  }
  zip.file('Belegverzeichnis.csv', '\ufeff' + Papa.unparse(entries.map(entry => ({
    Beleg: entry.number, Datum: entry.expense.date, Kostenart: entry.expense.category,
    Beschreibung: entry.expense.description, Originalbetrag: entry.expense.gross,
    Währung: entry.expense.currency,
    Kurs: entry.expense.currency !== 'EUR' ? String(entry.expense.exchangeRate).replace('.', ',') : '', Kursquelle: entry.expense.currency !== 'EUR' ? entry.expense.exchangeRateSource || '' : '',
    Datei: entry.archivePath || '',
    Hinweis: entry.expense.receipt ? 'Originaldatei beigefügt' : 'Beleg fehlt',
  })), { delimiter: ';' }));
  return { name: statementExportFilename(data.month, 'zip', context), blob: await zip.generateAsync({ type: "blob" }) };
}
