import { emptyState } from "./config";
import { stableValue } from "./statement-comparison";
import { normalizeState } from "./storage";
import { FILE_ID, dataUrlFile, fileDataUrl, localReceiptImage, persistReceiptImages, referencedFileIds, rememberReceiptImage, withAllReceiptImages } from "./receipt-images";
import type { AppState, Receipt } from "./types";

/*
 * Persönlicher SpesenKit-Ordner (z. B. im Mitarbeiterordner auf dem Terminalserver).
 *
 *   <gewählter Ordner>/SpesenKit/Daten/spesenkit.json         aktueller, maßgeblicher Datenbestand
 *   <gewählter Ordner>/SpesenKit/Daten/spesenkit.vorher.json  Stand vor dem letzten Schreiben
 *   <gewählter Ordner>/SpesenKit/Sicherungen/*.json           Kopien bei Konflikten (Format der JSON-Sicherung)
 *   <gewählter Ordner>/SpesenKit/Belege/<Fingerabdruck>.jpg   Belegbilder, je Inhalt einmal (ab Format 2, nie automatisch gelöscht)
 *
 * Ab Format 2 enthalten Datendatei und Sicherungen nur Verweise auf die Belegbilder (lib/receipt-images.ts). Die Bilder
 * werden vor jeder Datei geschrieben, die auf sie verweist. Ältere SpesenKit-Versionen lehnen Format 2 ab
 * („bitte SpesenKit aktualisieren“) und überschreiben die Datei nicht.
 *
 * Die IndexedDB „reisekosten-pro“ bleibt unverändert (Name, Version, Store, Schlüssel) und dient als
 * Arbeitsspeicher. Vor dem Ersetzen werden Speicherkandidat und gelesener Ausgangsstand unter eindeutigen
 * Namen in Sicherungen geschrieben und zurückgelesen. Diese Kopien bleiben auch bei konkurrierenden
 * Terminalservern erhalten. Versionsvergleiche erkennen Konflikte, sind aber keine globale Dateisperre.
 */
export const FOLDER_NAME = "SpesenKit";
export const DATA_DIR = "Daten";
export const DATA_FILE = "spesenkit.json";
export const PREVIOUS_FILE = "spesenkit.vorher.json";
export const COPY_DIR = "Sicherungen";
export const FILING_DIR = "Spesen";
export const RECEIPT_DIR = "Belege";
export const FILE_FORMAT = "spesenkit-daten";
export const FILE_FORMAT_VERSION = 2;
/** Lesbar: Format 1 (Bilder eingebettet) und Format 2 (Bilder unter Belege/). */
const READABLE_FORMATS = [1, 2];

type Permission = "granted" | "denied" | "prompt";
export interface WritableLike { write(data: string | Blob): Promise<void>; close(): Promise<void>; abort?(): Promise<void> }
export interface FileHandleLike { kind?: "file"; name?: string; getFile(): Promise<{ text(): Promise<string>; size?: number; arrayBuffer?(): Promise<ArrayBuffer> }>; createWritable(): Promise<WritableLike> }
export interface DirHandleLike {
  kind?: "directory";
  name: string;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirHandleLike>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandleLike>;
  removeEntry?(name: string): Promise<void>;
  values?(): AsyncIterable<{ kind: "file" | "directory"; name: string }>;
  queryPermission?(descriptor: { mode: "readwrite" }): Promise<Permission>;
  requestPermission?(descriptor: { mode: "readwrite" }): Promise<Permission>;
}

export interface FolderFileContent {
  format: typeof FILE_FORMAT;
  formatVersion: number;
  revision: number;
  savedAt: string;
  app?: { version: string; commit: string };
  state: AppState;
}
export interface FolderFile { content: FolderFileContent; state: AppState; hash: string; text: string }
/** Pro Browserprofil gespeichert (gemeinsame Datenbank „mosaik-suite“): welcher Ordner, welcher Dateistand zuletzt abgeglichen. */
export interface FolderLink { handle: DirHandleLike; revision: number; hash: string; /** 2: Fingerabdruck mit Bildverweisen (ab SpesenKit 1.9). Fehlt: noch mit eingebetteten Bildern berechnet. */ hashFormat?: 2; savedAt?: string; /** Anzeige, z. B. „Max Mustermann\SpesenKit“. */ label?: string; /** Formate für die automatische Ablage nach dem Abschluss. */ filing?: Partial<Record<"pdf" | "xlsx" | "zip", boolean>> }
export interface WriteResult { revision: number; hash: string; savedAt: string; hashFormat: 2 }

