import { COPY_DIR, FolderError, listFiles, readFileText, removeFile, writeSafetyCopy, type DirHandleLike } from "./folder-store";
import { isClosedStatement } from "./statement-comparison";
import { normalizeState } from "./storage";
import type { AppState } from "./types";

/*
 * Sicherungsstände im SpesenKit-Ordner (SpesenKit/Sicherungen), alle im Format der JSON-Sicherung:
 *   spesenkit_auto_<Datum>_<Zeit>.json            Tagessicherung: Stand VOR der ersten Änderung des Tages
 *   spesenkit_abschluss_<Monat>_V<n>_<…>.json     nach jedem Monatsabschluss (wird nie automatisch gelöscht)
 *   spesenkit_manuell_<…>.json                    „Jetzt sichern“
 *   spesenkit_vor_wiederherstellung_<…>.json      Stand vor einer Wiederherstellung
 *   spesenkit_browserstand_/ordnerstand_/ungueltig_  aus Konflikten bzw. unlesbarer Datei (3.3a)
 *   spesenkit_speicherkandidat_/vor_speichern_    je Speichervorgang; beim nächsten eigenen Speichern gelöscht, wenn die
 *                                                Datei noch genau diesen Stand hat, sonst nach 7 Tagen (copiesToPrune)
 * Automatisch gelöscht werden nur Tagessicherungen mit genau diesem Namensmuster und die Kopien je Speichervorgang.
 */
export type BackupKind = "auto" | "abschluss" | "manuell" | "vor_wiederherstellung" | "browserstand" | "ordnerstand" | "speicherkandidat" | "vor_speichern" | "ungueltig" | "sonstige";
export const backupKindLabels: Record<BackupKind, string> = {
  auto: "Tagessicherung", abschluss: "Monatsabschluss", manuell: "Manuell", vor_wiederherstellung: "Vor Wiederherstellung",
  browserstand: "Konflikt: Browserstand", ordnerstand: "Konflikt: Ordnerstand", ungueltig: "Unlesbare Datei", sonstige: "Sonstige",
  speicherkandidat: "Speicherkandidat", vor_speichern: "Vor dem Speichern",
};
export interface BackupEntry { name: string; kind: BackupKind; detail: string; date: string; time: string; size: number; restorable: boolean }
export interface RetentionPolicy { daily: number; monthly: number }
export const defaultRetention: RetentionPolicy = { daily: 14, monthly: 12 };

// Bestehende Namen (ohne Suffix / mit Zähler) bleiben lesbar; neue Kopien tragen eine UUID.
const SUFFIX = "(?:_(?:\\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}))?";
const NAME = new RegExp(`^spesenkit_(.+?)_(\\d{4}-\\d{2}-\\d{2})_(\\d{2})(\\d{2})(\\d{2})${SUFFIX}\\.json$`);
const AUTO = new RegExp(`^spesenkit_auto_\\d{4}-\\d{2}-\\d{2}_\\d{6}${SUFFIX}\\.json$`);
const localDate = (now: Date) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

export function parseBackupName(name: string): Omit<BackupEntry, "size"> | null {
  const match = NAME.exec(name);
  if (!match) return null;
  const [, label, date, hh, mm, ss] = match;
  const known = (["auto", "manuell", "vor_wiederherstellung", "browserstand", "ordnerstand", "speicherkandidat", "vor_speichern", "ungueltig"] as const).find((kind) => label === kind);
  const kind: BackupKind = known || (label.startsWith("abschluss_") ? "abschluss" : "sonstige");
  if (kind === "auto" && !AUTO.test(name)) return null;
  const detail = kind === "abschluss" ? label.slice("abschluss_".length).replace("_", " ") : "";
  return { name, kind, detail, date, time: `${hh}:${mm}:${ss}`, restorable: kind !== "ungueltig" };
}

/** Alle erkannten Sicherungen, neueste zuerst. */
export async function listBackups(root: DirHandleLike): Promise<BackupEntry[]> {
  const files = await listFiles(root, [COPY_DIR]);
  return files.flatMap((file) => { const parsed = parseBackupName(file.name); return parsed && file.size > 0 ? [{ ...parsed, size: file.size }] : []; })
    .sort((a, b) => `${b.date} ${b.time} ${b.name}`.localeCompare(`${a.date} ${a.time} ${a.name}`));
}

export const autoBackupDue = (entries: BackupEntry[], now: Date) => !entries.some((entry) => entry.kind === "auto" && entry.date === localDate(now));

/**
 * Welche Tagessicherungen dürfen weg? Behalten: die neuesten `daily`, dazu je Monat die neueste der letzten
 * `monthly` Monate. Alles andere als Tagessicherungen wird nie zum Löschen vorgeschlagen.
 */
