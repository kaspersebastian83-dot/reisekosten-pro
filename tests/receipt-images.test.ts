import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import JSZip from "jszip";
import { demoState } from "../lib/demo";
import { buildStatement } from "../lib/calculations";
import {
  DATA_DIR, DATA_FILE, FOLDER_NAME, RECEIPT_DIR, cacheFolderReceipts, decideReconcile, legacyFileHash, readDataFile, readReceiptImage,
  stateHash, translateLegacyLink, writeDataFile,
} from "../lib/folder-store";
import {
  MissingReceiptImageError, detachReceipts, forgetSessionReceiptImages, hasEmbeddedImages, receiptDataUrl, receiptFileId, receiptIdentity, referencedFileIds,
  withAllReceiptImages, withReceiptImages,
} from "../lib/receipt-images";
import { normalizeState } from "../lib/storage";
import { stableValue } from "../lib/statement-comparison";
import { zipFile } from "../lib/exports";
import { sampleReceiptImages } from "./fixtures/pdf-receipts";
import { FakeDir } from "./helpers/fake-dir";
import type { AppState, Expense, Receipt } from "../lib/types";

const bytesOf = (dataUrl: string) => Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
/** So wie SpesenKit bis 1.8 den Fingerabdruck berechnet hat (Bilder eingebettet). */
const oldStateHash = (state: AppState) => createHash("sha256").update(stableValue(normalizeState(JSON.parse(JSON.stringify(state)), { detach: false }))).digest("hex");
const withoutFileIds = (state: unknown) => JSON.parse(JSON.stringify(state, (key, value) => key === "fileId" ? undefined : value));

const image = sampleReceiptImages.taxi;
const receipt = (id: string, dataUrl = image): Receipt => ({ id, name: `${id}.jpg`, type: "image/jpeg", size: bytesOf(dataUrl).length, hash: `orig-${id}`, dataUrl });
/** Bestand wie bis 1.8: dasselbe Bild in Kosten, Beleg-Eingang und eingefrorener Version. */
function legacyState(count = 3): AppState {
  const state = demoState();
  const base = state.expenses[0];
  for (let i = 0; i < count; i++) {
    const dataUrl = i === 0 ? image : `data:image/png;base64,${Buffer.from(`Beleg ${i} `.repeat(400 + i)).toString("base64")}`;
    const expense: Expense = { ...structuredClone(base), id: `beleg${i}`, date: `2026-07-${String(10 + i).padStart(2, "0")}`, receipt: receipt(`r${i}`, dataUrl) };
    state.expenses.push(expense);
    state.receiptInbox.push({ id: `i${i}`, receipt: structuredClone(expense.receipt!), capturedAt: "2026-07-10T10:00:00Z", status: "zugeordnet", suggestion: { confidence: 90 }, expenseId: expense.id, notes: "" });
  }
  state.statements.push({ id: "closed-july", month: "2026-07", number: "RK-202607", version: 1, createdAt: "2026-08-01T10:00:00Z", status: "freigegeben", locked: true,
    data: buildStatement(state, "2026-07"), settingsSnapshot: structuredClone(state.settings), expensesSnapshot: structuredClone(state.expenses.filter((e) => e.date.startsWith("2026-07"))) });
  return state;
}

beforeEach(() => forgetSessionReceiptImages());