export type FolderErrorCode = "invalid" | "conflict" | "permission" | "read" | "write" | "verify";
export class FolderError extends Error {
  constructor(public code: FolderErrorCode, message: string) { super(message); this.name = "FolderError"; }
}

const errorName = (error: unknown) => (error && typeof error === "object" && "name" in error ? String((error as { name: unknown }).name) : "");
const accessError = (error: unknown, what: string) => errorName(error) === "NotAllowedError" || errorName(error) === "SecurityError"
  ? new FolderError("permission", `Kein Zugriff auf ${what}. Bitte den Ordnerzugriff bestätigen.`)
  : new FolderError("read", `${what} konnte nicht gelesen werden.`);

async function subDir(dir: DirHandleLike, name: string, create: boolean) {
  try { return await dir.getDirectoryHandle(name, { create }); }
  catch (error) { if (!create && errorName(error) === "NotFoundError") return null; throw accessError(error, `den Ordner „${name}“`); }
}
async function fileText(dir: DirHandleLike, name: string) {
  let handle: FileHandleLike;
  try { handle = await dir.getFileHandle(name); }
  catch (error) { if (errorName(error) === "NotFoundError") return null; throw accessError(error, `„${name}“`); }
  try { return await (await handle.getFile()).text(); } catch (error) { throw accessError(error, `„${name}“`); }
}
async function writeText(dir: DirHandleLike, name: string, text: string | Blob) {
  let writable: WritableLike | undefined;
  // getFileHandle({create}) legt die Datei sofort (leer) an. Scheitert das Schreiben, darf keine leere Datei zurückbleiben.
  const existed = await dir.getFileHandle(name).then(() => true, (error: unknown) => {
    if (errorName(error) === "NotFoundError") return false;
    throw accessError(error, `„${name}“`);
  });
  try {
    writable = await (await dir.getFileHandle(name, { create: true })).createWritable();
    await writable.write(text);
    await writable.close();
  } catch (error) {
    // createWritable schreibt in eine Zwischendatei; ohne close() bleibt die Zieldatei unverändert.
    try { await writable?.abort?.(); } catch { /* bereits abgebrochen */ }
    if (!existed) { try { await dir.removeEntry?.(name); } catch { /* bleibt als leere Datei; wird beim Ablegen als fehlend behandelt */ } }
    if (errorName(error) === "NotAllowedError" || errorName(error) === "SecurityError") throw new FolderError("permission", `Kein Schreibzugriff auf „${name}“. Bitte den Ordnerzugriff bestätigen.`);
    throw new FolderError("write", `„${name}“ konnte nicht geschrieben werden${errorName(error) === "QuotaExceededError" ? " (Speicherplatz voll)" : ""}.`);
  }
}

async function sha256(text: string) {
  const bytes = new TextEncoder().encode(text);
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
}
/** Inhaltlicher Fingerabdruck: gleiche Daten ergeben unabhängig von Schlüsselreihenfolge und JSON-Weg denselben Wert. */
export async function stateHash(state: AppState) {
  return sha256(stableValue(normalizeState(JSON.parse(JSON.stringify(state)) as AppState)));
}

/* Übergang von Format 1: Ältere SpesenKit-Versionen haben den Fingerabdruck über den Bestand MIT eingebetteten Bildern
 * berechnet. Damit der erste Abgleich nach dem Update keinen Scheinkonflikt meldet, wird der gespeicherte alte
 * Fingerabdruck einmal mit dem gleichen Inhalt in neuer Form verglichen und übersetzt. */
