import JSZip from "jszip";
import Papa from "papaparse";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { AppState, StatementData } from "./types";

const euro = (n: number) =>
  n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });

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

function buildPdfDocument(
  data: StatementData,
  state: AppState,
  number: string,
) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  doc.text("Reisekostenabrechnung", 14, 16);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const monthLabel = new Date(`${data.month}-01T12:00:00`).toLocaleDateString(
    "de-DE",
    { month: "long", year: "numeric" },
  );
  const vehicles = vehiclesForStatement(data, state);
  doc.text(
    `Name: ${state.settings.profileName || "nicht hinterlegt"}  ·  Firma: ${state.settings.company || "nicht hinterlegt"}`,
    14,
    23,
  );
  doc.text(
    `Abrechnungsmonat: ${monthLabel}  ·  Abrechnungsnummer: ${number}${state.settings.costCenter ? `  ·  Kostenstelle: ${state.settings.costCenter}` : ""}`,
    14,
    28,
  );
  const vehicleLines = doc.splitTextToSize(
    `Fahrzeug${vehicles.length === 1 ? "" : "e"}: ${vehicles.length ? vehicles.map(vehicleLabel).join("  |  ") : "keine Fahrzeugangabe"}`,
    265,
  );
  doc.text(vehicleLines, 14, 33);
  autoTable(doc, {
    startY: 36 + vehicleLines.length * 4,
    head: [
      [
        "Datum",
        "Beginn",
        "Ende",
        "Abwesenheit",
        "Ziel / Zweck",
        "km",
        "Spesen vor",
        "Kürzung",
        "Spesen nach",
        "km-Erstattung",
        "Hotel",
        "Sonstiges",
        "Offen",
      ],
    ],
    body: data.rows.map((r) => [
      r.date.split("-").reverse().join("."),
      r.firstStart,
      r.lastEnd,
      `${Math.floor(r.absenceMinutes / 60)}:${String(r.absenceMinutes % 60).padStart(2, "0")}`,
      `${r.destinations.join(", ")} – ${r.trips
        .map((t) => t.purpose)
        .filter(Boolean)
        .join(", ")}`,
      r.totalKm.toLocaleString("de-DE"),
      euro(r.allowanceBefore),
      euro(r.breakfastCut + r.lunchCut + r.dinnerCut),
      euro(r.allowanceAfter),
      euro(r.mileage),
      euro(r.accommodation),
      euro(r.other + r.fuel),
      euro(r.openAmount),
    ]),
    styles: { font: "helvetica", fontSize: 7, cellPadding: 1.6 },
    headStyles: { fillColor: [21, 71, 52] },
    margin: { left: 10, right: 10 },
    didDrawPage: () => {
      doc.setFontSize(7);
      doc.text(
        `Erstellt am ${new Date().toLocaleDateString("de-DE")} · Seite ${doc.getNumberOfPages()}`,
        250,
        202,
      );
    },
  });
  const y = Math.min(
    175,
    ((doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable
      ?.finalY || 100) + 8,
  );
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.text(
    `Spesen: ${euro(data.totals.allowance)}  |  Kilometer: ${euro(data.totals.mileage)}  |  Gesamtkosten: ${euro(data.totals.grandTotal)}  |  Offener Auszahlungsbetrag: ${euro(data.totals.openAmount)}`,
    14,
    y,
  );
  doc.setFont("helvetica", "normal");
  doc.text(
    "Ort/Datum: ____________________   Unterschrift Reisender: ____________________   Sachlich geprüft: ____________________   Freigabe/Buchhaltung: ____________________",
    14,
    y + 13,
  );
  const receipts = state.expenses
    .filter((expense) => expense.date.startsWith(data.month) && expense.receipt)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (receipts.length) {
    doc.addPage("a4", "landscape");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("Belegverzeichnis", 14, 17);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(
      `${number} · ${receipts.length} Beleg${receipts.length === 1 ? "" : "e"}`,
      14,
      24,
    );
    autoTable(doc, {
      startY: 30,
      head: [
        [
          "Beleg",
          "Datum",
          "Kategorie",
          "Händler / Beschreibung",
          "Betrag",
          "Zahlungsart",
          "Datei",
        ],
      ],
      body: receipts.map((expense, index) => [
        `B-${data.month.replace("-", "")}-${String(index + 1).padStart(3, "0")}`,
        expense.date.split("-").reverse().join("."),
        expense.category,
        expense.merchant || expense.description,
        euro(expense.gross),
        expense.paymentType,
        expense.receipt!.name,
      ]),
      styles: { font: "helvetica", fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [21, 71, 52] },
      margin: { left: 14, right: 14 },
    });
    receipts.forEach((expense, index) => {
      const receipt = expense.receipt!;
      const supportedImage =
        /^image\/(jpeg|jpg|png)$/i.test(receipt.type) ||
        /^data:image\/(jpeg|jpg|png)/i.test(receipt.dataUrl);
      doc.addPage("a4", "portrait");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      const receiptNumber = `B-${data.month.replace("-", "")}-${String(index + 1).padStart(3, "0")}`;
      doc.text(
        `${receiptNumber} · ${expense.category} · ${euro(expense.gross)}`,
        12,
        14,
      );
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text(
        `${expense.date.split("-").reverse().join(".")} · ${expense.merchant || expense.description} · ${receipt.name}`,
        12,
        20,
      );
      if (supportedImage) {
        try {
          const properties = doc.getImageProperties(receipt.dataUrl);
          const maxWidth = 186;
          const maxHeight = 260;
          const scale = Math.min(
            maxWidth / properties.width,
            maxHeight / properties.height,
          );
          const width = properties.width * scale;
          const height = properties.height * scale;
          doc.addImage(
            receipt.dataUrl,
            properties.fileType,
            (210 - width) / 2,
            27,
            width,
            height,
            undefined,
            "FAST",
          );
        } catch {
          doc.text(
            "Die Bildvorschau konnte nicht in die PDF eingebettet werden. Der Originalbeleg befindet sich im ZIP-Export.",
            12,
            35,
            { maxWidth: 180 },
          );
        }
      } else {
        doc.text(
          "Dieser Belegtyp wird im Original über das ZIP-Paket beigefügt. Eine Bildvorschau ist in der PDF nicht verfügbar.",
          12,
          35,
          { maxWidth: 180 },
        );
      }
    });
  }
  return doc;
}