describe("Belegbilder: Fingerabdruck und Herauslösen", () => {
  it("Fingerabdruck = SHA-256 der Bytes + Endung; kein base64-Daten-URL bleibt eingebettet", () => {
    expect(receiptFileId(image)).toBe(`${sha(bytesOf(image))}.jpg`);
    expect(receiptFileId(sampleReceiptImages.parking)).toMatch(/^[0-9a-f]{64}\.png$/);
    expect(receiptFileId("data:application/pdf;base64,SGFsbG8=")).toBe(`${sha(Buffer.from("Hallo"))}.pdf`);
    expect(receiptFileId("https://example.org/beleg.jpg")).toBeNull();
    expect(receiptFileId("data:text/plain,Hallo")).toBeNull();
    expect(receiptFileId("")).toBeNull();
  });

  it("speichert dasselbe Bild aus Kosten, Eingang und Abrechnungsversion nur einmal und ist wiederholbar", () => {
    const legacy = legacyState();
    expect(hasEmbeddedImages(legacy)).toBe(true);
    const slim = detachReceipts(legacy);
    expect(hasEmbeddedImages(slim)).toBe(false);
    expect(referencedFileIds(slim).size).toBe(3);
    const id = slim.expenses.find((e) => e.id === "beleg0")!.receipt!.fileId!;
    expect(slim.receiptInbox.find((i) => i.id === "i0")!.receipt.fileId).toBe(id);
    expect(slim.statements[0].expensesSnapshot!.find((e) => e.id === "beleg0")!.receipt!.fileId).toBe(id);
    expect(slim.expenses.every((e) => !e.receipt?.dataUrl)).toBe(true);
    expect(detachReceipts(slim)).toBe(slim);                       // nichts mehr zu tun: dieselbe Referenz
    expect(legacy.expenses.find((e) => e.id === "beleg0")!.receipt!.dataUrl).toBe(image);   // Eingabe bleibt unverändert
    expect(JSON.stringify(slim).length).toBeLessThan(JSON.stringify(legacy).length / 3);
  });

  it("normalizeState löst ältere Stände beim Laden heraus; Vergleich von Belegen ohne Scheinänderung", async () => {
    const legacy = legacyState();
    const slim = normalizeState(structuredClone(legacy));
    expect(hasEmbeddedImages(slim)).toBe(false);
    const inline = legacy.expenses.find((e) => e.id === "beleg1")!.receipt, ref = slim.expenses.find((e) => e.id === "beleg1")!.receipt;
    expect(stableValue(receiptIdentity(inline))).toBe(stableValue(receiptIdentity(ref)));
    expect(stableValue(receiptIdentity({ ...inline!, dataUrl: image }))).not.toBe(stableValue(receiptIdentity(ref)));
    expect(await receiptDataUrl(ref)).toBe(inline!.dataUrl);
    expect(withoutFileIds(await withAllReceiptImages(slim))).toEqual(withoutFileIds(normalizeState(structuredClone(legacy), { detach: false })));
    const july = await withReceiptImages(slim, "2026-07");
    expect(july.expenses.filter((e) => e.receipt).every((e) => e.receipt!.dataUrl.startsWith("data:"))).toBe(true);
  });
});