const withoutFileIds = (state: AppState): AppState => {
  const strip = <T extends { receipt?: Receipt }>(item: T): T => item.receipt?.fileId ? { ...item, receipt: (({ fileId: _drop, ...rest }) => rest)(item.receipt) } : item;
  return { ...state, expenses: state.expenses.map(strip), receiptInbox: state.receiptInbox.map(strip),
    statements: state.statements.map((snapshot) => snapshot.expensesSnapshot ? { ...snapshot, expensesSnapshot: snapshot.expensesSnapshot.map(strip) } : snapshot) };
};
/** Fingerabdruck wie bis SpesenKit 1.8 (Bilder eingebettet). Für den Bestand im Browser werden die Bilder eingesetzt. */
export async function legacyStateHash(state: AppState) {
  // Nicht streng: fehlt ein Bild, passt der alte Fingerabdruck ohnehin nicht – dann entscheidet der Abgleich wie bisher.
  const inline = withoutFileIds(await withAllReceiptImages(state, { strict: false }));
  return sha256(stableValue(normalizeState(JSON.parse(JSON.stringify(inline)) as AppState, { detach: false })));
}
/** Fingerabdruck einer Format-1-Datei wie bis SpesenKit 1.8 (aus dem unveränderten Dateiinhalt). */
export async function legacyFileHash(file: FolderFile) {
  if (file.content.formatVersion !== 1) return null;
  return sha256(stableValue(normalizeState(JSON.parse(JSON.stringify(file.content.state)) as AppState, { detach: false })));
}
/**
 * Übersetzt einen alten Fingerabdruck der Verknüpfung (vor 1.9) einmal in die neue Form – nur, wenn eindeutig ist,
 * welcher Inhalt gemeint war (unveränderter Browserstand oder unveränderte Format-1-Datei). Sonst bleibt er, und der
 * Abgleich behandelt den Fall wie bisher (im Zweifel als Konflikt, den der Benutzer entscheidet).
 */
export async function translateLegacyLink<L extends Pick<FolderLink, "hash" | "hashFormat">>(link: L, local: AppState, file: FolderFile | null): Promise<L> {
  if (!link.hash || link.hashFormat === 2) return link;
  let hash = link.hash;
  if (await legacyStateHash(local) === link.hash) hash = await stateHash(local);
  else if (file && await legacyFileHash(file) === link.hash) hash = file.hash;
  return { ...link, hash, hashFormat: 2 };
}
export function isEmptyState(state: AppState) {
  return (["trips", "expenses", "receiptInbox", "merchantRules", "profiles", "statements", "changes"] as const).every((key) => !state[key]?.length)
    && stableValue(state.settings) === stableValue(emptyState.settings);
}

/** Wählt der Benutzer den Ordner „SpesenKit“ selbst, wird er direkt verwendet; sonst wird er darin angelegt. */
export async function resolveAppFolder(chosen: DirHandleLike) {
  if (chosen.name.normalize("NFC").toLowerCase() === FOLDER_NAME.toLowerCase()) return chosen;
  return (await subDir(chosen, FOLDER_NAME, true))!;
}

export async function readDataFile(root: DirHandleLike): Promise<FolderFile | null> {
  const dir = await subDir(root, DATA_DIR, false);
  if (!dir) return null;
  const text = await fileText(dir, DATA_FILE);
  if (text === null) return null;
  return parseDataFileText(text);
}

async function parseDataFileText(text: string): Promise<FolderFile> {
  const invalid = (reason: string) => new FolderError("invalid", `„${DATA_FILE}“ ist ${reason}. Die Datei wird nicht überschrieben.`);
  if (!text.trim()) throw invalid("leer");
  let parsed: Partial<FolderFileContent>;
  try { parsed = JSON.parse(text); } catch { throw invalid("keine lesbare JSON-Datei"); }
  if (!parsed || typeof parsed !== "object" || parsed.format !== FILE_FORMAT) throw invalid("keine SpesenKit-Datendatei");
  if (!READABLE_FORMATS.includes(parsed.formatVersion as number)) throw invalid(`in einem unbekannten Format (Version ${String(parsed.formatVersion)}) gespeichert – bitte SpesenKit aktualisieren`);
  if (!Number.isInteger(parsed.revision) || parsed.revision! < 1 || typeof parsed.savedAt !== "string") throw invalid("unvollständig (Revision oder Speicherzeit fehlt)");
  if (!parsed.state || typeof parsed.state !== "object") throw invalid("ohne Datenbestand gespeichert");
  let state: AppState;
  try { state = normalizeState(parsed.state as AppState); } catch { throw invalid("inhaltlich ungültig"); }
  return { content: parsed as FolderFileContent, state, hash: await stateHash(state), text };
}

