import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, FolderOpen, HardDrive, Printer, RefreshCw } from "lucide-react";
import {
  COPY_DIR, DATA_DIR, DATA_FILE, FOLDER_NAME, FolderError, decideReconcile, isEmptyState, readDataFile, resolveAppFolder,
  stateHash, stateSummary, writeDataFile, writeSafetyCopy, type FolderFile, type FolderLink,
} from "../lib/folder-store";
import { folderSupported, pickFolder, suiteLinks, withFolderLock } from "../lib/suite-link";
import { defaultFilingFormats, filedStatus, fileStatement, filingFormatLabels, type FilingFormat, type FilingFormats, type FilingReport } from "../lib/statement-filing";
import { printPdf } from "../lib/exports";
import { backupKindLabels, closingBackup, dailyBackup, droppedClosings, listBackups, readBackup, type BackupEntry } from "../lib/folder-backups";
import type { StatementSnapshot } from "../lib/types";
import { appRelease } from "../lib/release";
import type { AppState } from "../lib/types";

export type FolderStatus =
  | { kind: "checking"; name?: string }
  | { kind: "unsupported" }
  | { kind: "none" }
  | { kind: "permission"; name: string }
  | { kind: "ok"; name: string; revision: number; savedAt?: string; pending: boolean }
  | { kind: "error"; name: string; message: string }
  | { kind: "conflict"; name: string; file: FolderFile; local: AppState }
  | { kind: "missing"; name: string }
  | { kind: "invalid"; name: string; message: string };

const message = (error: unknown) => error instanceof Error ? error.message : "Unbekannter Fehler beim Zugriff auf den SpesenKit-Ordner.";
const time = (iso?: string) => iso ? new Date(iso).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) : "";

/**
 * Hält den SpesenKit-Ordner mit dem lokalen (IndexedDB-)Stand synchron. Geschrieben wird immer nur der bereits
 * lokal gespeicherte Stand, der Reihe nach und mit Revisionsprüfung. Ohne verbundenen Ordner ändert sich nichts
 * am bisherigen Verhalten.
 */