describe("Belegbilder im SpesenKit-Ordner", () => {
  it("Datendatei ohne Bilder (Format 2), jedes Bild genau einmal unter Belege/, beim nächsten Speichern nicht erneut", async () => {
    const writes: string[] = [];
    const root = new FakeDir(FOLDER_NAME, { beforeOperation: async (name, operation) => { if (operation === "close") writes.push(name); } });
    const state = normalizeState(legacyState());
    const first = await writeDataFile(root, state, 0);
    const text = root.file(DATA_DIR, DATA_FILE) as string;
    expect(JSON.parse(text).formatVersion).toBe(2);
    expect(text).not.toContain(";base64,");
    const ids = [...referencedFileIds(state)];
    expect([...(root.dirs.get(RECEIPT_DIR)!.files.keys())].sort()).toEqual([...ids].sort());
    for (const id of ids) expect(sha(new Uint8Array(await (root.file(RECEIPT_DIR, id) as Blob).arrayBuffer()))).toBe(id.slice(0, 64));
    writes.length = 0;
    const next = structuredClone(state); next.settings.profileName = "Geändert";
    await writeDataFile(root, next, first.revision, undefined, new Date(), { expectedHash: first.hash });
    expect(writes.filter((name) => ids.includes(name))).toEqual([]);
  });

  it("leere Belegdatei (abgebrochener Schreibvorgang) gilt als fehlend und wird beim nächsten Speichern geschrieben", async () => {
    const root = new FakeDir(FOLDER_NAME);
    const state = normalizeState(legacyState());
    const first = await writeDataFile(root, state, 0);
    const id = [...referencedFileIds(state)][0], belege = root.dirs.get(RECEIPT_DIR)!;
    belege.files.set(id, "");                                      // 0 Byte: nach create, vor close abgebrochen
    const next = structuredClone(state); next.settings.profileName = "Geändert";
    await writeDataFile(root, next, first.revision, undefined, new Date(), { expectedHash: first.hash });
    const written = belege.files.get(id) as Blob;
    expect(written.size).toBeGreaterThan(0);
    expect(sha(new Uint8Array(await written.arrayBuffer()))).toBe(id.slice(0, 64));
  });

  it("liest Bilder aus dem Ordner zurück (anderer Rechner) und erkennt veränderte Dateien", async () => {
    const root = new FakeDir(FOLDER_NAME);
    const legacy = legacyState(), state = normalizeState(structuredClone(legacy));
    await writeDataFile(root, state, 0);
    forgetSessionReceiptImages();                                  // anderer Rechner: Bilder nur im Ordner
    const file = await readDataFile(root);
    const ref = file!.state.expenses.find((e) => e.id === "beleg0")!.receipt!;
    expect(await receiptDataUrl(ref)).toBe("");                    // ohne Ordnerquelle nicht verfügbar
    expect(await readReceiptImage(root, ref.fileId!, ref.type)).toBe(image);
    expect(await cacheFolderReceipts(root, file!.state)).toBe(3);
    expect(await receiptDataUrl(ref)).toBe(image);                 // jetzt in dieser Sitzung (und im Browser) vorhanden
    (root.dirs.get(RECEIPT_DIR)!).files.set(ref.fileId!, new Blob([new Uint8Array([1, 2, 3])]));
    expect(await readReceiptImage(root, ref.fileId!, ref.type)).toBeNull();
    expect(await readReceiptImage(root, "../Daten/spesenkit.json", "image/jpeg")).toBeNull();
  });

  it("ZIP und PDF enthalten die Bilder auch, wenn der Bestand nur Verweise hat", async () => {
    const state = normalizeState(legacyState());
    const data = buildStatement(state, "2026-07");
    const zip = await JSZip.loadAsync(await (await zipFile(data, state, "RK-1")).blob.arrayBuffer());
    const archived = Object.keys(zip.files).filter((name) => name.startsWith("Belege/") && name.endsWith("beleg0_r0.jpg"));
    expect(archived).toHaveLength(1);
    expect(Buffer.from(await zip.file(archived[0])!.async("uint8array")).equals(bytesOf(image))).toBe(true);
  });

  it("fehlt ein Bild überall: PDF/ZIP und JSON-Sicherung brechen mit klarer Meldung ab, statt unvollständig zu sein", async () => {
    const state = normalizeState(legacyState());
    forgetSessionReceiptImages();                                  // Bild weder hier noch im Browser noch im Ordner
    const data = buildStatement(state, "2026-07");
    await expect(zipFile(data, state, "RK-1")).rejects.toBeInstanceOf(MissingReceiptImageError);
    await expect(withReceiptImages(state, "2026-07")).rejects.toThrow(/r0\.jpg|Belegbilder/);
    await expect(withAllReceiptImages(state)).rejects.toThrow("es wurde keine unvollständige Datei erzeugt");
    const lenient = await withAllReceiptImages(state, { strict: false });   // nur für den Fingerabdruck-Übergang
    expect(lenient.expenses.find((e) => e.id === "beleg0")!.receipt!.dataUrl).toBe("");
  });

  it("Ordner: fehlt ein Bild hier und im Ordner, wird keine Datei mit Verweis darauf geschrieben", async () => {
    const root = new FakeDir(FOLDER_NAME);
    const state = normalizeState(legacyState());
    forgetSessionReceiptImages();
    await expect(writeDataFile(root, state, 0)).rejects.toMatchObject({ code: "write", message: expect.stringContaining("r0.jpg") });
    expect(root.file(DATA_DIR, DATA_FILE)).toBeUndefined();
    expect([...(root.dirs.get("Sicherungen")?.files.keys() || [])]).toEqual([]);
  });

  it("JSON-Sicherung bleibt für sich vollständig: alle Bilder eingebettet", async () => {
    const legacy = legacyState(), state = normalizeState(structuredClone(legacy));
    const backup = JSON.parse(JSON.stringify(await withAllReceiptImages(state)));
    expect(hasEmbeddedImages(backup)).toBe(true);
    expect(withoutFileIds(normalizeState(backup, { detach: false }))).toEqual(withoutFileIds(normalizeState(legacy, { detach: false })));
  });

  it("Größe: 30 Belege (je dreimal im Bestand) – Datendatei bleibt klein", async () => {
    const root = new FakeDir(FOLDER_NAME);
    const state = normalizeState(legacyState(30));
    await writeDataFile(root, state, 0);
    expect((root.file(DATA_DIR, DATA_FILE) as string).length).toBeLessThan(250_000);
    expect(root.dirs.get(RECEIPT_DIR)!.files.size).toBe(30);
  });
});