export interface WriteOptions {
  replaceInvalid?: boolean;
  /** Fingerabdruck des erwarteten Dateistands; erkennt auch Änderungen ohne Revisionswechsel. */
  expectedHash?: string;
  /** Nach den dauerhaften Sicherungen, vor dem Ersetzen (z. B. Tagessicherung des bisherigen Stands). */
  beforeReplace?: (current: FolderFile) => Promise<void>;
  /**
   * Kopien des vorigen eigenen Speicherns. Sie werden nach dem bestätigten Schreiben gelöscht – aber nur, wenn die
   * ersetzte Datei genau diesen eigenen Stand enthielt (Fingerabdruck gleich). Hat jemand anderes dazwischen
   * gespeichert, bleiben sie als Wiederherstellungsmaterial erhalten.
   */
  staleCopies?: { hash: string; names: string[] };
  /** Namen der Kopien, die dieses Speichern angelegt hat (für staleCopies beim nächsten Mal). */
  onCopies?: (names: string[]) => void;
}

/**
 * Verlustschutz, keine verteilte Sperre: Jeder neue Schreibversuch und sein gelesener Vorgänger erhalten
 * zuerst geprüfte, nie wiederverwendete Kopien. Wiederholte Vergleiche verkleinern das Rennfenster;
 * selbst eine Änderung zwischen letztem Vergleich und close() bleibt bei aktualisierten Schreibern
 * als Speicherkandidat erhalten. Erfolg bestätigt nur den anschließend zurückgelesenen Dateistand.
 */
export async function writeDataFile(root: DirHandleLike, state: AppState, expectedRevision: number, app?: FolderFileContent["app"], now = new Date(), options: WriteOptions = {}): Promise<WriteResult> {
  // Vor dem ersten await einfrieren: spätere Eingaben dürfen Kandidat und Hauptdatei nicht auseinanderziehen.
  const snapshot = normalizeState(JSON.parse(JSON.stringify(state)) as AppState);
  const content: FolderFileContent = { format: FILE_FORMAT, formatVersion: FILE_FORMAT_VERSION, revision: expectedRevision + 1, savedAt: now.toISOString(), ...(app ? { app } : {}), state: snapshot };
  const text = JSON.stringify(content);
  // Schon ein veralteter Versuch bleibt wiederherstellbar; eine fehlgeschlagene Sicherung stoppt das Ersetzen.
  const copies = [copyName(await writeSafetyCopy(root, "speicherkandidat", snapshot, now))];
  let current: FolderFile | null;
  let invalidText: string | undefined;
  try { current = await readDataFile(root); }
  catch (error) {
    // Nur auf ausdrücklichen Wunsch: die unlesbare Datei bleibt als Kopie erhalten, dann wird neu begonnen.
    if (!(options.replaceInvalid && error instanceof FolderError && error.code === "invalid" && expectedRevision === 0)) throw error;
    const dir = (await subDir(root, DATA_DIR, false))!;
    invalidText = (await fileText(dir, DATA_FILE)) ?? "";
    // Zwischen dem ersten Lesefehler und dieser Aufnahme könnte ein anderer Server repariert haben.
    try { await parseDataFileText(invalidText); throw new FolderError("conflict", "Die zuvor unlesbare Datei wurde inzwischen ersetzt. Bitte die Datenstände erneut vergleichen."); }
    catch (failure) { if (!(failure instanceof FolderError && failure.code === "invalid")) throw failure; }
    await writeVerifiedCopy(root, "ungueltig", invalidText, now);
    current = null;
  }
  const currentRevision = current?.content.revision ?? 0;
  if (currentRevision !== expectedRevision || (current && options.expectedHash !== undefined && current.hash !== options.expectedHash)) {
    throw new FolderError("conflict", `Die Datei im SpesenKit-Ordner wurde inzwischen an anderer Stelle geändert (Stand ${currentRevision}, erwartet ${expectedRevision}). Es wurde nichts überschrieben.`);
  }
  if (current) copies.push(copyName(await writeSafetyCopy(root, "vor_speichern", current.state, now)));
  const dir = (await subDir(root, DATA_DIR, true))!;
  const originalText = current?.text ?? invalidText ?? null;
  const unchanged = async () => {
    if (await fileText(dir, DATA_FILE) !== originalText) {
      throw new FolderError("conflict", "Die Datei im SpesenKit-Ordner wurde während des Speicherns geändert oder gelöscht. Der eigene Versuch bleibt unter „Datensicherung → Sicherungen“ als Speicherkandidat erhalten. Bitte die Datenstände vergleichen.");
    }
  };
  if (current && options.beforeReplace) await options.beforeReplace(current);
  await unchanged();
  if (current) {
    await writeText(dir, PREVIOUS_FILE, current.text);
    if (await fileText(dir, PREVIOUS_FILE) !== current.text) throw new FolderError("verify", "Der vorherige Dateistand konnte nicht bestätigt werden. Die Hauptdatei wurde nicht ersetzt; die eindeutigen Sicherungen bleiben erhalten.");
  }
  await unchanged();
  await writeText(dir, DATA_FILE, text);
  const back = await fileText(dir, DATA_FILE);
  if (back !== text) {
    // Eine gültige fremde Fassung ist ein Konflikt, keine beschädigte Datei. Nichts zurückschreiben.
    try { if (await readDataFile(root)) throw new FolderError("conflict", "Nach dem Schreiben liegt ein anderer Stand im SpesenKit-Ordner. Der eigene Speicherkandidat bleibt in den Sicherungen erhalten. Bitte die Datenstände vergleichen."); }
    catch (error) { if (error instanceof FolderError && error.code !== "invalid") throw error; }
    throw new FolderError("verify", `„${DATA_FILE}“ wurde nicht vollständig gespeichert. Der Speicherkandidat bleibt in den Sicherungen erhalten. Bitte erneut versuchen.`);
  }
  options.onCopies?.(copies);
  // Bestätigt: Die ersetzte Datei war genau der eigene vorige Stand → dessen Kopien sind doppelt (best effort).
  if (current && options.staleCopies && current.hash === options.staleCopies.hash) {
    for (const name of options.staleCopies.names) await removeFile(root, [COPY_DIR], name).catch(() => undefined);
  }
  return { revision: content.revision, hash: await stateHash(snapshot), savedAt: content.savedAt, hashFormat: 2 };
}
const copyName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