export function useFolderStorage({ ready, committed, waitForLocal, adoptState, notify }: {
  ready: boolean;
  /** Zuletzt erfolgreich lokal gespeicherter Stand. */
  committed: () => AppState | null;
  waitForLocal: () => Promise<void>;
  /** Übernimmt einen Stand aus dem Ordner in den lokalen Speicher (mit dessen Mehrtab-Prüfung). */
  adoptState: (next: AppState) => Promise<void>;
  notify: (text: string) => void;
}) {
  const [status, setStatusState] = useState<FolderStatus>({ kind: "checking" });
  const statusRef = useRef(status);
  const setStatus = useCallback((next: FolderStatus) => {
    if (next.kind === "ok" && !next.pending) unsynced.current = false;
    statusRef.current = next; setStatusState(next);
  }, []);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const wanted = useRef(false);
  const lastError = useRef<Error | null>(null);
  const [busy, setBusy] = useState(false);
  /** Zuletzt bekannter Ordner: für die Berechtigungsabfrage direkt im Klick (ohne vorherige Datenbankabfrage). */
  const knownHandle = useRef<FolderLink["handle"] | null>(null);
  const [filingFormats, setFilingFormatsState] = useState<FilingFormats>(defaultFilingFormats);
  /** Abgeschlossen, aber Dateien noch nicht abgelegt: bleibt sichtbar, bis es geklappt hat. */
  const [filingIssue, setFilingIssue] = useState<{ snapshotId: string; label: string; message: string } | null>(null);
  /** Zählt Ablagevorgänge, damit Anzeigen des Ablagestands danach neu prüfen. */
  const [filingRun, setFilingRun] = useState(0);
  /** Hinweis, wenn eine Sicherung nicht angelegt werden konnte (blockiert das Speichern nicht). */
  const [backupNote, setBackupNote] = useState("");
  const [backupRun, setBackupRun] = useState(0);
  /** Datendatei schreiben; beim ersten Speichern des Tages vorher den bisherigen Stand sichern (best effort). */
  /** Kopien des letzten eigenen Speicherns; beim nächsten bestätigten Speichern entbehrlich (siehe staleCopies). */
  const lastCopies = useRef<{ hash: string; names: string[] } | null>(null);
  /** Tagessicherung heute schon vorhanden? Schlüssel: Ordnername der Verknüpfung (der Handle ist jedes Mal ein neues Objekt). */
  const dailyMemo = useRef<{ key?: string; day?: string }>({});
  const writeFile = async (link: FolderLink, state: AppState, expected: number, options: { replaceInvalid?: boolean } = {}) => {
    let copies: string[] = [];
    const result = await writeDataFile(link.handle, state, expected, appRelease, new Date(), { expectedHash: link.hash || undefined, ...options,
      staleCopies: lastCopies.current || undefined, onCopies: (names) => { copies = names; },
      beforeReplace: async (current) => {
        try { const result = await dailyBackup(link.handle, current.state, new Date(), undefined, Object.assign(dailyMemo.current, { forKey: linkName(link) })); if (result.written) setBackupRun((n) => n + 1); setBackupNote(""); }
        catch (error) { setBackupNote(`Tagessicherung konnte nicht angelegt werden: ${message(error)}`); }
      } });
    lastCopies.current = { hash: result.hash, names: copies };
    return result;
  };
  /** Lokale Änderungen, die noch nicht im Ordner sind, weil er gerade nicht beschreibbar ist. */
  const unsynced = useRef(false);

  const linkName = (link?: FolderLink | null) => link?.label || link?.handle.name || FOLDER_NAME;
  const okStatus = (link: FolderLink, pending = false): FolderStatus => ({ kind: "ok", name: linkName(link), revision: link.revision, savedAt: link.savedAt, pending });

  const reconcile = useCallback(async (link: FolderLink) => {
    setBusy(true);
    setStatus({ kind: "checking", name: linkName(link) });
    try {
      await waitForLocal();
      await withFolderLock(async () => {
        const local = committed();
        if (!local) return;
        let file: FolderFile | null;
        try { file = await readDataFile(link.handle); }
        catch (error) {
          if (error instanceof FolderError && error.code === "invalid") { setStatus({ kind: "invalid", name: linkName(link), message: error.message }); return; }
          if (error instanceof FolderError && error.code === "permission") { setStatus({ kind: "permission", name: linkName(link) }); return; }
          throw error;
        }
        const decision = decideReconcile(link, await stateHash(local), isEmptyState(local), file);
        if (decision.kind === "in-sync") {
          const next = { ...link, revision: decision.file.content.revision, hash: decision.file.hash, savedAt: decision.file.content.savedAt };
          await suiteLinks.set(next); setStatus(okStatus(next));
        } else if (decision.kind === "write-local") {
          const result = await writeFile(link, local, decision.expectedRevision);
          const next = { ...link, ...result }; await suiteLinks.set(next); setStatus(okStatus(next));
        } else if (decision.kind === "load-file") {
          await adoptState(decision.file.state);
          const next = { ...link, revision: decision.file.content.revision, hash: decision.file.hash, savedAt: decision.file.content.savedAt };
          await suiteLinks.set(next); setStatus(okStatus(next));
          notify(`Datenstand aus dem SpesenKit-Ordner geladen (gespeichert ${time(decision.file.content.savedAt)}).`);
        } else if (decision.kind === "missing") {
          setStatus({ kind: "missing", name: linkName(link) });
        } else {
          setStatus({ kind: "conflict", name: linkName(link), file: decision.file, local });
        }
      });
      lastError.current = null;
    } catch (error) {
      lastError.current = error instanceof Error ? error : new Error(message(error));
      if (error instanceof FolderError && error.code === "conflict") {
        // Auch beim Abgleich selbst kann ein zweiter Server zwischen Lesen und Schreiben speichern.
        // Erneut lesen, aber nicht automatisch entscheiden oder mit alter Revision weiterschreiben.
        try {
          const latest = await readDataFile(link.handle);
          const local = committed();
          if (latest && local) { setStatus({ kind: "conflict", name: linkName(link), file: latest, local }); return; }
          if (!latest) { setStatus({ kind: "missing", name: linkName(link) }); return; }
        } catch (failure) {
          if (failure instanceof FolderError && failure.code === "invalid") { setStatus({ kind: "invalid", name: linkName(link), message: failure.message }); return; }
        }
      }
      setStatus({ kind: "error", name: linkName(link), message: message(error) });
    } finally { setBusy(false); }
  }, [committed, waitForLocal, adoptState, notify, setStatus]);

  const start = useCallback(async () => {
    if (!folderSupported()) { setStatus({ kind: "unsupported" }); return; }
    try { await navigator.storage?.persist?.(); } catch { /* nur eine Bitte an den Browser */ }
    let link: FolderLink | undefined;
    try { link = await suiteLinks.get(); }
    catch (error) { setStatus({ kind: "error", name: FOLDER_NAME, message: `Gemeinsamer App-Speicher nicht lesbar: ${message(error)}` }); return; }
    if (!link) { setStatus({ kind: "none" }); return; }
    knownHandle.current = link.handle;
    setFilingFormatsState({ ...defaultFilingFormats, ...link.filing });
    const permission = await link.handle.queryPermission?.({ mode: "readwrite" }).catch(() => "denied" as const) ?? "granted";
    if (permission !== "granted") { setStatus({ kind: "permission", name: linkName(link) }); return; }
    await reconcile(link);
  }, [reconcile, setStatus]);

  const started = useRef(false);
  useEffect(() => { if (ready && !started.current) { started.current = true; void start(); } }, [ready, start]);

  const writeNow = useCallback(async () => {
    if (!wanted.current) return;
    wanted.current = false;
    const state = committed();
    if (!state) return;
    try {
      await withFolderLock(async () => {
        const link = await suiteLinks.get();
        if (!link) { setStatus({ kind: "none" }); return; }
        const hash = await stateHash(state);
        if (hash === link.hash) { setStatus(okStatus(link, wanted.current)); return; }
        const result = await writeFile(link, state, link.revision);
        const next = { ...link, ...result };
        await suiteLinks.set(next);
        setStatus(okStatus(next, wanted.current));
      });
      lastError.current = null;
    } catch (error) {
      lastError.current = error instanceof Error ? error : new Error(message(error));
      const link = await suiteLinks.get().catch(() => undefined);
      // Erst den neuen Abgleich abwarten, damit wartende Aktionen (Abschluss) den echten Stand sehen.
      if (error instanceof FolderError && error.code === "conflict" && link) { await reconcile(link); return; }
      if (error instanceof FolderError && error.code === "permission") { setStatus({ kind: "permission", name: linkName(link) }); return; }
      if (error instanceof FolderError && error.code === "invalid") { setStatus({ kind: "invalid", name: linkName(link), message: error.message }); return; }
      setStatus({ kind: "error", name: linkName(link), message: message(error) });
    }
  }, [committed, reconcile, setStatus]);

  /** Nach jedem erfolgreichen lokalen Speichern: Ordnerdatei nachziehen (zusammengefasst, der Reihe nach). */
  const afterLocalSave = useCallback(() => {
    const kind = statusRef.current.kind;
    if (kind !== "ok" && kind !== "error") { if (kind !== "none" && kind !== "unsupported") unsynced.current = true; return; }
    wanted.current = true;
    if (statusRef.current.kind === "ok") setStatus({ ...statusRef.current, pending: true });
    queue.current = queue.current.then(writeNow);
  }, [writeNow, setStatus]);

  /** Wartet auf alle Schreibvorgänge. Ergebnis: Ordner verbunden und aktuell, nicht verbunden, oder Fehlertext. */
  const flush = useCallback(async (): Promise<{ linked: boolean; error?: string }> => {
    const kind = statusRef.current.kind;
    if (kind === "none" || kind === "unsupported") return { linked: false };
    if (kind === "ok" || kind === "error") { wanted.current = true; queue.current = queue.current.then(writeNow); }
    await queue.current;
    const now = statusRef.current;
    if (now.kind === "ok") return { linked: true };
    return { linked: true, error: now.kind === "error" ? now.message : blockingText(now) || "Der SpesenKit-Ordner ist nicht bereit." };
  }, [writeNow]);

  /** Vor wichtigen Aktionen (Abschluss, Korrektur): ist ein verbundener Ordner nicht beschreibbar, zuerst klären. */
  const blocking = useCallback(() => blockingText(statusRef.current), []);

  const link = useCallback(async () => {
    let chosen;
    try { chosen = await pickFolder(); }
    catch (error) {
      if ((error as { name?: string })?.name === "AbortError") return;
      notify(`Ordner konnte nicht gewählt werden: ${message(error)} (Browser-Richtlinie?)`); return;
    }
    try {
      const root = await resolveAppFolder(chosen);
      const next: FolderLink = { handle: root, revision: 0, hash: "", label: root === chosen ? root.name : `${chosen.name}\\${root.name}` };
      await suiteLinks.set(next);
      knownHandle.current = root;
      await reconcile(next);
    } catch (error) { setStatus({ kind: "error", name: chosen.name, message: message(error) }); }
  }, [notify, reconcile, setStatus]);

  const confirmAccess = useCallback(async () => {
    // Die Abfrage muss unmittelbar auf den Klick folgen, sonst zeigt der Browser sie nicht an.
    const handle = knownHandle.current;
    const permission = handle ? await handle.requestPermission?.({ mode: "readwrite" }).catch(() => "denied" as const) ?? "granted" : "denied";
    const current = await suiteLinks.get().catch(() => undefined);
    if (!current) { setStatus({ kind: "none" }); return; }
    if (permission !== "granted") { notify("Zugriff nicht erteilt. Die Daten werden weiter nur im Browser gespeichert."); return; }
    await reconcile(current);
  }, [notify, reconcile, setStatus]);

  const resolveConflict = useCallback(async (keep: "folder" | "browser") => {
    const current = statusRef.current;
    const link = await suiteLinks.get().catch(() => undefined);
    if (current.kind !== "conflict" || !link) return;
    setBusy(true);
    try {
      await waitForLocal();
      const outcome = await withFolderLock(async () => {
        const file = await readDataFile(link.handle);
        // Die Datei hat sich seit der Anzeige geändert: neu vergleichen statt auf veraltete Anzeige hin zu handeln.
        if (!file || file.hash !== current.file.hash || file.content.revision !== current.file.content.revision) return "changed" as const;
        const local = committed()!;
        if (keep === "folder") {
          const copy = await writeSafetyCopy(link.handle, "browserstand", local);
          await adoptState(file.state);
          const next = { ...link, revision: file.content.revision, hash: file.hash, savedAt: file.content.savedAt };
          await suiteLinks.set(next); setStatus(okStatus(next));
          return `Ordnerstand übernommen. Der bisherige Browserstand liegt als Kopie in ${copy}.`;
        }
        const copy = await writeSafetyCopy(link.handle, "ordnerstand", file.state);
        const result = await writeFile({ ...link, hash: file.hash }, local, file.content.revision);
        const next = { ...link, ...result }; await suiteLinks.set(next); setStatus(okStatus(next));
        return `Browserstand im Ordner gespeichert. Der bisherige Ordnerstand liegt als Kopie in ${copy}.`;
      });
      if (outcome === "changed") { await reconcile(link); return; }
      notify(outcome);
    } catch (error) {
      if (error instanceof FolderError && error.code === "conflict") await reconcile(link);
      else setStatus({ kind: "error", name: linkName(link), message: message(error) });
    }
    finally { setBusy(false); }
  }, [committed, waitForLocal, adoptState, notify, reconcile, setStatus]);

  /** Fehlende oder (ausdrücklich) unbrauchbare Datei aus dem Browserstand neu anlegen. */
  const recreate = useCallback(async () => {
    const link = await suiteLinks.get().catch(() => undefined);
    if (!link) return;
    setBusy(true);
    try {
      await waitForLocal();
      await withFolderLock(async () => {
        const result = await writeFile(link, committed()!, 0, { replaceInvalid: statusRef.current.kind === "invalid" });
        const next = { ...link, ...result }; await suiteLinks.set(next); setStatus(okStatus(next));
      });
      notify("SpesenKit-Datei aus dem Browserstand neu angelegt.");
    } catch (error) { setStatus({ kind: "error", name: linkName(link), message: message(error) }); }
    finally { setBusy(false); }
  }, [committed, waitForLocal, notify, setStatus]);

  const retry = useCallback(async () => {
    const link = await suiteLinks.get().catch(() => undefined);
    if (link) await reconcile(link); else setStatus({ kind: "none" });
  }, [reconcile, setStatus]);

  const disconnect = useCallback(async () => {
    if (!confirm("Verbindung zum SpesenKit-Ordner trennen? Die Datei im Ordner bleibt erhalten; neue Änderungen werden nur noch im Browser gespeichert.")) return;
    await suiteLinks.clear().catch(() => undefined);
    setStatus({ kind: "none" });
  }, [setStatus]);

  // Browser schließen, solange der Ordner noch nicht aktuell ist: nachfragen (wichtig bei wechselnden Terminalservern).
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      const now = statusRef.current;
      if ((now.kind === "ok" && now.pending) || now.kind === "error" || now.kind === "conflict" || now.kind === "missing" || now.kind === "invalid" || unsynced.current) { event.preventDefault(); event.returnValue = ""; }
    };
    addEventListener("beforeunload", warn);
    return () => removeEventListener("beforeunload", warn);
  }, []);

  /** Formatwahl für die Ablage (pro Browserprofil gespeichert, wie der Ordner selbst). */
  const setFilingFormats = useCallback(async (next: FilingFormats) => {
    setFilingFormatsState(next);
    await withFolderLock(async () => {
      const current = await suiteLinks.get();
      if (current) await suiteLinks.set({ ...current, filing: next });
    }).catch(() => undefined);
  }, []);

  /** Legt eine abgeschlossene Version im Ordner ab (fehlende Formate). Fehler bleiben als Hinweis sichtbar. */
  const fileVersion = useCallback(async (snapshotId: string, label: string): Promise<FilingReport> => {
    try {
      if (statusRef.current.kind !== "ok") throw new Error(blockingText(statusRef.current) || "Kein verbundener, beschreibbarer SpesenKit-Ordner.");
      const report = await withFolderLock(async () => {
        const current = await suiteLinks.get();
        if (!current) throw new Error("Kein SpesenKit-Ordner verbunden.");
        return fileStatement(current.handle, committed()!, snapshotId, { ...defaultFilingFormats, ...current.filing });
      });
      setFilingIssue((issue) => issue?.snapshotId === snapshotId ? null : issue);
      return report;
    } catch (error) {
      setFilingIssue({ snapshotId, label, message: message(error) });
      throw error;
    } finally { setFilingRun((n) => n + 1); }
  }, [committed]);

  /** Abschluss steht lokal, Ordner war nicht beschreibbar: Ablage merken, Hinweis erscheint, sobald der Ordner wieder bereit ist. */
  const deferFiling = useCallback((snapshotId: string, label: string, reason: string) => setFilingIssue({ snapshotId, label, message: reason }), []);

  const checkFiled = useCallback(async (snapshotId: string) => {
    if (statusRef.current.kind !== "ok") return null;
    const current = await suiteLinks.get().catch(() => undefined);
    if (!current) return null;
    return filedStatus(current.handle, committed()!, snapshotId);
  }, [committed]);

  const okLink = async () => {
    if (statusRef.current.kind !== "ok") throw new Error(blockingText(statusRef.current) || "Kein verbundener, beschreibbarer SpesenKit-Ordner.");
    const current = await suiteLinks.get();
    if (!current) throw new Error("Kein SpesenKit-Ordner verbunden.");
    return current;
  };
  const backups = useCallback(async (): Promise<BackupEntry[]> => listBackups((await okLink()).handle), []);
  const backupNow = useCallback(async (label: "manuell" | "vor_wiederherstellung" = "manuell") => {
    const current = await okLink();
    await waitForLocal();
    const name = await withFolderLock(() => writeSafetyCopy(current.handle, label, committed()!));
    setBackupRun((n) => n + 1);
    return name;
  }, [committed, waitForLocal]);
  /** Nach einem Abschluss: benannte Sicherung (best effort, Hinweis bei Fehler). */
  const backupAfterClosing = useCallback(async (snapshotId: string) => {
    try {
      const current = await okLink();
      await withFolderLock(() => closingBackup(current.handle, committed()!, snapshotId));
      setBackupRun((n) => n + 1);
    } catch (error) { setBackupNote(`Sicherung nach dem Abschluss konnte nicht angelegt werden: ${message(error)}`); }
  }, [committed]);
  /** Sicherung lesen und prüfen, ohne etwas zu ändern: Zusammenfassung und wegfallende Abschlüsse. */
  const previewBackup = useCallback(async (name: string) => {
    const current = await okLink();
    const restored = await readBackup(current.handle, name);
    return { restored, summary: stateSummary(restored), dropped: droppedClosings(committed()!, restored) };
  }, [committed]);
  /** Wiederherstellen: aktueller Stand wird vorher gesichert, dann wie jede Änderung lokal und im Ordner gespeichert. */
  const restoreBackup = useCallback(async (name: string) => {
    const current = await okLink();
    setBusy(true);
    try {
      await waitForLocal();
      const copy = await withFolderLock(async () => {
        const restored = await readBackup(current.handle, name);
        const before = await writeSafetyCopy(current.handle, "vor_wiederherstellung", committed()!);
        await adoptState(restored);
        return before;
      });
      setBackupRun((n) => n + 1);
      afterLocalSave();
      await queue.current;
      const synced = statusRef.current;
      if (synced.kind !== "ok" || synced.pending) {
        throw new Error(`Die Sicherung wurde im Browser geladen, aber noch nicht im SpesenKit-Ordner bestätigt. ${synced.kind === "error" ? synced.message : blockingText(synced) || "Bitte den Speicherhinweis prüfen."}`);
      }
      notify(`Sicherung wiederhergestellt. Der vorherige Stand liegt in ${copy}.`);
    } finally { setBusy(false); }
  }, [committed, waitForLocal, adoptState, afterLocalSave, notify]);

  return { backups, backupNow, backupAfterClosing, previewBackup, restoreBackup, backupNote, backupRun, status, busy, afterLocalSave, flush, blocking, link, confirmAccess, resolveConflict, recreate, retry, disconnect, filingFormats, setFilingFormats, fileVersion, checkFiled, filingIssue, deferFiling, filingRun };
}
export type FolderStorage = ReturnType<typeof useFolderStorage>;