export function exportPdf(
  data: StatementData,
  state: AppState,
  number: string,
) {
  const doc = buildPdfDocument(data, state, number);
  doc.save(`Reisekosten_${data.month}_${number}.pdf`);
}

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

export async function exportExcel(data: StatementData, state: AppState) {
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
  }

  const buffer = await workbook.xlsx.writeBuffer();
  download(
    new Blob([buffer as unknown as BlobPart], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    `Reisekosten_${data.month}.xlsx`,
  );
}

export function exportCsv(data: StatementData, state: AppState, datev = false) {
  const rows: Record<string, unknown>[] = datev
    ? data.rows.map((r) => ({
        Belegdatum: r.date.replaceAll("-", ""),
        Buchungstext: `Reisekosten ${r.destinations.join(", ")} · ${[
          ...new Set(r.trips.map((trip) => vehicleDetails(state, trip).name)),
        ].join(", ")}`,
        Betrag: r.openAmount.toFixed(2).replace(".", ","),
        Währung: "EUR",
        Kostenstelle: r.trips[0]?.costCenter || "",
      }))
    : (rowsForExport(data, state) as Record<string, unknown>[]);
  const csv = Papa.unparse(rows, { delimiter: ";" });
  download(
    new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }),
    datev
      ? `DATEV_Reisekosten_${data.month}.csv`
      : `Reisekosten_${data.month}.csv`,
  );
}

export function exportBackup(state: AppState) {
  download(
    new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }),
    `Reisekosten_Backup_${new Date().toISOString().slice(0, 10)}.json`,
  );
}

export async function exportZip(
  data: StatementData,
  state: AppState,
  number: string,
) {
  const zip = new JSZip();
  const pdf = buildPdfDocument(data, state, number);
  zip.file(
    `Reisekosten_${data.month}_${number}.pdf`,
    pdf.output("arraybuffer"),
  );
  zip.file(
    `Abrechnung_${data.month}.json`,
    JSON.stringify({ number, data }, null, 2),
  );
  state.expenses
    .filter((e) => e.date.startsWith(data.month) && e.receipt)
    .forEach((e) => {
      const base64 = e.receipt!.dataUrl.split(",")[1];
      zip.file(`Belege/${e.id}_${e.receipt!.name}`, base64, { base64: true });
    });
  download(
    await zip.generateAsync({ type: "blob" }),
    `Reisekosten_${data.month}_mit_Belegen.zip`,
  );
}