export const stamp = (now: Date) => {
  const z = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${z(now.getMonth() + 1)}-${z(now.getDate())}_${z(now.getHours())}${z(now.getMinutes())}${z(now.getSeconds())}`;
};
/** Eindeutige Namen statt eines Zählers: getrennte Browserprofile teilen keine atomare Dateireservierung. */
async function writeVerifiedCopy(root: DirHandleLike, label: string, text: string, now: Date) {
  const dir = (await subDir(root, COPY_DIR, true))!;
  const name = `spesenkit_${label}_${stamp(now)}_${crypto.randomUUID()}.json`;
  // UUIDs vermeiden konkurrierende Wiederverwendung; bestehende Dateien auch bei einer Kollision nicht anfassen.
  if (await fileText(dir, name) !== null) throw new FolderError("write", "Der Name einer Sicherungskopie ist bereits belegt. Bitte erneut versuchen.");
  await writeText(dir, name, text);
  if (await fileText(dir, name) !== text) throw new FolderError("verify", `Die Sicherung „${name}“ konnte nicht vollständig bestätigt werden. Die Hauptdatei wurde nicht ersetzt.`);
  return `${FOLDER_NAME}/${COPY_DIR}/${name}`;
}
/** Geprüfte Kopie im bestehenden JSON-Sicherungsformat. Kandidaten und Vorgänger: siehe staleCopies und copiesToPrune. */
export async function writeSafetyCopy(root: DirHandleLike, label: string, state: AppState, now = new Date()) {
  const snapshot = normalizeState(JSON.parse(JSON.stringify(state)) as AppState);
  // Auch jede Sicherung verweist nur auf Bilder: diese zuerst ablegen (vorhandene werden übersprungen).
  await writeReceiptFiles(root, snapshot);
  return writeVerifiedCopy(root, label, JSON.stringify(snapshot, null, 2), now);
}

/**
 * Legt fehlende Belegbilder unter SpesenKit/Belege/<fileId> ab (Quelle: diese Sitzung oder der Browser).
 * Vorhandene Dateien werden nie überschrieben; der Dateiname ist der Fingerabdruck des Inhalts.
 * Ergebnis: Verweise, deren Bild weder im Ordner noch lokal vorhanden ist.
 */
export async function writeReceiptFiles(root: DirHandleLike, state: AppState) {
  const ids = [...referencedFileIds(state)];
  if (!ids.length) return [] as string[];
  const dir = (await subDir(root, RECEIPT_DIR, true))!;
  let present: Set<string> | null = null;
  if (dir.values) {
    present = new Set();
    try { for await (const entry of dir.values()) if (entry.kind === "file") present.add(entry.name); }
    catch (error) { throw accessError(error, `den Ordner „${RECEIPT_DIR}“`); }
  }
  const unavailable: string[] = [];
  for (const id of ids) {
    // Fehlt in der Liste → schreiben. Steht in der Liste → wie fileExists: eine leere Datei (abgebrochener Schreibvorgang,
    // getFileHandle({create}) legt sie sofort an) gilt als fehlend und wird neu geschrieben.
    if ((!present || present.has(id)) && await fileExists(dir, id)) continue;
    const file = dataUrlFile(await localReceiptImage(id));
    if (!file) { unavailable.push(id); continue; }
    await writeText(dir, id, new Blob([file.bytes as BlobPart], { type: file.mime }));
    const written = await (await dir.getFileHandle(id)).getFile();
    if (written.size !== undefined && written.size !== file.bytes.length) throw new FolderError("verify", `Das Belegbild „${id}“ wurde nicht vollständig gespeichert. Bitte erneut versuchen.`);
  }
  // Kein Verweis ins Leere: Fehlt ein Bild hier UND im Ordner, wird keine Datei geschrieben, die darauf verweist.
  if (unavailable.length) {
    const names = unavailable.map((id) => receiptName(state, id));
    throw new FolderError("write", `${names.length === 1 ? `Das Belegbild „${names[0]}“ fehlt` : `${names.length} Belegbilder (z. B. „${names[0]}“) fehlen`} in diesem Browser und im SpesenKit-Ordner. Es wurde nichts gespeichert, das darauf verweist. Bitte den Ordner verbinden, in dem die Belege liegen, und erneut speichern.`);
  }
  return unavailable;
}
const receiptName = (state: AppState, fileId: string) => [...state.expenses, ...state.receiptInbox, ...state.statements.flatMap((s) => s.expensesSnapshot || [])]
  .map((item) => item.receipt).find((receipt) => receipt?.fileId === fileId)?.name || fileId;

/**
 * Bilder, die nur im Ordner liegen (z. B. auf einem anderen Rechner erfasst), in den Browser übernehmen –
 * damit Belege auch ohne erreichbaren Ordner angezeigt und exportiert werden können. Ergebnis: Anzahl übernommen.
 */
export async function cacheFolderReceipts(root: DirHandleLike, state: AppState) {
  let copied = 0;
  for (const id of referencedFileIds(state)) {
    if (await localReceiptImage(id)) continue;
    const url = await readReceiptImage(root, id).catch(() => null);
    if (url) { rememberReceiptImage(id, url); copied++; }
  }
  if (copied) await persistReceiptImages(state);
  return copied;
}

/** Belegbild aus SpesenKit/Belege lesen; null, wenn es fehlt oder nicht zum Fingerabdruck passt. */
export async function readReceiptImage(root: DirHandleLike, fileId: string, type?: string) {
  if (!FILE_ID.test(fileId)) return null;
  const dir = await subDir(root, RECEIPT_DIR, false);
  if (!dir) return null;
  try {
    const file = await (await dir.getFileHandle(fileId)).getFile();
    const buffer = file.arrayBuffer ? await file.arrayBuffer() : null;
    return buffer ? fileDataUrl(fileId, new Uint8Array(buffer), type) : null;
  } catch (error) { if (errorName(error) === "NotFoundError") return null; throw accessError(error, `„${fileId}“`); }
}

export type Reconcile =
  | { kind: "in-sync"; file: FolderFile }
  | { kind: "write-local"; expectedRevision: number }
  | { kind: "load-file"; file: FolderFile }
  | { kind: "missing" }
  | { kind: "conflict"; file: FolderFile };

/**
 * Entscheidet beim Verbinden/Start, welcher Stand gilt. Automatisch nur, wenn eindeutig:
 * - Datei fehlt bei einem neuen Ordner: Browserstand anlegen.
 * - Inhalte gleich: nichts tun.
 * - Browser seit dem letzten Abgleich unverändert: Datei übernehmen (z. B. anderer Terminalserver).
 * - Datei seit dem letzten Abgleich unverändert: Browserstand schreiben (z. B. Ordner war nicht erreichbar).
 * - Neuer Ordner mit Daten, Browser leer: Datei übernehmen.
 * Alles andere ist ein Konflikt, den der Benutzer entscheidet.
 */
export function decideReconcile(link: Pick<FolderLink, "revision" | "hash">, localHash: string, localEmpty: boolean, file: FolderFile | null): Reconcile {
  if (!file) return link.revision > 0 ? { kind: "missing" } : { kind: "write-local", expectedRevision: 0 };
  if (file.hash === localHash) return { kind: "in-sync", file };
  const localUnchanged = !!link.hash && link.hash === localHash;
  const fileUnchanged = link.revision > 0 && file.content.revision === link.revision && file.hash === link.hash;
  // Ein letzter Vergleich kann keine globale Sperre ersetzen. Taucht später ein anderer Inhalt mit
  // derselben (oder älteren) Revision auf, darf die zuvor bestätigte eigene Fassung nicht still weichen.
  if (link.hash && file.hash !== link.hash && file.content.revision <= link.revision) return { kind: "conflict", file };
  if (localUnchanged) return { kind: "load-file", file };
  // Ein plötzlich leerer Browser darf eine Datei mit Daten nie automatisch leeren.
  if (localEmpty && !isEmptyState(file.state)) return link.revision === 0 ? { kind: "load-file", file } : { kind: "conflict", file };
  if (fileUnchanged) return { kind: "write-local", expectedRevision: file.content.revision };
  if (localEmpty && link.revision === 0) return { kind: "load-file", file };
  return { kind: "conflict", file };
}

export function stateSummary(state: AppState) {
  const months = [...new Set(state.statements.filter((s) => s.locked).map((s) => s.month))].sort();
  return {
    trips: state.trips.length,
    expenses: state.expenses.length,
    statements: state.statements.length,
    closedMonths: months.length,
    profile: state.settings.profileName || "ohne Namen",
    lastChange: [...state.changes.map((c) => c.changedAt), ...state.trips.map((t) => t.importedAt)].filter(Boolean).sort().at(-1),
  };
}

/** Unterordner anlegen (z. B. Spesen/2026/09). */
export async function ensureDir(root: DirHandleLike, parts: string[]) {
  let dir = root;
  for (const part of parts) dir = (await subDir(dir, part, true))!;
  return dir;
}
/** Vorhandene Unterordner öffnen, ohne anzulegen; null, wenn einer fehlt. */
export async function openDir(root: DirHandleLike, parts: string[]) {
  let dir: DirHandleLike | null = root;
  for (const part of parts) { dir = await subDir(dir, part, false); if (!dir) return null; }
  return dir;
}
export async function fileExists(dir: DirHandleLike, name: string) {
  // Eine leere Datei (abgebrochener Schreibvorgang) gilt als nicht vorhanden.
  try { const file = await (await dir.getFileHandle(name)).getFile(); return file.size === undefined ? (await file.text()).length > 0 : file.size > 0; }
  catch (error) { if (errorName(error) === "NotFoundError") return false; throw accessError(error, `„${name}“`); }
}
/** Legt eine Datei nur an, wenn es sie noch nicht gibt. Vorhandene Dateien werden nie überschrieben. */
export async function writeNewFile(dir: DirHandleLike, name: string, data: string | Blob | (() => Promise<string | Blob>)) {
  if (await fileExists(dir, name)) return "exists" as const;
  await writeText(dir, name, typeof data === "function" ? await data() : data);
  return "written" as const;
}

/** Dateien eines Unterordners mit Größe (nur lesen; leer, wenn der Ordner fehlt). */
export async function listFiles(root: DirHandleLike, parts: string[]) {
  const dir = await openDir(root, parts);
  if (!dir?.values) return [];
  const files: { name: string; size: number }[] = [];
  for await (const entry of dir.values()) {
    if (entry.kind !== "file") continue;
    try { const file = await (await dir.getFileHandle(entry.name)).getFile(); files.push({ name: entry.name, size: file.size ?? (await file.text()).length }); }
    catch (error) { throw accessError(error, `„${entry.name}“`); }
  }
  return files;
}
export async function readFileText(root: DirHandleLike, parts: string[], name: string) {
  const dir = await openDir(root, parts);
  return dir ? fileText(dir, name) : null;
}
export async function removeFile(root: DirHandleLike, parts: string[], name: string) {
  const dir = await openDir(root, parts);
  if (!dir?.removeEntry) throw new FolderError("write", "Löschen wird von diesem Ordner nicht unterstützt.");
  try { await dir.removeEntry(name); }
  catch (error) { if (errorName(error) !== "NotFoundError") throw new FolderError("write", `„${name}“ konnte nicht entfernt werden.`); }
}