function blockingText(status: FolderStatus) {
  switch (status.kind) {
    case "permission": return `Bitte zuerst den Zugriff auf deinen SpesenKit-Ordner „${status.name}“ bestätigen.`;
    case "conflict": return "Bitte zuerst entscheiden, welcher Datenstand gilt (SpesenKit-Ordner oder Browser).";
    case "missing": return "Die Datei im SpesenKit-Ordner fehlt. Bitte zuerst unter Datensicherung klären.";
    case "invalid": return "Die Datei im SpesenKit-Ordner ist nicht lesbar. Bitte zuerst unter Datensicherung klären.";
    case "checking": return "Der SpesenKit-Ordner wird noch abgeglichen. Bitte kurz warten.";
    default: return "";
  }
}

/** Kompakte Anzeige in der Seitenleiste. */
export function FolderStatusLine({ folder, open }: { folder: FolderStorage; open: () => void }) {
  const { status } = folder;
  const text = status.kind === "ok" ? { tone: "ok", title: status.pending ? "Wird im Ordner gespeichert …" : "Im SpesenKit-Ordner gespeichert", detail: `${status.name}${status.savedAt ? ` · ${time(status.savedAt)}` : ""}` }
    : status.kind === "none" ? { tone: "warn", title: "Nur in diesem Browser", detail: "SpesenKit-Ordner einrichten" }
    : status.kind === "unsupported" ? { tone: "warn", title: "Nur in diesem Browser", detail: "Ordner nur mit Edge oder Chrome" }
    : status.kind === "checking" ? { tone: "info", title: "Ordner wird abgeglichen …", detail: status.name || FOLDER_NAME }
    : status.kind === "permission" ? { tone: "warn", title: "Ordnerzugriff bestätigen", detail: status.name }
    : { tone: "error", title: "Nicht im Ordner gespeichert", detail: "Bitte prüfen" };
  return <button type="button" className={`storage-status ${text.tone}`} onClick={open} data-folder-status={status.kind}>
    <HardDrive size={17} aria-hidden="true" />
    <span><b>{text.title}</b><small>{text.detail}</small></span>
  </button>;
}