export function backupsToPrune(entries: BackupEntry[], now: Date, policy: RetentionPolicy = defaultRetention): string[] {
  const autos = entries.filter((entry) => entry.kind === "auto" && AUTO.test(entry.name))
    .sort((a, b) => `${b.date} ${b.time} ${b.name}`.localeCompare(`${a.date} ${a.time} ${a.name}`));
  const keep = new Set(autos.slice(0, policy.daily).map((entry) => entry.name));
  const oldest = new Date(now.getFullYear(), now.getMonth() - (policy.monthly - 1), 1);
  const oldestMonth = localDate(oldest).slice(0, 7);
  const seenMonths = new Set<string>();
  for (const entry of autos) {
    const month = entry.date.slice(0, 7);
    if (month >= oldestMonth && !seenMonths.has(month)) { seenMonths.add(month); keep.add(entry.name); }
  }
  return autos.filter((entry) => !keep.has(entry.name)).map((entry) => entry.name);
}

/** Kopien je Speichervorgang („speicherkandidat“, „vor_speichern“), die nach dem Speichern liegen bleiben – etwa die
 *  letzten einer Sitzung oder aus einem Konflikt: nach `days` Tagen entbehrlich, denn Konflikte zeigt SpesenKit sofort,
 *  und ältere Stände decken die Tages- und Monatssicherungen ab. Andere Arten werden hier nie vorgeschlagen. */
export const COPY_RETENTION_DAYS = 7;
export function copiesToPrune(entries: BackupEntry[], now: Date, days = COPY_RETENTION_DAYS): string[] {
  const limit = localDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - days));
  return entries.filter((entry) => (entry.kind === "speicherkandidat" || entry.kind === "vor_speichern") && entry.date < limit).map((entry) => entry.name);
}

/**
 * Merker des Aufrufers: Für welchen Ordner (stabiler Schlüssel, z. B. Anzeigename der Verknüpfung) ist die
 * Tagessicherung heute schon vorhanden? Erspart das Auflisten bei jedem Speichern. Der Ordner-Handle selbst taugt
 * nicht als Schlüssel: Aus IndexedDB kommt bei jedem Lesen ein neues Objekt.
 */
export interface DailyBackupMemo { key?: string; day?: string }

/** Tagessicherung des bisherigen Stands (falls heute noch keine), danach aufräumen. Ergebnis für die Anzeige. */
export async function dailyBackup(root: DirHandleLike, previous: AppState, now = new Date(), policy = defaultRetention, memo?: DailyBackupMemo & { forKey: string }) {
  const today = localDate(now), done = () => { if (memo) { memo.key = memo.forKey; memo.day = today; } };
  if (memo && memo.key === memo.forKey && memo.day === today) return { written: null as string | null, pruned: [] as string[] };
  const entries = await listBackups(root);
  if (!autoBackupDue(entries, now)) { done(); return { written: null as string | null, pruned: [] as string[] }; }
  const written = await writeSafetyCopy(root, "auto", previous, now);
  done();
  const after = await listBackups(root);
  const pruned = [...backupsToPrune(after, now, policy), ...copiesToPrune(after, now)];
  for (const name of pruned) await removeFile(root, [COPY_DIR], name);
  return { written, pruned };
}

/** Sicherung nach einem Monatsabschluss, z. B. spesenkit_abschluss_2026-09_V01_<Zeit>.json */
export function closingBackup(root: DirHandleLike, state: AppState, snapshotId: string, now = new Date()) {
  const snapshot = state.statements.find((item) => item.id === snapshotId);
  if (!snapshot) throw new Error("Abrechnungsversion nicht gefunden.");
  return writeSafetyCopy(root, `abschluss_${snapshot.month}_V${String(snapshot.version).padStart(2, "0")}`, state, now);
}

/** Liest und prüft eine Sicherung (dieselbe Prüfung wie „JSON auswählen“). */
export async function readBackup(root: DirHandleLike, name: string): Promise<AppState> {
  const entry = parseBackupName(name);
  if (!entry || !entry.restorable) throw new FolderError("invalid", "Diese Datei ist keine wiederherstellbare Sicherung.");
  const text = await readFileText(root, [COPY_DIR], name);
  if (!text?.trim()) throw new FolderError("invalid", `„${name}“ ist leer oder fehlt.`);
  try { return normalizeState(JSON.parse(text)); }
  catch { throw new FolderError("invalid", `„${name}“ ist keine gültige SpesenKit-Sicherung.`); }
}

/** Abgeschlossene Abrechnungen, die nach einer Wiederherstellung nicht mehr im aktuellen Stand wären. */
export function droppedClosings(current: AppState, restored: AppState) {
  const kept = new Set(restored.statements.map((item) => item.id));
  return current.statements.filter((item) => isClosedStatement(item) && !kept.has(item.id))
    .sort((a, b) => a.month.localeCompare(b.month) || a.version - b.version)
    .map((item) => `${item.month} V${String(item.version).padStart(2, "0")}`);
}
