import { describe, expect, it } from "vitest";
import { slimChangeLog } from "../lib/change-log";
import { demoState } from "../lib/demo";
import { copiesToPrune, dailyBackup, listBackups, parseBackupName } from "../lib/folder-backups";
import { FOLDER_NAME, readDataFile, writeDataFile, writeSafetyCopy } from "../lib/folder-store";
import { isShrinkableImage, jpegName, receiptTargetSize } from "../lib/receipt-file";
import type { AppState, Expense } from "../lib/types";
import { FakeDir } from "./helpers/fake-dir";

const at = (date: string, time = "09:00:00") => new Date(`${date}T${time}`);
const photo = "data:image/jpeg;base64," + "A".repeat(5000);
const withReceipt = (state: AppState): AppState => {
  const next = structuredClone(state);
  const expense = next.expenses[0] as Expense;
  expense.receipt = { id: "r1", name: "IMG_1.jpg", type: "image/jpeg", size: 3750, hash: "abc", dataUrl: photo };
  return next;
};
const kinds = async (root: FakeDir) => (await listBackups(root)).map((entry) => entry.kind).sort();

describe("Änderungsprotokoll ohne Belegbilder", () => {
  it("behält Name, Größe, Typ und Fingerabdruck, lässt das Bild weg", () => {
    const state = withReceipt(demoState());
    const expense = state.expenses[0];
    state.changes.push({ id: "c1", entityType: "expense", entityId: expense.id, field: "Gesamtdatensatz", oldValue: expense, newValue: { ...expense, gross: 1 }, reason: "Manuelle Bearbeitung", user: "Test", changedAt: "2026-10-26T08:00:00Z" });
    const slim = slimChangeLog(state);
    const old = slim.changes.at(-1)!.oldValue as Expense;
    expect(old.receipt).toEqual({ id: "r1", name: "IMG_1.jpg", type: "image/jpeg", size: 3750, hash: "abc", dataUrl: "" });
    expect((slim.changes.at(-1)!.newValue as Expense).gross).toBe(1);
    expect(slim.expenses[0].receipt?.dataUrl, "der Beleg selbst bleibt vollständig").toBe(photo);
    expect(JSON.stringify(slim).length).toBeLessThan(JSON.stringify(state).length - 9000);
  });
  it("gibt denselben Stand zurück, wenn nichts zu tun ist (kein unnötiges Speichern)", () => {
    const state = withReceipt(demoState());
    expect(slimChangeLog(state)).toBe(state);
  });
});

describe("Kopien je Speichervorgang im Ordner", () => {
  it("löscht die Kopien des vorigen eigenen Speicherns, sobald die Datei noch genau diesen Stand hat", async () => {
    const root = new FakeDir(FOLDER_NAME);
    let last: { hash: string; names: string[] } | undefined;
    const save = async (state: AppState, revision: number) => {
      let names: string[] = [];
      const result = await writeDataFile(root, state, revision, undefined, new Date(), { staleCopies: last, onCopies: (n) => { names = n; } });
      last = { hash: result.hash, names };
    };
    const states = [0, 1, 2, 3, 4].map((n) => ({ ...demoState(), settings: { ...demoState().settings, profileName: `Stand ${n}` } }));
    for (const [i, state] of states.entries()) await save(state, i);
    expect(await kinds(root), "nur die zwei Kopien des letzten Speicherns").toEqual(["speicherkandidat", "vor_speichern"]);
    expect((await readDataFile(root))?.state.settings.profileName).toBe("Stand 4");
  });

  it("behält die eigenen Kopien, wenn jemand anderes dazwischen gespeichert hat", async () => {
    const root = new FakeDir(FOLDER_NAME);
    const profile = (name: string) => ({ ...demoState(), settings: { ...demoState().settings, profileName: name } });
    let names: string[] = [];
    const mine = await writeDataFile(root, profile("A1"), 0, undefined, new Date(), { onCopies: (n) => { names = n; } });
    await writeDataFile(root, profile("B"), 1);                          // andere Sitzung
    const other = await readDataFile(root);
    await writeDataFile(root, profile("A2"), 2, undefined, new Date(), { expectedHash: other!.hash, staleCopies: { hash: mine.hash, names } });
    const left = (await listBackups(root)).map((entry) => entry.name);
    for (const name of names) expect(left).toContain(name);
  });

  it("räumt liegengebliebene Kopien nach 7 Tagen auf, andere Sicherungen nie", async () => {
    const root = new FakeDir(FOLDER_NAME);
    for (const day of ["2026-10-01", "2026-10-10", "2026-10-25"]) {
      await writeSafetyCopy(root, "speicherkandidat", demoState(), at(day));
      await writeSafetyCopy(root, "vor_speichern", demoState(), at(day));
    }
    await writeSafetyCopy(root, "manuell", demoState(), at("2026-01-01"));
    await writeSafetyCopy(root, "abschluss_2026-09_V01", demoState(), at("2026-10-01"));
    await writeSafetyCopy(root, "browserstand", demoState(), at("2026-02-01"));
    const result = await dailyBackup(root, demoState(), at("2026-10-26"));
    expect(result.pruned).toHaveLength(4);
    expect(await kinds(root)).toEqual(["abschluss", "auto", "browserstand", "manuell", "speicherkandidat", "vor_speichern"]);
    const entry = (date: string, kind: string) => ({ ...parseBackupName(`spesenkit_${kind}_${date}_090000.json`)!, size: 1 });
    expect(copiesToPrune([entry("2026-10-19", "speicherkandidat"), entry("2026-10-18", "vor_speichern"), entry("2026-01-01", "manuell")], at("2026-10-26"))).toEqual(["spesenkit_vor_speichern_2026-10-18_090000.json"]);
  });
});

