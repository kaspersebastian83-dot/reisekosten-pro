import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { openDB, type IDBPDatabase } from "idb";
import type { AppState, Receipt } from "./types";

/*
 * Belegbilder werden einmal gespeichert – unter einem Fingerabdruck ihres Inhalts (SHA-256 der Bytes + Endung),
 * z. B. „3f2a…c9.jpg“. Der Datenbestand (Browser, spesenkit.json, Sicherungen) enthält nur noch den Verweis:
 * Receipt.fileId gesetzt, Receipt.dataUrl leer. Vorher stand dasselbe Bild bis zu dreimal als Text im Bestand
 * (Kosten, Beleg-Eingang, eingefrorene Abrechnungsversion) – bei einigen Monaten rund 90 MB je Speichern.
 *
 *   Browser:          IndexedDB „spesenkit-belege“, Store „belege“, Schlüssel = fileId, Wert { dataUrl, savedAt }
 *   SpesenKit-Ordner: SpesenKit/Belege/<fileId> (echte Bild-/PDF-Datei; wird nie automatisch gelöscht)
 *
 * Ältere Stände mit eingebetteten Bildern bleiben lesbar: normalizeState() löst die Bilder beim Laden heraus
 * (detachReceipts). Bilder, die kein base64-Daten-URL sind, bleiben unverändert eingebettet.
 */

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg", "image/jpg": "jpg", "image/pjpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
  "image/bmp": "bmp", "image/heic": "heic", "image/heif": "heif", "image/tiff": "tif", "application/pdf": "pdf",
};
const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", bmp: "image/bmp", heic: "image/heic", heif: "image/heif", tif: "image/tiff", pdf: "application/pdf",
};
/** Gültiger Verweis: 64 Hex-Zeichen + Endung. Schützt auch Dateinamen im Ordner vor Pfadangaben. */
export const FILE_ID = /^[0-9a-f]{64}\.[a-z0-9]{1,5}$/;

