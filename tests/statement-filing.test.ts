import { describe, expect, it } from "vitest";
import { buildStatement } from "../lib/calculations";
import { demoState } from "../lib/demo";
import { statementExportFilename } from "../lib/exports";
import { FILING_DIR, FOLDER_NAME } from "../lib/folder-store";
import { defaultFilingFormats, exportBuilders, filedStatus, fileStatement, filingInputs, type FileBuilders, type FilingInputs } from "../lib/statement-filing";
import type { AppState, StatementSnapshot } from "../lib/types";
import { FakeDir } from "./helpers/fake-dir";

const month = "2026-07";
function withVersion(state: AppState, version: number, status: StatementSnapshot["status"] = "freigegeben", locked = true): AppState {
  const snapshot: StatementSnapshot = {
    id: `v${version}`, month, number: "RK-202607-001", createdAt: `2026-08-0${version}T10:00:00Z`, status, version, locked,
    data: buildStatement(state, month),
    settingsSnapshot: structuredClone(state.settings),
    expensesSnapshot: structuredClone(state.expenses.filter((e) => e.date.startsWith(month))),
    relatedTripsSnapshot: [],
  };
  return { ...state, statements: [...state.statements, snapshot] };
}
/** Zählt Aufrufe und liefert kleine Platzhalterdateien – prüft die Ablage ohne PDF-/Excel-Erzeugung. */
function spyBuilders() {
  const calls: { format: string; inputs: FilingInputs }[] = [];
  const make = (format: "pdf" | "xlsx" | "zip"): FileBuilders["pdf"] => async (inputs) => {
    calls.push({ format, inputs });
    return { name: statementExportFilename(inputs.data.month, format, inputs.context), blob: new Blob([`${format}:V${inputs.context.version}`]) };
  };
  return { calls, builders: { pdf: make("pdf"), xlsx: make("xlsx"), zip: make("zip") } as FileBuilders };
}
const dirAt = (root: FakeDir, ...parts: string[]) => parts.reduce<FakeDir | undefined>((dir, part) => dir?.dirs.get(part), root);