describe("Tagessicherung: Ordner nur einmal am Tag auflisten", () => {
  it("merkt sich den Tag über den Ordnernamen, nicht über das Handle-Objekt", async () => {
    const root = new FakeDir(FOLDER_NAME);
    let listed = 0;
    const counting = new Proxy(root, { get(target, prop, receiver) { if (prop === "getDirectoryHandle") listed++; const v = Reflect.get(target, prop, receiver); return typeof v === "function" ? v.bind(target) : v; } });
    const memo = {};
    const first = await dailyBackup(counting, demoState(), at("2026-10-26", "09:00:00"), undefined, Object.assign(memo, { forKey: "Basti\\SpesenKit" }));
    expect(first.written).toBeTruthy();
    listed = 0;
    // Neues Handle-Objekt wie aus IndexedDB, gleicher Ordner: kein Auflisten mehr
    const again = await dailyBackup(new Proxy(counting, {}), demoState(), at("2026-10-26", "15:00:00"), undefined, Object.assign(memo, { forKey: "Basti\\SpesenKit" }));
    expect(again.written).toBeNull();
    expect(listed).toBe(0);
    await dailyBackup(new Proxy(counting, {}), demoState(), at("2026-10-26", "16:00:00"));
    expect(listed, "ohne Merker wird gelistet (Gegenprobe)").toBeGreaterThan(0);
    // Anderer Tag: wieder prüfen und sichern
    expect((await dailyBackup(root, demoState(), at("2026-10-27"), undefined, Object.assign(memo, { forKey: "Basti\\SpesenKit" }))).written).toBeTruthy();
  });
});

describe("Belegfotos verkleinern", () => {
  it("längste Seite höchstens 2000 Pixel, Seitenverhältnis bleibt, nie vergrößern", () => {
    expect(receiptTargetSize(4032, 3024)).toEqual({ width: 2000, height: 1500 });
    expect(receiptTargetSize(1200, 9000)).toEqual({ width: 267, height: 2000 });
    expect(receiptTargetSize(800, 600)).toEqual({ width: 800, height: 600 });
  });
  it("nur Bilder; PDFs bleiben unverändert", () => {
    expect(isShrinkableImage({ name: "IMG_1.HEIC", type: "" })).toBe(true);
    expect(isShrinkableImage({ name: "foto", type: "image/png" })).toBe(true);
    expect(isShrinkableImage({ name: "Rechnung.pdf", type: "application/pdf" })).toBe(false);
    expect(isShrinkableImage({ name: "Rechnung.pdf", type: "" })).toBe(false);
    expect(jpegName("IMG_4711.HEIC")).toBe("IMG_4711.jpg");
    expect(jpegName("Quittung Tankstelle.png")).toBe("Quittung Tankstelle.jpg");
  });
});