/** Hinweis über dem Inhalt, nur wenn etwas zu tun ist. */
export function FolderBanner({ folder, openBackup }: { folder: FolderStorage; openBackup: () => void }) {
  const { status, busy } = folder;
  if (status.kind === "none") return <div className="folder-banner warn" role="status">
    <AlertTriangle size={20} aria-hidden="true" />
    <div><b>Deine Spesen liegen bisher nur in diesem Browser.</b><p>Beim Abmelden oder an einem anderen Terminalserver können sie fehlen. Richte deinen persönlichen SpesenKit-Ordner ein, dann wird jede Änderung dort gespeichert.</p></div>
    <button className="primary" onClick={() => void folder.link()} disabled={busy}><FolderOpen size={17} />Ordner einrichten</button>
  </div>;
  if (status.kind === "permission") return <div className="folder-banner warn" role="alert">
    <AlertTriangle size={20} aria-hidden="true" />
    <div><b>Bitte bestätige den Zugriff auf deinen SpesenKit-Ordner „{status.name}“.</b><p>Der Browser fragt nach einem Neustart erneut. Bis dahin werden Änderungen nur im Browser gespeichert.</p></div>
    <button className="primary" onClick={() => void folder.confirmAccess()} disabled={busy}>Zugriff bestätigen</button>
  </div>;
  if (status.kind === "error") return <div className="folder-banner error" role="alert">
    <AlertTriangle size={20} aria-hidden="true" />
    <div><b>Letzte Änderungen sind nicht im SpesenKit-Ordner gespeichert.</b><p>{status.message} Im Browser sind sie gespeichert.</p></div>
    <button className="primary" onClick={() => void folder.retry()} disabled={busy}><RefreshCw size={17} />Erneut speichern</button>
  </div>;
  if (status.kind === "ok" && folder.filingIssue) { const issue = folder.filingIssue; return <div className="folder-banner warn" role="alert">
    <AlertTriangle size={20} aria-hidden="true" />
    <div><b>{issue.label} ist abgeschlossen und gespeichert – die Dateien sind noch nicht im SpesenKit-Ordner abgelegt.</b><p>{issue.message}</p></div>
    <button className="primary" onClick={() => void folder.fileVersion(issue.snapshotId, issue.label).catch(() => undefined)} disabled={busy}><RefreshCw size={17} />Erneut ablegen</button>
  </div>; }
  if (status.kind === "conflict") return <div className="folder-banner error" role="alert">
    <AlertTriangle size={20} aria-hidden="true" />
    <div><b>Offene Entscheidung: Welcher Datenstand gilt?</b><p>SpesenKit-Ordner und Browser weichen voneinander ab. Bis zur Entscheidung wird nur im Browser gespeichert.</p></div>
    <button className="primary" onClick={() => void folder.retry()} disabled={busy}>Jetzt entscheiden</button>
  </div>;
  if (status.kind === "missing" || status.kind === "invalid") return <div className="folder-banner error" role="alert">
    <AlertTriangle size={20} aria-hidden="true" />
    <div><b>{status.kind === "missing" ? `Die Datei „${DATA_FILE}“ fehlt im SpesenKit-Ordner.` : "Die Datei im SpesenKit-Ordner ist nicht lesbar."}</b><p>{status.kind === "invalid" ? status.message : "Wurde der Ordner verschoben oder umbenannt? Bis zur Klärung wird nur im Browser gespeichert."}</p></div>
    <button className="ghost" onClick={openBackup}>Klären</button>
  </div>;
  return null;
}

