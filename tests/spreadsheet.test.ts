import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { parseImportFile } from "../lib/importer";

describe("sicherer XLSX-Import", () => {
  it("liest Tabellenblätter und bewahrt Zahlenwerte", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Fahrten");
    sheet.addRow(["Datum", "Abfahrtszeit", "dienstliche Kilometer"]);
    sheet.addRow(["14.07.2026", "07:45", 68.5]);
    const buffer = await workbook.xlsx.writeBuffer();
    const file = new File(
      [buffer as unknown as BlobPart],
      "fahrten.xlsx",
      {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    );

    const result = await parseImportFile(file);

    expect(result.format).toBe("generic");
    expect(result.sheets.Fahrten).toEqual([
      {
        Datum: "14.07.2026",
        Abfahrtszeit: "07:45",
        "dienstliche Kilometer": 68.5,
      },
    ]);
  });
});
