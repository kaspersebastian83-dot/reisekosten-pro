import { excelFile, pdfFile, statementExportFilename, zipFile, type StatementExportContext } from "./exports";
import { FILING_DIR, FOLDER_NAME, ensureDir, fileExists, openDir, writeNewFile, type DirHandleLike } from "./folder-store";
import { isClosedStatement, stateForStatementVersion } from "./statement-comparison";
import type { AppState, StatementSnapshot } from "./types";

/*
 * Ablage abgeschlossener Abrechnungen im SpesenKit-Ordner:
 *   SpesenKit/Spesen/<Jahr>/<Monat>/Reisekosten_<Jahr-Monat>_V<Version>.pdf|.xlsx|.zip
 * Inhalt und Dateinamen sind identisch mit den Export-Knöpfen der Abrechnungsansicht (gleiche Funktionen, gleicher
 * Versionsstand). Vorhandene Dateien werden nie überschrieben – eine neue Version (Korrektur) kommt daneben.
 */
export type FilingFormat = "pdf" | "xlsx" | "zip";
export type FilingFormats = Record<FilingFormat, boolean>;
export const defaultFilingFormats: FilingFormats = { pdf: true, xlsx: false, zip: true };
export const filingFormatLabels: Record<FilingFormat, string> = { pdf: "PDF", xlsx: "Excel", zip: "ZIP mit Belegen" };
const order: FilingFormat[] = ["pdf", "xlsx", "zip"];

export interface FilingInputs {
  snapshot: StatementSnapshot;
  data: StatementSnapshot["data"];
  state: AppState;
  number: string;
  context: StatementExportContext;
  /** Einmal erzeugte PDF, die auch das ZIP enthält. */
  sharedPdf?: () => Promise<{ name: string; blob: Blob }>;
}
export interface FilingReport { folder: string; written: string[]; existing: string[] }

/** Dieselben Exportgrundlagen wie in der Abrechnungsansicht für eine gespeicherte Version. */
export function filingInputs(state: AppState, snapshotId: string): FilingInputs {
  const snapshot = state.statements.find((item) => item.id === snapshotId);
  if (!snapshot) throw new Error("Die Abrechnungsversion wurde nicht gefunden.");
  if (!isClosedStatement(snapshot)) throw new Error("Nur abgeschlossene Abrechnungen werden im SpesenKit-Ordner abgelegt.");
  const versions = state.statements.filter((item) => item.month === snapshot.month);
  return {
    snapshot,
    data: snapshot.data,
    state: stateForStatementVersion(state, snapshot),
    number: snapshot.number,
    context: { version: snapshot.version, correction: versions.some((item) => item.version < snapshot.version && isClosedStatement(item)) },
  };
}

export const filingPath = (month: string) => [FILING_DIR, month.slice(0, 4), month.slice(5, 7)];
export const filingLabel = (month: string) => [FOLDER_NAME, ...filingPath(month)].join("\\");
export function filingNames(inputs: Pick<FilingInputs, "data" | "context">) {
  return Object.fromEntries(order.map((format) => [format, statementExportFilename(inputs.data.month, format, inputs.context)])) as Record<FilingFormat, string>;
}

export type FileBuilders = {
  [K in FilingFormat]: (inputs: FilingInputs) => Promise<{ name: string; blob: Blob }>;
};
export const exportBuilders: FileBuilders = {
  pdf: async (i) => pdfFile(i.data, i.state, i.number, i.context),
  xlsx: (i) => excelFile(i.data, i.state, i.context),
  zip: (i) => zipFile(i.data, i.state, i.number, i.context, i.sharedPdf?.()),
};

/** Legt die gewählten Formate einer abgeschlossenen Version ab. Erzeugt nur, was noch fehlt. */
export async function fileStatement(root: DirHandleLike, state: AppState, snapshotId: string, formats: FilingFormats, builders: FileBuilders = exportBuilders): Promise<FilingReport> {
  const inputs = filingInputs(state, snapshotId);
  let pdf: Promise<{ name: string; blob: Blob }> | undefined;
  inputs.sharedPdf = () => (pdf ??= builders.pdf(inputs));
  const names = filingNames(inputs);
  const dir = await ensureDir(root, filingPath(inputs.data.month));
  const report: FilingReport = { folder: filingLabel(inputs.data.month), written: [], existing: [] };
  for (const format of order.filter((item) => formats[item])) {
    const result = await writeNewFile(dir, names[format], async () => {
      const file = await (format === "pdf" ? inputs.sharedPdf!() : builders[format](inputs));
      if (file.name !== names[format]) throw new Error(`Unerwarteter Dateiname ${file.name}.`);
      return file.blob;
    });
    report[result === "written" ? "written" : "existing"].push(names[format]);
  }
  return report;
}

/** Welche Dateien dieser Version liegen bereits im Ordner? (nur lesen) */
export async function filedStatus(root: DirHandleLike, state: AppState, snapshotId: string) {
  const inputs = filingInputs(state, snapshotId);
  const names = filingNames(inputs);
  const dir = await openDir(root, filingPath(inputs.data.month));
  const present: Partial<Record<FilingFormat, boolean>> = {};
  for (const format of order) present[format] = dir ? await fileExists(dir, names[format]) : false;
  return { folder: filingLabel(inputs.data.month), names, present: present as Record<FilingFormat, boolean> };
}