/** Entscheidung bei abweichenden Ständen. Kein Schließen ohne Entscheidung außer „später“. */
export function FolderConflictDialog({ folder }: { folder: FolderStorage }) {
  const [later, setLater] = useState(false);
  const { status, busy } = folder;
  useEffect(() => { if (status.kind !== "conflict") setLater(false); }, [status.kind]);
  if (status.kind !== "conflict" || later) return null;
  const fileSummary = stateSummary(status.file.state);
  const localSummary = stateSummary(status.local);
  const row = (label: string, s: ReturnType<typeof stateSummary>, extra: string) => <div className="conflict-side">
    <h3>{label}</h3><p className="muted">{extra}</p>
    <ul><li>{s.trips} Reisen</li><li>{s.expenses} Kosten</li><li>{s.statements} Abrechnungsversionen ({s.closedMonths} Monate abgeschlossen)</li><li>Profil: {s.profile}</li>{s.lastChange && <li>Letzte Änderung: {time(s.lastChange)}</li>}</ul>
  </div>;
  return <div className="modal-backdrop folder-conflict">
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="folder-conflict-title">
      <header><h2 id="folder-conflict-title">Welcher Datenstand gilt?</h2></header>
      <div className="modal-body">
        <p>Im SpesenKit-Ordner und in diesem Browser liegen unterschiedliche Daten. Das passiert zum Beispiel, wenn an einem anderen Terminalserver weitergearbeitet wurde, während hier der Ordner nicht erreichbar war.</p>
        <div className="conflict-grid">
          {row(`SpesenKit-Ordner „${status.name}“`, fileSummary, `Gespeichert ${time(status.file.content.savedAt)} · Stand ${status.file.content.revision}`)}
          {row("Dieser Browser", localSummary, "Nur hier gespeichert")}
        </div>
        <p className="muted">Vor der Übernahme wird der andere Stand als geprüfte Kopie in „{FOLDER_NAME}/Sicherungen“ abgelegt. Unter Datensicherung → Sicherungen lässt er sich nach Prüfung wiederherstellen. Dort bleiben auch Speicherkandidaten konkurrierender oder fehlgeschlagener Schreibversuche erhalten.</p>
        <div className="conflict-actions">
          <button className="primary" disabled={busy} onClick={() => void folder.resolveConflict("folder")}>Ordnerstand übernehmen</button>
          <button className="ghost" disabled={busy} onClick={() => void folder.resolveConflict("browser")}>Browserstand behalten</button>
          <button className="ghost" disabled={busy} onClick={() => setLater(true)}>Später entscheiden</button>
        </div>
      </div>
    </div>
  </div>;
}