describe("Übergang von SpesenKit 1.8 (Format 1, Bilder eingebettet)", () => {
  /** Ordner so, wie 1.8 ihn geschrieben hat. */
  async function oldFolder(state: AppState, revision = 3) {
    const root = new FakeDir(FOLDER_NAME);
    const dir = await root.getDirectoryHandle(DATA_DIR, { create: true }) as FakeDir;
    dir.files.set(DATA_FILE, JSON.stringify({ format: "spesenkit-daten", formatVersion: 1, revision, savedAt: "2026-10-20T10:00:00Z", state }));
    return root;
  }

  it("liest eine Format-1-Datei; gleicher Inhalt ergibt denselben Fingerabdruck wie der Browserstand", async () => {
    const legacy = legacyState();
    const file = await readDataFile(await oldFolder(legacy));
    expect(file!.content.formatVersion).toBe(1);
    expect(file!.hash).toBe(await stateHash(normalizeState(structuredClone(legacy))));
    expect(await legacyFileHash(file!)).toBe(oldStateHash(legacy));
  });

  it("unveränderter Browser, Datei auf anderem Rechner geändert: übernehmen statt Scheinkonflikt", async () => {
    const legacy = legacyState();
    const local = normalizeState(structuredClone(legacy));
    const link = { revision: 3, hash: oldStateHash(legacy) };      // so hat 1.8 die Verknüpfung gespeichert
    const other = structuredClone(local); other.settings.profileName = "Anderer Rechner";
    const root = new FakeDir(FOLDER_NAME);
    await writeDataFile(root, other, 0);                           // vom anderen Rechner schon mit 1.9 geschrieben
    const file = (await readDataFile(root))!; file.content.revision = 4;
    const translated = await translateLegacyLink(link, local, file);
    expect(translated).toMatchObject({ hash: await stateHash(local), hashFormat: 2 });
    expect(decideReconcile(translated, await stateHash(local), false, file).kind).toBe("load-file");
    expect(decideReconcile(link, await stateHash(local), false, file).kind).toBe("conflict");   // ohne Übersetzung
  });

  it("Browser geändert, Format-1-Datei unverändert: Browserstand schreiben statt Scheinkonflikt", async () => {
    const legacy = legacyState();
    const file = (await readDataFile(await oldFolder(legacy)))!;
    const local = normalizeState(structuredClone(legacy)); local.settings.profileName = "Nur im Browser geändert";
    const translated = await translateLegacyLink({ revision: 3, hash: oldStateHash(legacy) }, local, file);
    expect(translated.hash).toBe(file.hash);
    expect(decideReconcile(translated, await stateHash(local), false, file)).toMatchObject({ kind: "write-local", expectedRevision: 3 });
  });

  it("beide geändert: bleibt ein echter Konflikt; neue Verknüpfungen werden nicht übersetzt", async () => {
    const legacy = legacyState();
    const fileState = structuredClone(legacy); fileState.settings.profileName = "Ordner";
    const file = (await readDataFile(await oldFolder(fileState, 4)))!;
    const local = normalizeState(structuredClone(legacy)); local.settings.profileName = "Browser";
    const translated = await translateLegacyLink({ revision: 3, hash: oldStateHash(legacy) }, local, file);
    expect(decideReconcile(translated, await stateHash(local), false, file).kind).toBe("conflict");
    const fresh = { revision: 1, hash: "abc", hashFormat: 2 as const };
    expect(await translateLegacyLink(fresh, local, file)).toBe(fresh);
  });
});