describe("Ablage abgeschlossener Abrechnungen im SpesenKit-Ordner", () => {
  it("legt PDF und ZIP (Standard) unter Spesen/Jahr/Monat mit den Exportnamen ab", async () => {
    const root = new FakeDir(FOLDER_NAME);
    const state = withVersion(demoState(), 1);
    const { builders } = spyBuilders();
    const report = await fileStatement(root, state, "v1", defaultFilingFormats, builders);
    expect(report).toEqual({ folder: `${FOLDER_NAME}\\${FILING_DIR}\\2026\\07`, written: ["Reisekosten_2026-07_V01.pdf", "Reisekosten_2026-07_V01.zip"], existing: [] });
    expect([...dirAt(root, FILING_DIR, "2026", "07")!.files.keys()]).toEqual(["Reisekosten_2026-07_V01.pdf", "Reisekosten_2026-07_V01.zip"]);
  });

  it("erzeugt echte Dateien über dieselben Funktionen wie die Export-Knöpfe", async () => {
    const root = new FakeDir(FOLDER_NAME);
    const state = withVersion(demoState(), 1);
    await fileStatement(root, state, "v1", { pdf: true, xlsx: true, zip: true }, exportBuilders);
    const dir = dirAt(root, FILING_DIR, "2026", "07")!;
    const head = async (name: string) => new Uint8Array(await (dir.files.get(name) as Blob).slice(0, 4).arrayBuffer());
    expect(String.fromCharCode(...await head("Reisekosten_2026-07_V01.pdf"))).toBe("%PDF");
    expect(String.fromCharCode(...(await head("Reisekosten_2026-07_V01.xlsx")).slice(0, 2))).toBe("PK");
    expect(String.fromCharCode(...(await head("Reisekosten_2026-07_V01.zip")).slice(0, 2))).toBe("PK");
  });

  it("überschreibt nie: ein zweiter Lauf erzeugt nichts neu und meldet vorhandene Dateien", async () => {
    const root = new FakeDir(FOLDER_NAME);
    const state = withVersion(demoState(), 1);
    await fileStatement(root, state, "v1", defaultFilingFormats, spyBuilders().builders);
    const dir = dirAt(root, FILING_DIR, "2026", "07")!;
    dir.files.set("Reisekosten_2026-07_V01.pdf", "vom Mitarbeiter unterschrieben");
    const again = spyBuilders();
    const report = await fileStatement(root, state, "v1", defaultFilingFormats, again.builders);
    expect(again.calls).toEqual([]);
    expect(report.written).toEqual([]);
    expect(report.existing).toEqual(["Reisekosten_2026-07_V01.pdf", "Reisekosten_2026-07_V01.zip"]);
    expect(dir.files.get("Reisekosten_2026-07_V01.pdf")).toBe("vom Mitarbeiter unterschrieben");
  });

  it("ergänzt nur fehlende Formate (z. B. Excel nachträglich gewählt)", async () => {
    const root = new FakeDir(FOLDER_NAME);
    const state = withVersion(demoState(), 1);
    await fileStatement(root, state, "v1", defaultFilingFormats, spyBuilders().builders);
    const later = spyBuilders();
    const report = await fileStatement(root, state, "v1", { pdf: true, xlsx: true, zip: true }, later.builders);
    expect(later.calls.map((c) => c.format)).toEqual(["xlsx"]);
    expect(report.written).toEqual(["Reisekosten_2026-07_V01.xlsx"]);
  });

  it("legt eine Korrektur als V02 daneben ab; V01 bleibt unverändert und V02 ist als Korrektur gekennzeichnet", async () => {
    const root = new FakeDir(FOLDER_NAME);
    let state = withVersion(demoState(), 1);
    await fileStatement(root, state, "v1", defaultFilingFormats, spyBuilders().builders);
    const v1 = dirAt(root, FILING_DIR, "2026", "07")!.files.get("Reisekosten_2026-07_V01.pdf");
    state = withVersion(state, 2);
    const spy = spyBuilders();
    await fileStatement(root, state, "v2", defaultFilingFormats, spy.builders);
    const files = dirAt(root, FILING_DIR, "2026", "07")!.files;
    expect([...files.keys()].sort()).toEqual(["Reisekosten_2026-07_V01.pdf", "Reisekosten_2026-07_V01.zip", "Reisekosten_2026-07_V02.pdf", "Reisekosten_2026-07_V02.zip"]);
    expect(files.get("Reisekosten_2026-07_V01.pdf")).toBe(v1);
    expect(spy.calls.every((c) => c.inputs.context.correction && c.inputs.context.version === 2)).toBe(true);
    expect(filingInputs(state, "v1").context.correction).toBe(false);
  });

  it("verwendet den gespeicherten Stand der Version, nicht spätere Änderungen", async () => {
    const root = new FakeDir(FOLDER_NAME);
    const state = withVersion(demoState(), 1);
    const changed = structuredClone(state);
    changed.expenses[0].gross = 9999; changed.settings.profileName = "Später geändert";
    const spy = spyBuilders();
    await fileStatement(root, changed, "v1", { pdf: true, xlsx: false, zip: false }, spy.builders);
    const used = spy.calls[0].inputs;
    expect(used.data).toBe(changed.statements[0].data);
    expect(used.state.expenses).toEqual(state.statements[0].expensesSnapshot);
    expect(used.state.settings.profileName).toBe(state.settings.profileName);
  });

  it.each([
    ["Entwurf", "vollständig" as const, false],
    ["storniert", "storniert" as const, true],
  ])("legt keine nicht abgeschlossene Version ab (%s)", async (_label, status, locked) => {
    const root = new FakeDir(FOLDER_NAME);
    const state = withVersion(demoState(), 1, status, locked);
    await expect(fileStatement(root, state, "v1", defaultFilingFormats, spyBuilders().builders)).rejects.toThrow(/Nur abgeschlossene/);
    expect(root.dirs.size).toBe(0);
  });

  it("hinterlässt bei einem Schreibfehler keine halbe Datei und lässt sich wiederholen", async () => {
    const root = new FakeDir(FOLDER_NAME, { failClose: "Reisekosten_2026-07_V01.zip" });
    const state = withVersion(demoState(), 1);
    await expect(fileStatement(root, state, "v1", defaultFilingFormats, spyBuilders().builders)).rejects.toMatchObject({ code: "write" });
    expect([...dirAt(root, FILING_DIR, "2026", "07")!.files.keys()]).toEqual(["Reisekosten_2026-07_V01.pdf"]);
    root.faults.failClose = undefined;
    const report = await fileStatement(root, state, "v1", defaultFilingFormats, spyBuilders().builders);
    expect(report).toMatchObject({ written: ["Reisekosten_2026-07_V01.zip"], existing: ["Reisekosten_2026-07_V01.pdf"] });
  });

  it("behandelt eine leere Datei (abgebrochener Schreibvorgang) als fehlend und legt sie richtig ab", async () => {
    const root = new FakeDir(FOLDER_NAME);
    const state = withVersion(demoState(), 1);
    const dir = await (await (await root.getDirectoryHandle(FILING_DIR, { create: true })).getDirectoryHandle("2026", { create: true })).getDirectoryHandle("07", { create: true }) as FakeDir;
    dir.files.set("Reisekosten_2026-07_V01.zip", "");
    const report = await fileStatement(root, state, "v1", defaultFilingFormats, spyBuilders().builders);
    expect(report.written).toEqual(["Reisekosten_2026-07_V01.pdf", "Reisekosten_2026-07_V01.zip"]);
    expect(await (dir.files.get("Reisekosten_2026-07_V01.zip") as Blob).text()).toBe("zip:V1");
  });

  it("zeigt an, welche Dateien einer Version bereits abgelegt sind (nur lesend)", async () => {
    const root = new FakeDir(FOLDER_NAME);
    const state = withVersion(demoState(), 1);
    expect((await filedStatus(root, state, "v1")).present).toEqual({ pdf: false, xlsx: false, zip: false });
    expect(root.dirs.size).toBe(0);
    await fileStatement(root, state, "v1", { pdf: true, xlsx: false, zip: false }, spyBuilders().builders);
    expect((await filedStatus(root, state, "v1")).present).toEqual({ pdf: true, xlsx: false, zip: false });
  });
});