/** Einrichtung und Verwaltung unter „Datensicherung“. */
export function FolderCard({ folder }: { folder: FolderStorage }) {
  const { status, busy } = folder;
  const linked = !["none", "unsupported"].includes(status.kind);
  return <section className="card full folder-card" aria-labelledby="folder-card-title">
    <div className="card-head">
      <div><p className="eyebrow">Persönlicher Speicherort</p><h3 id="folder-card-title">SpesenKit-Ordner</h3></div>
      <span className={`status-pill ${status.kind === "ok" ? "ok" : ""}`}>{status.kind === "ok" ? <><CheckCircle2 size={14} /> verbunden</> : linked ? "Handlung nötig" : "nicht eingerichtet"}</span>
    </div>
    {status.kind === "unsupported" ? <p>Dieser Browser kann keinen Ordner verwenden. Bitte SpesenKit in Microsoft Edge oder Google Chrome öffnen.</p> : <>
      <p>Wähle einmal deinen persönlichen Mitarbeiterordner (zum Beispiel <code>H:\Mitarbeiter\Dein Name</code>). SpesenKit legt darin den Ordner <code>{FOLDER_NAME}</code> an und speichert jede Änderung in <code>{FOLDER_NAME}/{DATA_DIR}/{DATA_FILE}</code>. So sind deine Daten auch nach dem Abmelden und an jedem Terminalserver da.</p>
      {status.kind === "ok" && <fieldset className="filing-formats"><legend>Nach dem Monatsabschluss automatisch ablegen in <code>{`${FOLDER_NAME}\\Spesen\\Jahr\\Monat`}</code></legend>
        {(Object.keys(filingFormatLabels) as FilingFormat[]).map((format) => <label key={format} className="check"><input type="checkbox" checked={folder.filingFormats[format]} onChange={(e) => void folder.setFilingFormats({ ...folder.filingFormats, [format]: e.target.checked })} />{filingFormatLabels[format]}</label>)}
      </fieldset>}
      {status.kind === "ok" && <dl className="folder-facts"><div><dt>Ordner</dt><dd>{status.name}</dd></div><div><dt>Zuletzt gespeichert</dt><dd>{status.savedAt ? time(status.savedAt) : "–"}</dd></div><div><dt>Stand</dt><dd>{status.revision}</dd></div></dl>}
      {status.kind === "missing" && <p className="error-text">Die Datei fehlt im Ordner „{status.name}“. Wurde der Ordner verschoben, wähle ihn neu. Sonst kann die Datei aus dem Browserstand neu angelegt werden.</p>}
      {status.kind === "invalid" && <p className="error-text">{status.message} Wähle einen anderen Ordner oder lege die Datei bewusst neu an. Die unlesbare Datei bleibt dann als Kopie in „Sicherungen“ erhalten.</p>}
      {status.kind === "error" && <p className="error-text">{status.message}</p>}
      <div className="folder-actions">
        {status.kind === "permission" ? <button className="primary" disabled={busy} onClick={() => void folder.confirmAccess()}>Zugriff bestätigen</button>
          : <button className={linked ? "ghost" : "primary"} disabled={busy} onClick={() => void folder.link()}><FolderOpen size={17} />{linked ? "Anderen Ordner wählen" : "Ordner einrichten"}</button>}
        {(status.kind === "missing" || status.kind === "invalid") && <button className="ghost" disabled={busy} onClick={() => { if (confirm(status.kind === "invalid" ? "Die unlesbare Datei wird als Kopie beiseitegelegt und aus dem Browserstand neu angelegt. Fortfahren?" : "Datei aus dem Browserstand neu anlegen?")) void folder.recreate(); }}>Datei neu anlegen</button>}
        {status.kind === "error" && <button className="ghost" disabled={busy} onClick={() => void folder.retry()}><RefreshCw size={17} />Erneut speichern</button>}
        {linked && <button className="ghost" disabled={busy} onClick={() => void folder.disconnect()}>Verbindung trennen</button>}
      </div>
      {status.kind === "ok" && <FolderBackups folder={folder} />}
      <p className="muted">Wichtig: Nur du solltest Zugriff auf diesen Ordner haben – die Datei enthält deine Reisen und Belege unverschlüsselt. Bitte das Laufwerk zusätzlich regelmäßig außerhalb des Servers sichern lassen.</p>
    </>}
  </section>;
}