const parseDataUrl = (dataUrl: string) => {
  const match = /^data:([^;,]*)((?:;[^;,=]+=[^;,]*)*);base64,/i.exec(dataUrl);
  return match ? { mime: match[1].toLowerCase(), base64: dataUrl.slice(match[0].length) } : null;
};
function base64Bytes(base64: string) {
  const binary = atob(base64.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
function bytesBase64(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Fingerabdruck eines base64-Daten-URL; null, wenn es keiner ist (dann bleibt das Bild eingebettet). */
export function receiptFileId(dataUrl: string): string | null {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return null;
  let bytes: Uint8Array;
  try { bytes = base64Bytes(parsed.base64); } catch { return null; }
  if (!bytes.length) return null;
  return `${bytesToHex(sha256(bytes))}.${EXT_BY_MIME[parsed.mime] || "bin"}`;
}
/** Bytes und Dateityp für die Datei im Ordner. */
export function dataUrlFile(dataUrl: string) {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return null;
  try { return { bytes: base64Bytes(parsed.base64), mime: parsed.mime || "application/octet-stream" }; } catch { return null; }
}
/** Datei aus dem Ordner wieder als Daten-URL – nur, wenn der Inhalt zum Fingerabdruck passt. */
export function fileDataUrl(fileId: string, bytes: Uint8Array, type?: string) {
  if (!FILE_ID.test(fileId) || bytesToHex(sha256(bytes)) !== fileId.slice(0, 64)) return null;
  const ext = fileId.slice(65);
  return `data:${MIME_BY_EXT[ext] || type || "application/octet-stream"};base64,${bytesBase64(bytes)}`;
}

/** Bilder dieser Sitzung (neu erfasst, aus älteren Ständen herausgelöst oder schon einmal geladen). */
const memory = new Map<string, string>();
/** Nur für Tests: einen anderen Rechner ohne die Bilder dieser Sitzung nachbilden. */
export const forgetSessionReceiptImages = () => memory.clear();
export const rememberReceiptImage = (fileId: string, dataUrl: string) => { if (FILE_ID.test(fileId) && dataUrl) memory.set(fileId, dataUrl); };

function detachReceipt(receipt: Receipt): Receipt {
  if (!receipt?.dataUrl) return receipt;
  const fileId = receiptFileId(receipt.dataUrl);
  if (!fileId) return receipt;
  if (!memory.has(fileId)) memory.set(fileId, receipt.dataUrl);
  return { ...receipt, dataUrl: "", fileId };
}

/**
 * Löst eingebettete Bilder heraus (Kosten, Beleg-Eingang, eingefrorene Abrechnungsversionen). Ohne eingebettete
 * Bilder kommt dieselbe Referenz zurück. Synchron, damit normalizeState und jede Zustandsänderung es nutzen können.
 */
export function detachReceipts(state: AppState): AppState {
  let changed = false;
  const fix = <T extends { receipt?: Receipt }>(item: T): T => {
    if (!item.receipt?.dataUrl) return item;
    const receipt = detachReceipt(item.receipt);
    if (receipt === item.receipt) return item;
    changed = true;
    return { ...item, receipt };
  };
  const expenses = state.expenses.map(fix);
  const receiptInbox = state.receiptInbox.map(fix);
  const statements = state.statements.map((snapshot) => {
    const original = snapshot.expensesSnapshot;
    if (!original?.some((expense) => expense.receipt?.dataUrl)) return snapshot;
    const expensesSnapshot = original.map(fix);
    return expensesSnapshot.some((expense, index) => expense !== original[index]) ? { ...snapshot, expensesSnapshot } : snapshot;
  });
  return changed ? { ...state, expenses, receiptInbox, statements } : state;
}

/** Liegen noch eingebettete (base64-)Bilder im Bestand? Dann einmal im neuen Format speichern. */
export function hasEmbeddedImages(state: Partial<AppState>) {
  const embedded = (receipt?: Receipt) => !!receipt?.dataUrl && /^data:[^,]*;base64,/i.test(receipt.dataUrl.slice(0, 200));
  return (state.expenses || []).some((expense) => embedded(expense.receipt)) || (state.receiptInbox || []).some((item) => embedded(item.receipt))
    || (state.statements || []).some((snapshot) => (snapshot.expensesSnapshot || []).some((expense) => embedded(expense.receipt)));
}

/** Alle Bildverweise des Bestands (ohne Änderungsprotokoll – dort werden keine Bilder gebraucht). */
export function referencedFileIds(state: AppState) {
  const ids = new Set<string>();
  const add = (receipt?: Receipt) => { if (receipt?.fileId && !receipt.dataUrl && FILE_ID.test(receipt.fileId)) ids.add(receipt.fileId); };
  for (const expense of state.expenses) add(expense.receipt);
  for (const item of state.receiptInbox) add(item.receipt);
  for (const snapshot of state.statements) for (const expense of snapshot.expensesSnapshot || []) add(expense.receipt);
  return ids;
}

/** Vergleichswert eines Belegs ohne den Bildinhalt: gleich, wenn Datei und Angaben gleich sind. */
export function receiptIdentity(receipt?: Receipt) {
  if (!receipt) return undefined;
  const { dataUrl, ...rest } = receipt;
  return { ...rest, fileId: receipt.fileId && !dataUrl ? receipt.fileId : (dataUrl ? receiptFileId(dataUrl) ?? dataUrl : receipt.fileId) };
}

/* ---------- Browser-Speicher für Bilder ---------- */
const IMAGE_DB = "spesenkit-belege", IMAGE_STORE = "belege";
interface StoredImage { dataUrl: string; savedAt: string }
let connection: Promise<IDBPDatabase | null> | undefined;
function imageDb(): Promise<IDBPDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (!connection) {
    connection = openDB(IMAGE_DB, 1, {
      upgrade(database) { if (!database.objectStoreNames.contains(IMAGE_STORE)) database.createObjectStore(IMAGE_STORE); },
      blocking() { const current = connection; connection = undefined; void current?.then((database) => database?.close()); },
      terminated() { connection = undefined; },
    }).catch((error: unknown) => { connection = undefined; throw error; });
  }
  return connection;
}
/** Im Browser gespeicherte Bilder (wird beim ersten Zugriff gelesen). */
let persisted: Promise<Set<string>> | undefined;
const persistedIds = (database: IDBPDatabase) => {
  persisted ??= database.getAllKeys(IMAGE_STORE).then((keys) => new Set(keys.map(String)), (error: unknown) => { persisted = undefined; throw error; });
  return persisted;
};

/**
 * Vor dem Speichern des Bestands: jedes verwiesene Bild, das noch nicht im Browser liegt, dort ablegen.
 * Erst danach wird der Bestand geschrieben – ein gespeicherter Verweis zeigt nie ins Leere.
 */
export async function persistReceiptImages(state: AppState) {
  const database = await imageDb();
  if (!database) return;
  const known = await persistedIds(database);
  const missing = [...referencedFileIds(state)].filter((id) => !known.has(id));
  if (!missing.length) return;
  const transaction = database.transaction(IMAGE_STORE, "readwrite");
  const savedAt = new Date().toISOString(), written: string[] = [];
  for (const id of missing) {
    const dataUrl = memory.get(id);
    if (dataUrl) { void transaction.store.put({ dataUrl, savedAt } satisfies StoredImage, id); written.push(id); }
  }
  await transaction.done;
  for (const id of written) known.add(id);
}

/** Bild nur aus Sitzung und Browser (ohne Ordner). */
async function localImage(fileId: string) {
  const hit = memory.get(fileId);
  if (hit) return hit;
  const database = await imageDb().catch(() => null);
  const stored = database ? await database.get(IMAGE_STORE, fileId).catch(() => undefined) as StoredImage | undefined : undefined;
  if (stored?.dataUrl) { memory.set(fileId, stored.dataUrl); return stored.dataUrl; }
  return "";
}
export const localReceiptImage = localImage;

/** Liefert ein Bild aus dem SpesenKit-Ordner (wird von der Ordneranbindung gesetzt, solange er erreichbar ist). */
type FolderSource = (fileId: string, type?: string) => Promise<string | null>;
let folderSource: FolderSource | null = null;
export function setReceiptFolderSource(source: FolderSource | null) { folderSource = source; }

/** Daten-URL eines Belegs: eingebettet, aus dieser Sitzung, aus dem Browser oder aus dem SpesenKit-Ordner; sonst "". */
export async function receiptDataUrl(receipt?: Receipt): Promise<string> {
  if (!receipt) return "";
  if (receipt.dataUrl) return receipt.dataUrl;
  if (!receipt.fileId || !FILE_ID.test(receipt.fileId)) return "";
  const local = await localImage(receipt.fileId);
  if (local) return local;
  const fromFolder = folderSource ? await folderSource(receipt.fileId, receipt.type).catch(() => null) : null;
  if (!fromFolder) return "";
  memory.set(receipt.fileId, fromFolder);
  return fromFolder;
}

/** Ein verwiesenes Belegbild ist weder hier noch im Browser noch im (erreichbaren) SpesenKit-Ordner vorhanden. */
export class MissingReceiptImageError extends Error {
  constructor(public names: string[]) {
    super(`${names.length === 1 ? `Das Belegbild „${names[0]}“ ist` : `${names.length} Belegbilder (z. B. „${names[0]}“) sind`} auf diesem Gerät nicht verfügbar. Bitte den SpesenKit-Ordner verbinden bzw. den Zugriff bestätigen und erneut versuchen – es wurde keine unvollständige Datei erzeugt.`);
    this.name = "MissingReceiptImageError";
  }
}
/** strict: fehlende Bilder sammeln und am Ende melden, statt eine unvollständige Datei zu erzeugen. */
type Hydration = { strict: boolean; missing: string[] };
const withImage = (run: Hydration) => async <T extends { receipt?: Receipt }>(item: T): Promise<T> => {
  if (!item.receipt || item.receipt.dataUrl || !item.receipt.fileId) return item;
  const dataUrl = await receiptDataUrl(item.receipt);
  if (!dataUrl && run.strict) run.missing.push(item.receipt.name || item.receipt.fileId);
  return { ...item, receipt: { ...item.receipt, dataUrl } };
};
const finish = <T>(run: Hydration, value: T) => {
  if (run.missing.length) throw new MissingReceiptImageError([...new Set(run.missing)]);
  return value;
};

/** Für PDF/ZIP: Bilder der Kosten eines Monats (oder aller Kosten) einsetzen. Fehlt eines, Fehler statt unvollständiger Datei. */
export async function withReceiptImages(state: AppState, month?: string, options: { strict?: boolean } = {}): Promise<AppState> {
  const run: Hydration = { strict: options.strict ?? true, missing: [] };
  const expenses = await Promise.all(state.expenses.map((expense) => !month || expense.date.startsWith(month) ? withImage(run)(expense) : expense));
  return finish(run, { ...state, expenses });
}
/** Für die JSON-Sicherung: alle Bilder eingebettet, damit die Datei für sich allein vollständig ist. */
export async function withAllReceiptImages(state: AppState, options: { strict?: boolean } = {}): Promise<AppState> {
  const run: Hydration = { strict: options.strict ?? true, missing: [] };
  const fill = withImage(run);
  const [expenses, receiptInbox, statements] = await Promise.all([
    Promise.all(state.expenses.map(fill)),
    Promise.all(state.receiptInbox.map(fill)),
    Promise.all(state.statements.map(async (snapshot) => snapshot.expensesSnapshot ? { ...snapshot, expensesSnapshot: await Promise.all(snapshot.expensesSnapshot.map(fill)) } : snapshot)),
  ]);
  return finish(run, { ...state, expenses, receiptInbox, statements });
}

/**
 * Bilder im Browser entfernen, auf die der gespeicherte Bestand nicht mehr verweist (gelöschte Belege).
 * Nur ältere als graceDays: ein anderer Tab kann gerade einen neuen Beleg gespeichert haben.
 */
export async function pruneReceiptImages(current: AppState, graceDays = 7, now = new Date()) {
  const database = await imageDb();
  if (!database) return 0;
  const keep = referencedFileIds(current), limit = now.getTime() - graceDays * 86_400_000;
  const transaction = database.transaction(IMAGE_STORE, "readwrite");
  let removed = 0;
  for (let cursor = await transaction.store.openCursor(); cursor; cursor = await cursor.continue()) {
    const value = cursor.value as StoredImage, id = String(cursor.key);
    if (!keep.has(id) && Date.parse(value?.savedAt || "") < limit) { await cursor.delete(); removed++; persisted?.then((set) => set.delete(id)); }
  }
  await transaction.done;
  return removed;
}