/** Ablage einer abgeschlossenen Version in der Abrechnungsansicht: Stand anzeigen, fehlende Dateien ablegen, drucken. */
export function StatementFiling({ folder, snapshot, label, print }: { folder: FolderStorage; snapshot: StatementSnapshot; label: string; print: () => void }) {
  const [filed, setFiled] = useState<Awaited<ReturnType<FolderStorage["checkFiled"]>>>(null);
  const [working, setWorking] = useState(false);
  const [note, setNote] = useState("");
  const { status, checkFiled, fileVersion, filingFormats } = folder;
  const refresh = useCallback(() => { checkFiled(snapshot.id).then(setFiled, () => setFiled(null)); }, [checkFiled, snapshot.id]);
  useEffect(() => { refresh(); }, [refresh, status.kind, folder.filingIssue, folder.filingRun]);
  useEffect(() => { setNote(""); }, [snapshot.id]);
  const formats = (Object.keys(filingFormatLabels) as FilingFormat[]);
  const missing = filed ? formats.filter((f) => filingFormats[f] && !filed.present[f]) : [];
  return <section className="card statement-filing" aria-label="Ablage im SpesenKit-Ordner">
    <div className="card-head"><div><p className="eyebrow">Ablage</p><h3>Im SpesenKit-Ordner</h3></div>
      <button className="ghost" onClick={print}><Printer size={17} />Abrechnung drucken</button></div>
    {status.kind !== "ok" ? <p className="muted">{status.kind === "none" || status.kind === "unsupported" ? "Kein SpesenKit-Ordner verbunden. Die Dateien lassen sich über die Export-Knöpfe herunterladen." : "Der SpesenKit-Ordner ist gerade nicht bereit (Hinweis oben)."}</p> : !filed ? <p className="muted">Ablage wird geprüft …</p> : <>
      <p><code>{filed.folder}</code></p>
      <ul className="filing-list">{formats.filter((f) => filingFormats[f] || filed.present[f]).map((f) => <li key={f} className={filed.present[f] ? "ok" : "missing"}>{filed.present[f] ? <CheckCircle2 size={16} aria-hidden="true" /> : <AlertTriangle size={16} aria-hidden="true" />}<span>{filed.names[f]}</span><small>{filed.present[f] ? "abgelegt" : "fehlt"}</small></li>)}</ul>
      {missing.length > 0 && <button className="primary" disabled={working} onClick={async () => {
        setWorking(true); setNote("");
        try { const report = await fileVersion(snapshot.id, label); setNote(report.written.length ? `Abgelegt: ${report.written.join(", ")}` : "Alles war bereits abgelegt."); }
        catch (error) { setNote(`Nicht abgelegt: ${message(error)}`); }
        finally { setWorking(false); refresh(); }
      }}>Im SpesenKit-Ordner ablegen</button>}
      {note && <p className="muted" role="status">{note}</p>}
      <p className="muted">Vorhandene Dateien werden nie überschrieben. Eine Korrektur wird als neue Version daneben abgelegt.</p>
    </>}
  </section>;
}

const size = (bytes: number) => bytes >= 1048576 ? `${(bytes / 1048576).toLocaleString("de-DE", { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(bytes / 1024)).toLocaleString("de-DE")} KB`;
const dateDe = (date: string, clock: string) => `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)} ${clock.slice(0, 5)}`;

/** Sicherungsstände im Ordner: Liste, „Jetzt sichern“, Wiederherstellen mit ausdrücklicher Bestätigung. */
function FolderBackups({ folder }: { folder: FolderStorage }) {
  const [entries, setEntries] = useState<BackupEntry[] | null>(null);
  const [all, setAll] = useState(false);
  const [saveAttempts, setSaveAttempts] = useState(false);
  const [working, setWorking] = useState(false);
  const [note, setNote] = useState("");
  const { backups, backupRun } = folder;
  useEffect(() => { backups().then(setEntries, (error) => { setEntries([]); setNote(message(error)); }); }, [backups, backupRun]);
  const restore = async (entry: BackupEntry) => {
    setWorking(true); setNote("");
    try {
      const preview = await folder.previewBackup(entry.name);
      const s = preview.summary;
      const warning = preview.dropped.length ? `\n\nACHTUNG: Diese abgeschlossenen Abrechnungen sind in der Sicherung nicht enthalten und wären danach nicht mehr im aktuellen Stand: ${preview.dropped.join(", ")}. Bereits abgelegte PDFs bleiben im Ordner „Spesen“.` : "";
      if (!confirm(`Stand vom ${dateDe(entry.date, entry.time)} wiederherstellen (${backupKindLabels[entry.kind]})?\n\nInhalt: ${s.trips} Reisen, ${s.expenses} Kosten, ${s.statements} Abrechnungsversionen.\nDer aktuelle Stand wird vorher als Sicherung „Vor Wiederherstellung“ abgelegt.${warning}`)) return;
      await folder.restoreBackup(entry.name);
    } catch (error) { setNote(`Nicht wiederhergestellt: ${message(error)}`); }
    finally { setWorking(false); }
  };
  const visible = entries?.filter((entry) => saveAttempts || !["speicherkandidat", "vor_speichern"].includes(entry.kind));
  const shown = visible ? (all ? visible : visible.slice(0, 10)) : [];
  return <div className="folder-backups">
    <div className="folder-backups-head"><h4>Sicherungen in <code>{`${FOLDER_NAME}\\${COPY_DIR}`}</code></h4>
      <button className="ghost" disabled={working || folder.busy} onClick={async () => { setWorking(true); setNote(""); try { await folder.backupNow(); setNote("Sicherung angelegt."); } catch (error) { setNote(message(error)); } finally { setWorking(false); } }}>Jetzt sichern</button></div>
    <p className="muted">Automatisch: einmal täglich der Stand vor der ersten Änderung (die letzten 14 Tage, dazu je Monat einer für 12 Monate) und nach jedem Monatsabschluss. Vor jedem Schreibversuch werden zusätzlich der Speicherkandidat und der gelesene Vorgänger gesichert. Sie werden beim nächsten Speichern gelöscht, wenn die Datei noch genau diesen Stand hat; liegengebliebene Kopien (z. B. nach einem Konflikt) nach 7 Tagen.</p>
    <p className="muted">Ein Speicherkandidat ist kein bestätigter Abschluss des Speichervorgangs: Er kann aus einem abgebrochenen oder konkurrierenden Versuch stammen. Vor dem Wiederherstellen den Inhalt prüfen; die Auswahl ersetzt den aktuellen Datenstand und führt ihn nicht automatisch zusammen.</p>
    {folder.backupNote && <p className="error-text" role="status">{folder.backupNote}</p>}
    <label className="check"><input type="checkbox" checked={saveAttempts} onChange={(event) => setSaveAttempts(event.target.checked)} />Speicherkandidaten und Vorgänger anzeigen</label>
    {entries === null ? <p className="muted">Sicherungen werden gelesen …</p> : !visible?.length ? <p className="muted">Keine Sicherungen in dieser Auswahl.</p> :
      <div className="table-wrap"><table className="backup-table"><thead><tr><th>Zeitpunkt</th><th>Art</th><th>Größe</th><th><span className="sr-only">Aktion</span></th></tr></thead>
        <tbody>{shown.map((entry) => <tr key={entry.name} title={entry.name}><td>{dateDe(entry.date, entry.time)}</td><td>{backupKindLabels[entry.kind]}{entry.detail ? ` ${entry.detail}` : ""}</td><td>{size(entry.size)}</td>
          <td>{entry.restorable && <button className="ghost small" disabled={working || folder.busy} onClick={() => void restore(entry)}>Wiederherstellen</button>}</td></tr>)}</tbody></table></div>}
    {visible && visible.length > 10 && <button className="ghost" onClick={() => setAll(!all)}>{all ? "Weniger anzeigen" : `Alle ${visible.length} anzeigen`}</button>}
    {note && <p className="muted" role="status">{note}</p>}
  </div>;
}
