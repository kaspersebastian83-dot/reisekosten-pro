"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  BookOpen,
  BarChart3,
  Camera,
  Car,
  Check,
  ChevronRight,
  CircleGauge,
  Copy,
  Download,
  FileDown,
  FileSpreadsheet,
  Fuel,
  Import,
  Inbox,
  Menu,
  Plus,
  ReceiptText,
  RotateCcw,
  Save,
  ScanLine,
  Settings as SettingsIcon,
  ShieldCheck,
  Sparkles,
  Trash2,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import type {
  AppState,
  Expense,
  ReceiptInboxItem,
  ReviewStatus,
  StatementSnapshot,
  Trip,
  VehicleProfile,
} from "../lib/types";
import { emptyState, expenseCategories } from "../lib/config";
import {
  loadState,
  saveState,
  normalizeState,
  commitTripImport,
} from "../lib/storage";
import {
  buildStatement,
  calculateDay,
  groupTripsByDay,
  duplicateKey,
  expenseConflictsWithMileageAllowance,
  round2,
  expenseReimbursable,
  validateTrip,
} from "../lib/calculations";
import {
  canonicalFields,
  parseImportFile,
  rowsToTrips,
  suggestMapping,
} from "../lib/importer";
import { manualTripErrors, manualTripInterval, manualTripReviewNotes, projectPlace, projectSuggestions } from "../lib/manual-trip";
import { cleanContext, duplicateMessage, linkingErrors, paymentLabel, paymentPayer, similarExpense, syncExpenseLink, validDate } from "../lib/receipt-linking";
import { buildAnnualAnalysis } from "../lib/annual-reports";
import { readReceiptFile } from "../lib/receipt-file";
import { PaymentSelect, ReceiptAttachment, ReceiptLinkFields, tripLabel } from "./receipt-link-fields";
import { MonthWorkspace } from "./month-workspace";
import { StatementClosing } from "./statement-closing";
import { StatementChanges } from "./statement-changes";
import { compareClosedStatementWithCurrent, isClosedStatement, persistCorrectionDraft, relatedTripsForSnapshot, snapshotHistoryLimitations, stateForStatementVersion } from "../lib/statement-comparison";
import { droppedClosings } from "../lib/folder-backups";
import { MonthTimeline } from "./month-timeline";
import { FolderBanner, FolderCard, FolderConflictDialog, FolderStatusLine, StatementFiling, useFolderStorage, type FolderStorage } from "./folder-storage";
import { changeStatementStatus, persistStatementClosing, type ClosingConfirmation, type ClosingIssue } from "../lib/statement-closing";
import { MonthNavigation } from "./month-navigation";
import { isMonth, previousCalendarMonth, localCalendarMonth, monthLabel, monthOverview } from "../lib/month-navigation";
import { demoState } from "../lib/demo";
import { applyMerchantRule, recognizeReceiptLocally } from "../lib/receipt-ocr";
import {
  exportBackup,
  exportCsv,
  exportExcel,
  exportPdf,
  printPdf,
  exportZip,
  correctionExportNotice,
} from "../lib/exports";

import { PendingWork, usePendingWork } from "../lib/pending-work";
import { appRelease } from "../lib/release";
import { DayDetails, MonthDetails } from "./calculation-details";
import { UpdateNotice } from "./update-notice";
import { nextExpenseDraft, nextTripDraft } from "../lib/batch-entry";
import { linkedExpenseCount, openInboxItems, removeExpense, removeTrip } from "../lib/entry-removal";
import type { TimelineFilter } from "../lib/month-timeline";

// „Reisen“ und „Kosten & Belege“ sind in der Monatsübersicht aufgegangen; der Import ist von dort erreichbar.
type Tab =
  | "Fahrten importieren"
  | "Monatsübersicht"
  | "Auswertungen"
  | "Einstellungen"
  | "Datensicherung";
const tabs: { name: Tab; icon: typeof FileSpreadsheet }[] = [
  { name: "Monatsübersicht", icon: FileSpreadsheet },
  { name: "Auswertungen", icon: BarChart3 },
  { name: "Einstellungen", icon: SettingsIcon },
  { name: "Datensicherung", icon: Archive },
];
const euro = (n: number) =>
  n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const duration = (m: number) =>
  `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")} Std.`;
const dateDe = (d: string) => (d ? d.split("-").reverse().join(".") : "–");
const uid = () =>
  typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `rk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export default function Home() {
  const [state, setState] = useState<AppState>(structuredClone(emptyState));
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const lastSaved = useRef<AppState | null>(null);
  const saveQueue = useRef(Promise.resolve());
  const pendingWork = useRef(new Set<string>());
  const reportPending = useCallback((id: string, pending: boolean) => {
    if (pending) pendingWork.current.add(id); else pendingWork.current.delete(id);
  }, []);
  const stateRef = useRef(state); stateRef.current = state;
  const importBusy = useRef(false);
  const [transactionSaving, setTransactionSaving] = useState(false);
  const [updatePreparing, setUpdatePreparing] = useState(false);
  const confirmImport = async (trips: Trip[], profile: import("../lib/types").ImportProfile, vimcar: boolean) => {
    if (importBusy.current) throw new Error("Import wird bereits gespeichert.");
    importBusy.current = true; setTransactionSaving(true);
    try {
      await saveQueue.current;
      if (stateRef.current !== lastSaved.current) throw new Error("Bitte zuerst die offenen Änderungen erfolgreich speichern.");
      const committed = await commitTripImport(trips, profile, vimcar);
      lastSaved.current = committed.state;
      stateRef.current = committed.state;
      setState(committed.state);
      folder.afterLocalSave();
      return committed;
    } finally { importBusy.current = false; setTransactionSaving(false); }
  };
  const commitClosing = async (confirmation: ClosingConfirmation) => {
    if (importBusy.current) throw new Error("Ein lokaler Speichervorgang läuft bereits.");
    importBusy.current = true; setTransactionSaving(true);
    let closedLocally = false;
    try {
      await saveQueue.current;
      // Ein verbundener, aber gerade nicht beschreibbarer Ordner wird vor dem Abschluss geklärt.
      const folderBlock = folder.blocking();
      if (folderBlock) throw new Error(folderBlock);
      const current = stateRef.current;
      if (current !== lastSaved.current) throw new Error("Bitte zuerst offene Änderungen erfolgreich lokal speichern und die Abschlussprüfung erneut öffnen.");
      const committed = await persistStatementClosing(current, confirmation, { id: uid(), at: new Date().toISOString() }, saveState);
      lastSaved.current = committed;
      stateRef.current = committed;
      setState(committed);
      closedLocally = true;
      // Erfolg erst melden, wenn auch die Datei im SpesenKit-Ordner geschrieben ist.
      const filed = await folder.flush();
      const closedVersion = committed.statements.find((item) => item.id === confirmation.snapshotId);
      const label = `${monthLabel(confirmation.month)}${closedVersion ? ` (Version ${closedVersion.version})` : ""}`;
      if (filed.error) {
        folder.deferFiling(confirmation.snapshotId, label, "Der Ordner war beim Abschluss nicht beschreibbar.");
        throw new Error(`Der Abschluss ist im Browser gespeichert, aber noch nicht im SpesenKit-Ordner: ${filed.error} Bitte den Hinweis oben beachten und erneut speichern.`);
      }
      setSaveError("");
      // Erst nach dem gesicherten Datenstand: PDF/ZIP ablegen. Ein Fehler hier ändert den Abschluss nicht und bleibt als Hinweis sichtbar.
      let filing = "";
      if (filed.linked) {
        try { const report = await folder.fileVersion(confirmation.snapshotId, label); filing = report.written.length || report.existing.length ? ` Abgelegt in ${report.folder}.` : ""; }
        catch { filing = " Die Dateien sind noch nicht abgelegt – siehe Hinweis oben."; }
        await folder.backupAfterClosing(confirmation.snapshotId);
      }
      notify(filed.linked ? `Monatsabrechnung abgeschlossen und im SpesenKit-Ordner gespeichert.${filing}` : "Monatsabrechnung lokal gespeichert und abgeschlossen.");
    } catch (failure) {
      const text = failure instanceof Error ? failure.message : "Lokales Speichern fehlgeschlagen.";
      setSaveError(closedLocally ? text : `Der Monatsabschluss wurde nicht bestätigt. ${text}`);
      throw failure;
    } finally { importBusy.current = false; setTransactionSaving(false); }
  };
  const commitCorrection = async (targetMonth: string, expected: AppState) => {
    if (importBusy.current) throw new Error("Ein lokaler Speichervorgang läuft bereits.");
    importBusy.current = true; setTransactionSaving(true);
    let createdLocally = false;
    try {
      await saveQueue.current;
      const folderBlock = folder.blocking();
      if (folderBlock) throw new Error(folderBlock);
      const current = stateRef.current;
      if (current !== lastSaved.current || current !== expected) throw new Error("Bitte offene Änderungen erfolgreich speichern und den Korrekturvergleich erneut prüfen.");
      const result = await persistCorrectionDraft(current, targetMonth, { id: uid(), changeId: uid(), at: new Date().toISOString() }, saveState);
      if (result.created) { lastSaved.current = result.state; stateRef.current = result.state; setState(result.state); createdLocally = true; }
      const filed = await folder.flush();
      if (filed.error) throw new Error(`Der Korrekturentwurf ist im Browser gespeichert, aber noch nicht im SpesenKit-Ordner: ${filed.error}`);
      setSaveError("");
      notify(result.created ? `Korrekturentwurf ${filed.linked ? "im SpesenKit-Ordner" : "lokal"} gespeichert. Noch nicht freigegeben oder ausgezahlt.` : "Vorhandenen Korrekturentwurf geöffnet.");
      return result.snapshotId;
    } catch (failure) {
      const text = failure instanceof Error ? failure.message : "Lokales Speichern fehlgeschlagen.";
      setSaveError(createdLocally ? text : `Kein neuer Korrekturentwurf bestätigt. ${text}`);
      throw failure;
    } finally { importBusy.current = false; setTransactionSaving(false); }
  };
  const canUpdate = async (discard: boolean) => {
    if (!discard && pendingWork.current.size) return false;
    if (importBusy.current) return false;
    await saveQueue.current;
    await folder.flush();
    return stateRef.current === lastSaved.current && (discard || !pendingWork.current.size) && !importBusy.current;
  };
  const [saveRetry, setSaveRetry] = useState(0);
  const [tab, setTab] = useState<Tab>("Monatsübersicht");
  const [month, setMonth] = useState(() => previousCalendarMonth());
  const [sidebar, setSidebar] = useState(false);
  const [toast, setToast] = useState("");
  const [undoAction, setUndoAction] = useState<(() => void) | null>(null);
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [workspaceEntry, setWorkspaceEntry] = useState<{month: string} | null>(null);
  const [expenseDraft, setExpenseDraft] = useState<Expense | null>(null);
  const finishWorkspaceEntry = () => {if (workspaceEntry) setMonth(workspaceEntry.month); setWorkspaceEntry(null); setExpenseDraft(null); setEditingTrip(null); setTab("Monatsübersicht");};
  /** Kostenformular direkt über der Monatsübersicht (ohne Wechsel in „Kosten & Belege“). */
  const [inlineExpense, setInlineExpense] = useState(false);
  const finishInlineEntry = () => {setEditingTrip(null); setExpenseDraft(null); setEditingExpenseId(null); setInlineExpense(false);};
  const startMonthEntry = (kind: "trip" | "Hotel" | "Parken") => {
    const today = new Date().toLocaleDateString("sv-SE");
    const date = localCalendarMonth() === month ? today : `${month}-01`;
    // Erfassen bleibt in der Monatsübersicht: das Formular öffnet sich über dem Monat, danach geht es dort weiter.
    if (kind === "trip") setEditingTrip({...blankTrip(state.settings), date, endDate: date});
    else { setExpenseDraft({...blankExpense(), date, category: kind}); setInlineExpense(true); }
  };
  const leaveForm = () => {
    if (!pendingWork.current.size) return true;
    notify("Bitte offene Eingaben zuerst speichern oder im Formular ausdrücklich abbrechen.");
    return false;
  };
  const returnToWorkspace = () => {if (leaveForm()) finishWorkspaceEntry();};
  const navigate = (target: Tab) => {
    if (target === tab) return;
    if (!leaveForm()) return;
    if (target === "Monatsübersicht" && workspaceEntry) finishWorkspaceEntry();
    else setTab(target);
  };
  const selectMonth = (value: string) => {
    if (!isMonth(value) || value === month || !leaveForm()) return;
    // Während des Imports bleibt der Rückweg erhalten und führt in den neu gewählten Monat.
    setWorkspaceEntry((entry) => entry ? { month: value } : null); setMonth(value);
  };
  const [editingTrip, setEditingTrip] = useState<Trip | null>(null);
  const [receiptCaptureOpen, setReceiptCaptureOpen] = useState(false);
  // Beleg-Eingang der Reihe nach abarbeiten (Monatsübersicht): Liste der Eingangs-IDs zu Beginn festhalten.
  const [inboxQueue, setInboxQueue] = useState<{ ids: string[]; total: number } | null>(null);
  useEffect(() => {
    // Inzwischen anderweitig zugeordnete oder entfernte Belege überspringen.
    if (!inboxQueue) return;
    const open = new Set(openInboxItems(state).map((item) => item.id));
    if (open.has(inboxQueue.ids[0])) return;
    const ids = inboxQueue.ids.filter((id) => open.has(id));
    setInboxQueue(ids.length ? { ...inboxQueue, ids } : null);
  }, [inboxQueue, state]);
  const startInbox = () => {
    const ids = openInboxItems(state).map((item) => item.id);
    if (ids.length) setInboxQueue({ ids, total: ids.length });
  };
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const readLocalState = () => {
    setLoadError("");
    return loadState().then((s) => {
      lastSaved.current = s;
      setState(s);
      setReady(true);
    }).catch((error: unknown) => {
      console.error("Lokale Daten konnten nicht geladen werden", error);
      setLoadError(error instanceof Error ? error.message : "Unbekannter Speicherfehler");
    });
  };
  useEffect(() => {
    void readLocalState();

  }, []);
  useEffect(() => {
    if (!ready || state === lastSaved.current) return;
    // Änderungen werden der Reihe nach gespeichert. Ein Fehler bleibt sichtbar.
    saveQueue.current = saveQueue.current.then(async () => {
      try {
        await saveState(state, lastSaved.current!);
        lastSaved.current = state;
        setSaveError("");
        folder.afterLocalSave();
      } catch (error) {
        console.error("Lokales Speichern fehlgeschlagen", error);
        setSaveError(`Änderungen konnten nicht lokal gespeichert werden. ${error instanceof Error ? error.message : "Bitte sichern Sie den aktuellen Stand als JSON und versuchen Sie das Speichern erneut."}`);
      }
    });
  }, [state, ready, saveRetry]);
  const notify = (message: string, undo?: () => void) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(message);
    setUndoAction(() => undo || null);
    toastTimer.current = setTimeout(
      () => {
        setToast("");
        setUndoAction(null);
      },
      undo ? 7000 : 3500,
    );
  };
  const folder = useFolderStorage({
    ready,
    committed: useCallback(() => lastSaved.current, []),
    waitForLocal: useCallback(() => saveQueue.current, []),
    adoptState: useCallback(async (next: AppState) => {
      await saveQueue.current;
      await saveState(next, lastSaved.current!);
      lastSaved.current = next; stateRef.current = next; setState(next);
    }, []),
    notify: useCallback((text: string) => notifyRef.current(text), []),
  });
  const notifyRef = useRef(notify); notifyRef.current = notify;
  const update = (fn: (s: AppState) => AppState) =>
    setState((s) => fn(structuredClone(s)));
  const statement = useMemo(() => buildStatement(state, month), [state, month]);
  const monthStatus = useMemo(() => monthOverview(state, month), [state, month]);
  const issueCount =
    state.trips.filter(
      (t) =>
        t.warnings.length ||
        t.status === "ungeprüft" ||
        t.status === "importiert",
    ).length +
    state.expenses.filter((e) => e.warnings.length || e.status === "ungeprüft")
      .length;

  if (!ready)
    return (
      <div className="loading">
        {loadError ? <>
          <h1>Lokale Daten konnten nicht geöffnet werden</h1>
          <p role="alert">{loadError}</p>
          <p>Ihre gespeicherten Daten wurden nicht gelöscht oder überschrieben. Erlauben Sie lokalen Browserspeicher und schließen Sie gegebenenfalls andere App-Tabs. Löschen Sie keine Websitedaten.</p>
          <button className="primary" onClick={() => void readLocalState()}>Erneut versuchen</button>
        </> : <><span /><p>SpesenKit wird lokal geladen …</p></>}
      </div>
    );
  return (
    <PendingWork.Provider value={reportPending}>
    {transactionSaving && <div className="import-saving" role="status">Lokale Änderungen werden vollständig gespeichert …</div>}
    {updatePreparing && <div className="import-saving" role="status">Update wird vorbereitet · bitte kurz warten …</div>}
    <div className="app-shell" inert={transactionSaving || updatePreparing || folder.busy}>
      <aside className={`sidebar ${sidebar ? "open" : ""}`}>
        <div className="brand">
          <div className="brand-mark"><img src="./favicon.svg" alt="" width="42" height="42" /></div>
          <div>
            <b>SpesenKit</b>
            <small>Dienstreisen · Spesen · Abrechnungen</small>
          </div>
          <button
            className="icon mobile-only"
            onClick={() => setSidebar(false)}
            aria-label="Menü schließen"
          >
            <X size={20} />
          </button>
        </div>
        <nav>
          {tabs.map(({ name, icon: Icon }) => (
            <button
              key={name}
              className={tab === name || (tab === "Fahrten importieren" && name === "Monatsübersicht") ? "active" : ""}
              aria-current={tab === name || (tab === "Fahrten importieren" && name === "Monatsübersicht") ? "page" : undefined}
              onClick={() => {
                navigate(name);
                setSidebar(false);
              }}
            >
              <Icon size={19} />
              <span>{name}</span>
            </button>
          ))}
        </nav>
        <FolderStatusLine folder={folder} open={() => navigate("Datensicherung")} />
        <a className="suite-link" href="../Projektzentrale/" target="projektzentrale" rel="noopener">
          <ArrowLeft size={16} aria-hidden="true" />
          <span><b>Projektzentrale</b><small>Spektron · alle Apps</small></span>
        </a>
        <a className="suite-link" href="../aidkit/#app-spesenkit" target="aidkit" rel="noopener" title="Handbuch: SpesenKit Schritt für Schritt – öffnet AidKit in einem eigenen Fenster">
          <BookOpen size={16} aria-hidden="true" />
          <span><b>Handbuch</b><small>SpesenKit Schritt für Schritt</small></span>
        </a>
        <div className="privacy-note">
          <ShieldCheck size={18} />
          <div>
            <b>Ihre Daten bleiben hier</b>
            <span>Lokale Speicherung, keine Tracker.</span>
          </div>
        </div>
      </aside>
      {sidebar && (
        <button
          className="scrim"
          onClick={() => setSidebar(false)}
          aria-label="Menü schließen"
        />
      )}
      <main className="main">
        <UpdateNotice canUpdate={canUpdate} prepare={setUpdatePreparing} />
        {saveError && <div className="error-box" role="alert">
          <p>{saveError}</p>
          <button onClick={() => exportBackup(state)}>JSON-Sicherung herunterladen</button>
          <button onClick={() => setSaveRetry((n) => n + 1)}>Speichern erneut versuchen</button>
        </div>}
        <FolderBanner folder={folder} openBackup={() => navigate("Datensicherung")} />
        <header className="topbar">
          <button
            className="icon mobile-only"
            onClick={() => setSidebar(true)}
            aria-label="Menü öffnen"
          >
            <Menu />
          </button>
          <div>
            <p className="eyebrow">Reisekostenabrechnung</p>
            <h1>{tab}</h1>
          </div>
          <div className="top-actions">
            <label className="month-picker">
              Abrechnungsmonat
              <input
                type="month"
                value={month}
                onChange={(e) => selectMonth(e.target.value)}
              />
            </label>
            {/* Status des gewählten Monats – dieselbe Angabe wie in der Jahresleiste. */}
            {tab !== "Monatsübersicht" && <button type="button" className={`quality ${["review", "history-review", "closed-changed"].includes(monthStatus.status) ? "warn" : "ok"}`} onClick={() => navigate("Monatsübersicht")} title="Zur Monatsübersicht">
              <CircleGauge size={18} />
              <span>{monthLabel(month)} · {monthStatus.label}</span>
            </button>}
          </div>
        </header>
        <div className="content">
          {tab === "Fahrten importieren" && (
            <ImportWizard
              state={state}
              confirmImport={confirmImport}
              notify={notify}
              go={target => target === "Monatsübersicht" ? finishWorkspaceEntry() : setTab(target)}
            />
          )}
          {workspaceEntry && tab !== "Monatsübersicht" && <div className="notice workspace-return"><span>Arbeitsmonat: <b>{monthLabel(workspaceEntry.month)}</b></span><button className="ghost" onClick={returnToWorkspace}>Zurück zum Monatsarbeitsbereich</button></div>}
          {tab === "Monatsübersicht" && (
            <MonthNavigation state={state} month={month} onSelect={selectMonth}>
            <Statements
              state={state}
              month={month}
              statement={statement}
              update={update}
              notify={notify}
              startEntry={startMonthEntry}
              openCapture={() => setReceiptCaptureOpen(true)}
              viewRules={() => setTab("Einstellungen")}
              commitClosing={commitClosing}
              commitCorrection={commitCorrection}
              folder={folder}
              openImport={() => {setWorkspaceEntry({month}); setTab("Fahrten importieren");}}
              startInbox={startInbox}
              editClosingIssue={target => {
                // Hinweise aus der Abschlussprüfung direkt hier bearbeiten; danach bleibt die Prüfung sichtbar.
                if (target.kind === "trip") setEditingTrip(state.trips.find(trip => trip.id === target.id) || null);
                else { setEditingExpenseId(target.id); setInlineExpense(true); }
              }}
            />
            </MonthNavigation>
          )}
          {tab === "Monatsübersicht" && editingTrip && (
            <Trips state={state} update={update} notify={notify}
              editing={editingTrip} setEditing={setEditingTrip} onSaved={finishInlineEntry} />
          )}
          {tab === "Monatsübersicht" && inlineExpense && (
            <Expenses state={state} update={update} notify={notify}
              initialDraft={expenseDraft} clearInitialDraft={() => setExpenseDraft(null)} workspaceMonth={month}
              initialExpenseId={editingExpenseId} clearInitialExpense={() => setEditingExpenseId(null)}
              onSaved={finishInlineEntry} onClosed={finishInlineEntry} />
          )}
          {tab === "Auswertungen" && <Reports state={state} month={month} />}
          {tab === "Einstellungen" && (
            <SettingsPanel state={state} update={update} notify={notify} />
          )}
          {tab === "Datensicherung" && (
            <Backup state={state} setState={setState} notify={notify} folder={folder} />
          )}
        </div>
      </main>
      {inboxQueue && (() => {
        const item = state.receiptInbox.find((entry) => entry.id === inboxQueue.ids[0]);
        if (!item) return null;
        const advance = () => setInboxQueue((queue) => {
          const ids = queue ? queue.ids.slice(1) : [];
          if (!ids.length) { notify("Beleg-Eingang abgearbeitet."); return null; }
          return { ...queue!, ids };
        });
        return <ReceiptCapture key={item.id} state={state} month={month} update={update} notify={notify}
          initial={structuredClone(item)} close={() => setInboxQueue(null)} onDone={advance}
          position={`Beleg ${inboxQueue.total - inboxQueue.ids.length + 1} von ${inboxQueue.total}`} />;
      })()}
      {receiptCaptureOpen && tab !== "Auswertungen" && (
        <ReceiptCapture
          state={state}
          month={month}
          update={update}
          notify={notify}
          close={() => setReceiptCaptureOpen(false)}
        />
      )}
      {toast && (
        <div className="toast">
          <Check size={18} />
          <span>{toast}</span>
          {undoAction && (
            <button
              onClick={() => {
                undoAction();
                setUndoAction(null);
                setToast("Rückgängig gemacht");
              }}
            >
              <Undo2 size={15} /> Rückgängig
            </button>
          )}
        </div>
      )}
    </div>
    <FolderConflictDialog folder={folder} />
    </PendingWork.Provider>
  );
}

function MonthChecks({state, month, update, notify, viewRules, showIssues, startInbox}: {
  state: AppState; month: string;
  update: (f: (s: AppState) => AppState) => void; notify: (s: string) => void;
  viewRules: () => void;
  /** Passende Einträge in der Zeitleiste zeigen. */
  showIssues: (filter: TimelineFilter) => void;
  startInbox: () => void;
}) {
  const monthTrips = state.trips.filter(
    (t) => t.date.startsWith(month) && t.tripType === "dienstlich",
  );
  const monthExpenses = state.expenses.filter((e) => e.date.startsWith(month));
  const missingReceipts = monthExpenses.filter((e) => !e.receipt).length;
  const duplicates = monthTrips.filter((t) =>
    t.warnings.some((w) => w.toLowerCase().includes("duplikat")),
  ).length;
  const confirmable = monthTrips.filter(
    (t) =>
      !t.absenceConfirmed &&
      !!t.startTime &&
      !!t.endTime &&
      !!t.destination &&
      !!t.purpose &&
      t.tripType === "dienstlich" &&
      t.warnings.every((w) =>
        w.toLowerCase().includes("abwesenheitsdauer muss bestätigt"),
      ),
  );
  const confirmClearTrips = () => {
    if (!confirmable.length) return;
    update((s) => {
      s.trips = s.trips.map((trip) => {
        if (!confirmable.some((item) => item.id === trip.id)) return trip;
        const next = { ...trip, absenceConfirmed: true };
        next.warnings = validateTrip(next);
        next.status = "geprüft";
        return next;
      });
      return s;
    });
    notify(`${confirmable.length} eindeutige Fahrten bestätigt`);
  };
  const tripIssues = monthTrips.filter(t => t.warnings.length || t.status === "ungeprüft" || t.status === "importiert").length;
  const expenseIssues = monthExpenses.filter(e => e.warnings.length || e.status === "ungeprüft").length;
  const reasons = monthOverview(state, month).reasons;
  const hasKnownIssues = Boolean(tripIssues || expenseIssues || missingReceipts || duplicates || reasons.length);
  return <section className="month-checks" aria-label="Prüfen">
    <h3>Prüfen</h3>
    <details>
      <summary><span>Offene Prüfhinweise ansehen</span><span className={`workspace-check-status ${hasKnownIssues ? "has-issues" : "no-known-issues"}`}>{hasKnownIssues ? "Hinweise vorhanden" : "Keine bekannten Hinweise"}</span></summary>
      <p>{tripIssues || expenseIssues || missingReceipts || duplicates || reasons.length ? "Vorhandene Hinweise und noch ungeprüfte Einträge dieses Monats." : "Keine bekannten Prüfhinweise für diesen Monat. Dies ersetzt keine vollständige Abschlussprüfung."}</p>
      {!!reasons.length && <ul className="month-review">{reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>}
      <div className="check-list">
        <CheckRow label="Ungeprüfte Reisen / Reisehinweise" value={tripIssues} go={() => showIssues("trips")} />
        <CheckRow label="Ungeprüfte Kosten / Kostenhinweise" value={expenseIssues} go={() => showIssues("expenses")} />
        <CheckRow label="Fehlende Belege" value={missingReceipts} go={() => showIssues("receipts")} />
        <CheckRow label="Mögliche Duplikate" value={duplicates} go={() => showIssues("duplicates")} />
      </div>
      <p>{openInboxItems(state).length} Belege im Eingang insgesamt.{openInboxItems(state).length > 0 && <> <button className="ghost" onClick={startInbox}>Belege nacheinander zuordnen</button></>}</p>
    </details>
    {confirmable.length > 0 && <div className="batch-confirm"><span><b>{confirmable.length} vollständige Fahrten</b> können gemeinsam bestätigt werden.</span><button className="primary" onClick={confirmClearTrips}>Eindeutige Zeiten bestätigen</button></div>}
    <button className="link" onClick={viewRules}>Tarife und Regeln ansehen</button>
  </section>;
}

function CheckRow({
  label,
  value,
  go,
}: {
  label: string;
  value: number;
  go: () => void;
}) {
  return (
    <button onClick={go}>
      <span className={value ? "dot warn" : "dot ok"} />
      <b>{label}</b>
      <em>{value ? value : <Check size={16} />}</em>
      <ChevronRight size={16} />
    </button>
  );
}

function ReceiptCapture({
  state,
  month,
  update,
  notify,
  close,
  initial,
  onDone,
  position,
}: {
  state: AppState;
  month: string;
  update: (f: (s: AppState) => AppState) => void;
  notify: (s: string, undo?: () => void) => void;
  close: () => void;
  initial?: ReceiptInboxItem;
  /** Eingang der Reihe nach: nach „übernehmen“ oder „im Eingang lassen“ weiter zum nächsten Beleg statt schließen. */
  onDone?: () => void;
  /** z. B. „Beleg 2 von 5“ */
  position?: string;
}) {
  const now = new Date().toISOString().slice(0, 10);
  const [receipt, setReceipt] = useState(initial?.receipt);
  const [suggestion, setSuggestionState] = useState<import("../lib/types").ReceiptSuggestion>(
    initial?.suggestion || {
      date: now.startsWith(month) ? now : `${month}-01`,
      category: "sonstige Nebenkosten",
      vatRate: 19,
      confidence: 0,
    },
  );
  const [paymentType, setPaymentType] = useState<Expense["paymentType"]>(
    initial ? initial.paymentType || state.expenses.find(e => e.id === initial.expenseId)?.paymentType || "unbekannt" : "privat vorgestreckt",
  );
  const [tripId, setTripId] = useState<string | undefined>(initial?.tripId);
  const [scanning, setScanning] = useState(false);
  const [readingReceipt, setReadingReceipt] = useState(false);
  const saving = useRef(false);
  const [progress, setProgress] = useState(0);
  const [scanStatus, setScanStatus] = useState("");
  const [scanError, setScanError] = useState("");
  usePendingWork(true);

  const selectedTripId = tripId;
  const duplicateReceipt = receipt
    ? state.expenses.some(
        (expense) =>
          expense.id !== initial?.expenseId &&
          expense.receipt?.hash === receipt.hash,
      ) ||
      state.receiptInbox.some(
        (item) => item.id !== initial?.id && item.receipt.hash === receipt.hash,
      )
    : false;

  const similarReceipt = similarExpense(state.expenses, {...suggestion, id:initial?.expenseId});
  const setSuggestion = (next: typeof suggestion) => {
    for (const key of Object.keys(next) as (keyof typeof suggestion)[]) if (next[key] !== suggestion[key]) editedFields.current.add(key);
    setSuggestionState(next);
  };
  const scanRevision = useRef(0);
  const editedFields = useRef(new Set<string>());
  useEffect(() => () => { scanRevision.current++; fileRevision.current++; }, []);
  const scan = async (nextReceipt: NonNullable<typeof receipt>) => {
    if (!/^image\/(jpeg|jpg|png|webp)$/i.test(nextReceipt.type)) {
      setScanError(
        "Dieser Dateityp kann gespeichert, aber nicht automatisch gelesen werden.",
      );
      return;
    }
    const revision = ++scanRevision.current;
    setScanning(true);
    setScanError("");
    try {
      const recognized = await recognizeReceiptLocally(
        nextReceipt.dataUrl,
        (value, status) => {
          if (revision !== scanRevision.current) return;
          setProgress(value);
          setScanStatus(status);
        },
      );
      const learned = applyMerchantRule(recognized, state.merchantRules);
      if (revision !== scanRevision.current) return;
      setSuggestionState(current => ({...current, ...Object.fromEntries(Object.entries(learned.suggestion).filter(([key]) => !editedFields.current.has(key)))}));

    } catch {
      if (revision !== scanRevision.current) return;
      setScanError(
        "Die automatische Erkennung war nicht möglich. Der Beleg kann trotzdem gespeichert und manuell bestätigt werden.",
      );
    } finally {
      if (revision === scanRevision.current) setScanning(false);
    }
  };

  const fileRevision = useRef(0);
  const chooseFile = async (file?: File) => {
    if (!file) return;
    const revision = ++fileRevision.current;
    scanRevision.current++;
    editedFields.current.clear();
    setReadingReceipt(true);
    setScanning(false);
    try {
      const nextReceipt = {id: initial?.receipt.id || uid(), ...await readReceiptFile(file)};
      if (revision !== fileRevision.current) return;
      setReceipt(nextReceipt);
      void scan(nextReceipt);
    } catch {
      if (revision === fileRevision.current) setScanError("Beleg konnte nicht gelesen werden. Bitte erneut auswählen.");
    } finally { if (revision === fileRevision.current) setReadingReceipt(false); }
  };

  const buildInboxItem = (
    status: ReceiptInboxItem["status"],
    expenseId?: string,
  ): ReceiptInboxItem => ({
    id: initial?.id || uid(),
    receipt: receipt!,
    capturedAt: initial?.capturedAt || new Date().toISOString(),
    status,
    suggestion,
    tripId: selectedTripId || undefined,
    expenseId,
    paymentType,
    notes: initial?.notes || "",
  });

  const saveInbox = () => {
    if (!receipt || readingReceipt || saving.current) return;
    const duplicate = duplicateMessage(state, {id:initial?.expenseId, receipt}, initial?.id);
    if (duplicate) return notify(duplicate);
    saving.current = true;
    const item = buildInboxItem(suggestion.rawText ? "erkannt" : "neu");
    update((s) => {
      const index = s.receiptInbox.findIndex((entry) => entry.id === item.id);
      if (index >= 0) s.receiptInbox[index] = item;
      else s.receiptInbox.push(item);
      return s;
    });
    notify("Beleg im Eingang gespeichert", () =>
      update((s) => {
        if (initial) {
          const index = s.receiptInbox.findIndex(
            (entry) => entry.id === initial.id,
          );
          if (index >= 0) s.receiptInbox[index] = initial;
        } else
          s.receiptInbox = s.receiptInbox.filter(
            (entry) => entry.id !== item.id,
          );
        return s;
      }),
    );
    if (onDone) onDone(); else close();
  };

  const createExpenseFromReceipt = () => {
    if (readingReceipt || scanning || saving.current) return;
    if (!receipt || !(suggestion.gross && Number.isFinite(suggestion.gross) && suggestion.gross > 0) || !validDate(suggestion.date)) {
      notify("Bitte Datum und Betrag bestätigen");
      return;
    }
    const problem = linkingErrors({...suggestion, date:suggestion.date!, category:suggestion.category || ""})[0] || duplicateMessage(state, {id:initial?.expenseId, receipt, merchant:suggestion.merchant, invoiceNumber:suggestion.invoiceNumber}, initial?.id);
    if (problem) return notify(problem);
    const vatRate = suggestion.vatRate ?? 19;
    const net = round2(suggestion.gross / (1 + vatRate / 100));
    const expenseId = initial?.expenseId || uid();
    const duplicate = duplicateReceipt || !!similarReceipt;
    const merchantPattern = suggestion.merchant
      ?.toLowerCase()
      .trim()
      .slice(0, 40);
    const previousMerchantRule = merchantPattern
      ? structuredClone(
          state.merchantRules.find(
            (entry) => entry.merchantPattern === merchantPattern,
          ),
        )
      : undefined;
    const previousExpense = state.expenses.find(e => e.id === expenseId);
    const expense: Expense = {
      ...previousExpense,
      ...cleanContext(suggestion),
      id: expenseId,
      date: suggestion.date!,
      tripId: selectedTripId || undefined,
      category: suggestion.category || "sonstige Nebenkosten",
      description: suggestion.merchant || "Fotografierter Beleg",
      gross: suggestion.gross,
      net,
      vatRate,
      vat: round2(suggestion.gross - net),
      currency: "EUR",
      exchangeRate: 1,
      paymentType,
      paidBy:
        paymentPayer(paymentType),
      reimbursementStatus:
        paymentType === "privat vorgestreckt"
          ? "offen"
          : "nicht erstattungsfähig",
      merchant: suggestion.merchant,
      invoiceNumber: suggestion.invoiceNumber,
      businessShare: 100,
      notes: previousExpense?.notes || "Aus Beleg-Eingang übernommen",
      receipt,
      status: duplicate ? "ungeprüft" : "vollständig",
      warnings: duplicate ? ["Möglicher doppelter Beleg"] : [],
    };
    saving.current = true;
    const item = buildInboxItem("zugeordnet", expense.id);
    update((s) => {
      const expenseIndex = s.expenses.findIndex(
        (entry) => entry.id === expense.id,
      );
      if (expenseIndex >= 0) s.expenses[expenseIndex] = expense;
      else s.expenses.push(expense);
      const inboxIndex = s.receiptInbox.findIndex(
        (entry) => entry.id === item.id,
      );
      if (inboxIndex >= 0) s.receiptInbox[inboxIndex] = item;
      else s.receiptInbox.push(item);
      if (merchantPattern) {
        const rule = s.merchantRules.find(
          (entry) => entry.merchantPattern === merchantPattern,
        );
        if (rule) {
          rule.category = expense.category;
          rule.paymentType = paymentType;
          rule.vatRate = vatRate;
          rule.uses += 1;
          rule.updatedAt = new Date().toISOString();
        } else {
          s.merchantRules.push({
            id: uid(),
            merchantPattern,
            category: expense.category,
            paymentType,
            vatRate,
            uses: 1,
            updatedAt: new Date().toISOString(),
          });
        }
      }
      return s;
    });
    notify(`${expense.category}: ${euro(expense.gross)} übernommen`, () =>
      update((s) => {
        s.expenses = s.expenses.filter((entry) => entry.id !== expense.id);
        if (previousExpense) s.expenses.push(previousExpense);
        if (initial) {
          const index = s.receiptInbox.findIndex(
            (entry) => entry.id === initial.id,
          );
          if (index >= 0) s.receiptInbox[index] = initial;
        } else
          s.receiptInbox = s.receiptInbox.filter(
            (entry) => entry.id !== item.id,
          );
        if (merchantPattern) {
          s.merchantRules = s.merchantRules.filter(
            (entry) => entry.merchantPattern !== merchantPattern,
          );
          if (previousMerchantRule) s.merchantRules.push(previousMerchantRule);
        }
        return s;
      }),
    );
    if (onDone) onDone(); else close();
  };

  return (
    <div
      className="quick-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && close()}
    >
      <section
        className="receipt-capture"
        aria-label="Beleg fotografieren und zuordnen"
      >
        <header>
          <div>
            <p className="eyebrow">Beleg-Eingang{position ? ` · ${position}` : ""}</p>
            <h2>
              {initial ? "Beleg prüfen" : "Fotografieren – den Rest später"}
            </h2>
          </div>
          <button className="icon" onClick={close} aria-label="Schließen">
            <X />
          </button>
        </header>
        {!receipt ? (
          <label className="camera-stage">
            <div>
              <Camera size={42} />
              <h3>Beleg fotografieren</h3>
              <p>Auf dem Smartphone oder iPad öffnet sich direkt die Kamera.</p>
              <span className="primary">Kamera öffnen</span>
            </div>
            <input
              type="file"
              accept=".jpg,.jpeg,.png,.webp,.heic,.pdf,image/*"
              capture="environment"
              onChange={(event) => chooseFile(event.target.files?.[0])}
            />
          </label>
        ) : (
          <div className="receipt-workspace">
            <div className="receipt-preview">
              {receipt.type.startsWith("image/") &&
              !receipt.type.includes("heic") ? (
                // Data-URLs aus der lokalen IndexedDB benötigen keine Bildoptimierung.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={receipt.dataUrl} alt="Fotografierter Beleg" />
              ) : (
                <div>
                  <ReceiptText size={40} />
                  <b>{receipt.name}</b>
                </div>
              )}
              <label>
                <Camera size={16} />
                Neu fotografieren
                <input
                  type="file"
                  accept="image/*,.pdf"
                  capture="environment"
                  onChange={(event) => chooseFile(event.target.files?.[0])}
                />
              </label>
            </div>
            <div className="receipt-fields">
              {scanning && (
                <div className="ocr-progress">
                  <ScanLine size={18} />
                  <div>
                    <b>Beleg wird lokal gelesen … {progress}%</b>
                    <span>{scanStatus}</span>
                    <i>
                      <em style={{ width: `${progress}%` }} />
                    </i>
                  </div>
                </div>
              )}
              {scanError && (
                <div className="info-box yellow">
                  <AlertTriangle />
                  <div>
                    <b>Manuelle Bestätigung</b>
                    <p>{scanError}</p>
                  </div>
                </div>
              )}
              {(duplicateReceipt || similarReceipt) && (
                <div className="info-box yellow">
                  <Copy size={18} />
                  <div>
                    <b>Möglicher doppelter Beleg</b>
                    <p>
                      Datei oder Rechnungsangaben passen zu einem vorhandenen Beleg. Bitte vor erneutem Erfassen prüfen.
                    </p>
                  </div>
                </div>
              )}
              {!scanning && suggestion.confidence > 0 && (
                <div className="ocr-result">
                  <Sparkles size={17} />
                  <span>
                    <b>{suggestion.confidence}% Erkennungsqualität</b> – bitte
                    Vorschläge kurz bestätigen.
                  </span>
                </div>
              )}
              <div className="receipt-form">
                <label>
                  Datum
                  <input
                    type="date"
                    value={suggestion.date || ""}
                    onChange={(event) =>
                      setSuggestion({ ...suggestion, date: event.target.value })
                    }
                  />
                </label>
                <label>
                  Betrag (€)
                  <input
                    inputMode="decimal"
                    type="number"
                    step="0.01"
                    value={suggestion.gross || ""}
                    onChange={(event) =>
                      setSuggestion({
                        ...suggestion,
                        gross: Number(event.target.value),
                      })
                    }
                  />
                </label>
                <label className="wide">
                  Händler
                  <input
                    value={suggestion.merchant || ""}
                    onChange={(event) =>
                      setSuggestion({
                        ...suggestion,
                        merchant: event.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Kategorie
                  <select
                    aria-label="Kategorie"
                    value={suggestion.category || "sonstige Nebenkosten"}
                    onChange={(event) =>
                      setSuggestion({
                        ...suggestion,
                        category: event.target.value,
                      })
                    }
                  >
                    {expenseCategories.map((category) => (
                      <option key={category} value={category}>{category === "Hotel" ? "Hotel / Übernachtung" : category}</option>
                    ))}
                  </select>
                </label>
                <label>Rechnungsnummer<input value={suggestion.invoiceNumber || ""} onChange={e=>setSuggestion({...suggestion, invoiceNumber:e.target.value})} /></label>
                <PaymentSelect value={paymentType} onChange={setPaymentType} />
                <ReceiptLinkFields value={{...suggestion, category:suggestion.category || "", date:suggestion.date || "", tripId:selectedTripId}} onChange={patch => {
                  const {tripId:nextTrip, ...context} = patch;
                  if ("tripId" in patch) setTripId(nextTrip);
                  setSuggestion({...suggestion, ...context});
                }} trips={state.trips} />
              </div>
            </div>
          </div>
        )}
        {receipt && (
          <footer>
            <button className="ghost" onClick={saveInbox} disabled={readingReceipt}>
              <Inbox size={17} />
              Nur im Eingang speichern
            </button>
            <button
              className="primary"
              onClick={createExpenseFromReceipt}
              disabled={scanning || readingReceipt}
            >
              <Check size={18} />
              Bestätigen & Ausgabe anlegen
            </button>
          </footer>
        )}
        <p className="local-ocr-note">
          <ShieldCheck size={14} />
          Der Beleg bleibt auf diesem Gerät. Für die Texterkennung wird beim
          ersten Einsatz einmalig ein Sprachmodell geladen.
        </p>
      </section>
    </div>
  );
}

function ImportWizard({
  state,
  confirmImport,
  notify,
  go,
}: {
  state: AppState;
  confirmImport: (trips: Trip[], profile: import("../lib/types").ImportProfile, vimcar: boolean) => ReturnType<typeof commitTripImport>;
  notify: (s: string) => void;
  go: (t: Tab) => void;
}) {
  const [step, setStep] = useState(1);
  const [file, setFile] = useState<File>();
  const [sheets, setSheets] = useState<
    Record<string, Record<string, unknown>[]>
  >({});
  const [sheet, setSheet] = useState("");
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [profileName, setProfileName] = useState("Mein Fahrtenbuch");
  const [format, setFormat] = useState<"vimcar" | "generic">("generic");
  const [result, setResult] = useState<{
    trips: Trip[];
    duplicates: number;
    invalid: number;
    ignoredCommute: number;
    ignoredPrivate: number;
    format: "vimcar" | "generic";
  }>();
  const [error, setError] = useState("");
  const [rowNumbers, setRowNumbers] = useState<Record<string, number[]>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, number[]>>({});
  const [parseWarning, setParseWarning] = useState("");
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState(new Set<number>());
  const [saving, setSaving] = useState(false);
  const [reading, setReading] = useState(false);
  const choosing = useRef(0);
  const submitting = useRef(false);
  usePendingWork(step > 1 && step < 5 || saving || reading);
  const rows = sheets[sheet] || [];
  const converted = useMemo(() => rowsToTrips(rows, mapping, state.trips, state.settings.vehicles,
    state.settings.defaultVehicleId, state.settings.homeAddress, state.settings.firstWorkplace, rowErrors[sheet] || []),
    [rows, mapping, state.trips, state.settings, rowErrors, sheet]);
  const eligible = converted.review.filter((row) => row.status === "ready");
  const selectedTrips = eligible.filter((row) => selected.has(row.index)).map((row) => row.trip!);
  const prepareReview = () => { setSelected(new Set(eligible.map((row) => row.index))); setFilter("all"); setError(""); setStep(4); };
  const cancel = () => { if (submitting.current) return; choosing.current++; setReading(false); setStep(1); setFile(undefined); setSheets({}); setSelected(new Set()); setError(""); };
  const headers = rows[0] ? Object.keys(rows[0]) : [];
  const choose = async (f?: File) => {
    if (!f) return;
    const attempt = ++choosing.current;
    setReading(true); setError("");
    setFile(f);
    try {
      const parsed = await parseImportFile(f);
      if (attempt !== choosing.current) return;
      setRowNumbers(parsed.rowNumbers); setRowErrors(parsed.rowErrors); setParseWarning(parsed.warning || "");
      setFormat(parsed.format);
      if (parsed.format === "vimcar") setProfileName("Vimcar CSV");
      setSheets(parsed.sheets);
      const first = Object.keys(parsed.sheets)[0];
      setSheet(first);
      setMapping(suggestMapping(Object.keys(parsed.sheets[first]?.[0] || {})));
      setStep(2);
    } catch (e) {
      if (attempt !== choosing.current) return;
      setError(
        e instanceof Error ? e.message : "Datei konnte nicht gelesen werden.",
      );
    } finally { if (attempt === choosing.current) setReading(false); }
  };
  const applyProfile = (id: string) => {
    const p = state.profiles.find((x) => x.id === id);
    if (p) {
      setMapping(p.mapping);
      setProfileName(p.name);
    }
  };
  const doImport = async () => {
    if (submitting.current || !selectedTrips.length) return;
    submitting.current = true; setSaving(true); setError("");
    try {
      const committed = await confirmImport(selectedTrips, { id: uid(), name: profileName, mapping,
        createdAt: new Date().toISOString() }, format === "vimcar");
      setResult({ ...converted, trips: committed.trips, duplicates: converted.duplicates + committed.duplicates });
      setStep(5); notify(`${committed.trips.length} Fahrten importiert`);
    } catch (error) {
      setError(`Import nicht gespeichert. Es wurden keine Teilmengen übernommen. ${error instanceof Error ? error.message : "Bitte erneut versuchen."}`);
    } finally { submitting.current = false; setSaving(false); }
  };
  return (
    <div className="flow-layout">
      <section className="card flow-card">
        <div className="steps">
          {["Datei", "Tabelle", "Zuordnung", "Vorschau", "Fertig"].map(
            (x, i) => (
              <div className={step >= i + 1 ? "done" : ""} key={x}>
                <span>{step > i + 1 ? <Check size={15} /> : i + 1}</span>
                <b>{x}</b>
              </div>
            ),
          )}
        </div>
        {step === 1 && (
          <div className="drop-zone">
            <Upload size={36} />
            <h2>Fahrtenbuch auswählen</h2>
            <p>
              Vimcar-CSV, XLSX oder CSV. Für Vimcar-Spesen benötigen wir
              den CSV-Export mit Abfahrts- und Ankunftszeiten.
            </p>
            <label className="primary file-button">
              Datei auswählen
              <input
                type="file"
                accept=".xlsx,.csv,.pdf"
                onChange={(e) => choose(e.target.files?.[0])}
              />
            </label>
            {reading && <p role="status">Datei wird lokal gelesen …</p>}
            {error && (
              <div className="error-box">
                <AlertTriangle />
                {error}
              </div>
            )}
          </div>
        )}
        {step === 2 && (
          <div className="wizard-body">
            <p className="eyebrow">Datei erkannt</p>
            <h2>{file?.name}</h2>
            <div className="field-row">
              <label>
                Tabellenblatt
                <select
                  value={sheet}
                  onChange={(e) => {
                    setSheet(e.target.value);
                    setMapping(
                      suggestMapping(
                        Object.keys(sheets[e.target.value]?.[0] || {}),
                      ),
                    );
                  }}
                >
                  {Object.keys(sheets).map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label>
                Gespeichertes Importprofil
                <select
                  defaultValue=""
                  onChange={(e) => applyProfile(e.target.value)}
                >
                  <option value="">Automatisch zuordnen</option>
                  {state.profiles.map((p) => (
                    <option value={p.id} key={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="info-box">
              <FileSpreadsheet />
              <div>
                <b>
                  {rows.length} Datenzeilen · {headers.length} Spalten
                </b>
                {format === "vimcar" && (
                  <p>
                    <b>Vimcar-Export automatisch erkannt.</b> Betrieb,
                    Arbeitsweg und Privat werden getrennt ausgewertet.
                  </p>
                )}
                <p>
                  Kopfzeile erkannt: {headers.slice(0, 6).join(", ")}
                  {headers.length > 6 ? " …" : ""}
                </p>
              </div>
            </div>
            <WizardNav back={() => setStep(1)} next={() => setStep(3)} />
          </div>
        )}
        {step === 3 && (
          <div className="wizard-body">
            <p className="eyebrow">Spaltenzuordnung kontrollieren</p>
            <h2>
              {Object.keys(mapping).length} von {canonicalFields.length} Feldern
              erkannt
            </h2>
            <div className="mapping-grid">
              {canonicalFields.map(([field, label]) => (
                <label key={field}>
                  <span>
                    {label}
                    {[
                      "date",
                      "startTime",
                      "endTime",
                      "destination",
                      "purpose",
                    ].includes(field) && <em> wichtig</em>}
                  </span>
                  <select
                    value={mapping[field] || ""}
                    onChange={(e) =>
                      setMapping({ ...mapping, [field]: e.target.value })
                    }
                  >
                    <option value="">Nicht importieren</option>
                    {headers.map((h) => (
                      <option key={h}>{h}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <label>
              Profilname
              <input
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
              />
            </label>
            <WizardNav
              back={() => setStep(2)}
              next={prepareReview}
              disabled={!mapping.date}
            />
          </div>
        )}
        {step === 4 && (
          <div className="wizard-body">
            <p className="eyebrow">Import prüfen · {file?.name}</p>
            <h2>{rows.length} Datenzeilen · {selectedTrips.length} ausgewählt</h2>
            <div className="result-grid review-counts">
              <div><b>{eligible.length}</b><span>Bereit</span></div>
              <div><b>{converted.duplicates}</b><span>Duplikate</span></div>
              <div><b>{converted.ignoredPrivate + converted.ignoredCommute}</b><span>Privat / Arbeitsweg ausgeschlossen</span></div>
              <div><b>{converted.invalid}</b><span>Ungültig</span></div>
              <div><b>{eligible.filter((row) => row.trip!.warnings.length).length}</b><span>Mit Prüfhinweisen</span></div>
            </div>
            {parseWarning && <p className="warning-line">{parseWarning} · fehlerhafte Zeilen bitte in der Quelle korrigieren.</p>}
            <div className="review-controls">
              <label>Status filtern<select value={filter} onChange={(e) => setFilter(e.target.value)}>
                <option value="all">Alle Zeilen</option><option value="ready">Bereit</option><option value="duplicate">Duplikate</option>
                <option value="excluded">Ausgeschlossen</option><option value="invalid">Ungültig</option><option value="warning">Prüfhinweise</option>
              </select></label>
              <button disabled={saving} onClick={() => setSelected(new Set(eligible.map((row) => row.index)))}>Alle bereiten auswählen</button>
              <button disabled={saving} onClick={() => setSelected(new Set())}>Auswahl aufheben</button>
            </div>
            <div className="table-wrap import-review"><table><thead><tr><th>Übernehmen</th><th>Quellzeile</th><th>Datum / Zeit</th><th>Fahrt / km</th><th>Status / Erklärung</th></tr></thead><tbody>
              {converted.review.filter((row) => filter === "all" || row.status === filter || filter === "warning" && row.trip?.warnings.length).map((row) => <tr key={row.index}>
                <td><input type="checkbox" aria-label={`Zeile ${rowNumbers[sheet]?.[row.index] || row.index + 2} übernehmen`}
                  disabled={saving || row.status !== "ready"} checked={row.status === "ready" && selected.has(row.index)}
                  onChange={(e) => setSelected((old) => { const next = new Set(old); if (e.target.checked) next.add(row.index); else next.delete(row.index); return next; })} /></td>
                <td>{rowNumbers[sheet]?.[row.index] || row.index + 2}</td>
                <td>{dateDe(row.date || "")}<small>{`${row.startTime || "Zeit offen"} – ${row.endTime || "Zeit offen"}${row.trip?.endDate ? " · " + dateDe(row.trip.endDate) : ""}`}</small></td>
                <td>{row.classification || "Nicht erkannt"}<small>{row.trip ? `${row.trip.startPlace || "Start offen"} → ${row.trip.destination || "Ziel offen"} · ${row.trip.businessKm.toLocaleString("de-DE")} km` : `${(row.distance || 0).toLocaleString("de-DE")} km`}</small></td>
                <td><b>{{ready:"Bereit",duplicate:"Duplikat",excluded:"Ausgeschlossen",invalid:"Ungültig"}[row.status]}</b><small>{row.reason}</small></td>
              </tr>)}
            </tbody></table></div>
            {error && <div className="error-box" role="alert">{error}</div>}
            <div className="info-box yellow">
              <AlertTriangle />
              <div>
                <b>
                  {format === "vimcar"
                    ? "Spesenlogik für Vimcar"
                    : "Zeitbedeutung noch zu bestätigen"}
                </b>
                {format === "vimcar" ? (
                  <p>
                    Importiert werden nur Betriebsfahrten. Die Tagesabwesenheit
                    läuft von der ersten bis zur letzten Betriebsfahrt;
                    Arbeitsweg und Privatfahrten werden nicht als Reisekosten
                    angesetzt.
                  </p>
                ) : (
                  <p>
                    Importierte Start- und Endzeiten werden nicht ungeprüft als
                    steuerliche Abwesenheitsdauer übernommen. Die Tage erhalten
                    einen Prüfhinweis.
                  </p>
                )}
              </div>
            </div>
            <div className="wizard-nav">
              <button disabled={saving} onClick={() => setStep(3)}>Zurück zur Zuordnung</button>
              <button disabled={saving} onClick={cancel}>Import abbrechen</button>
              <button className="primary" disabled={saving || !selectedTrips.length} onClick={() => void doImport()}>
                {saving ? "Wird gespeichert …" : `${selectedTrips.length} Fahrten importieren`}
              </button>
            </div>
          </div>
        )}
        {step === 5 && (
          <div className="success-state">
            <div className="success-icon">
              <Check />
            </div>
            <h2>Import abgeschlossen</h2>
            <p>
              {result?.trips.length || 0} Fahrten wurden übernommen.
            </p>
            <div className="result-grid">
              <div>
                <b>{result?.duplicates || 0}</b>
                <span>Duplikate übersprungen</span>
              </div>
              <div>
                <b>{result?.invalid || 0}</b>
                <span>ungültige Zeilen</span>
              </div>
              {result && (
                <>
                  <div>
                    <b>{result.ignoredCommute}</b>
                    <span>Arbeitsweg-Zeilen nicht angesetzt</span>
                  </div>
                  <div>
                    <b>{result.ignoredPrivate}</b>
                    <span>Privatfahrten nicht angesetzt</span>
                  </div>
                </>
              )}
              <div>
                <b>{profileName}</b>
                <span>{result?.trips.length ? "Profil gespeichert" : "Keine neuen Daten gespeichert"}</span>
              </div>
            </div>
            <button className="primary" onClick={() => go("Monatsübersicht")}>
              Zur Monatsübersicht
              <ChevronRight size={18} />
            </button>
          </div>
        )}
      </section>
      <aside className="side-help">
        <h3>Was passiert beim Import?</h3>
        <ol>
          <li>Die Datei wird nur in Ihrem Browser gelesen.</li>
          <li>Spalten werden automatisch vorgeschlagen.</li>
          <li>Duplikate werden anhand mehrerer Merkmale verhindert.</li>
          <li>Unklare Abwesenheitszeiten bleiben zur Bestätigung offen.</li>
        </ol>
        <p>
          <b>Vimcar-Profil eingerichtet.</b>
          <br />
          Der bereitgestellte CSV-Aufbau mit 29 Spalten ist fest zugeordnet. Der
          PDF-Bericht enthält keine Uhrzeiten und dient deshalb nur als
          Nachweis, nicht als Quelle der Spesenberechnung.
        </p>
      </aside>
    </div>
  );
}
function WizardNav({
  back,
  next,
  disabled,
  nextLabel = "Weiter",
}: {
  back: () => void;
  next: () => void;
  disabled?: boolean;
  nextLabel?: string;
}) {
  return (
    <div className="wizard-nav">
      <button className="ghost" onClick={back}>
        Zurück
      </button>
      <button className="primary" disabled={disabled} onClick={next}>
        {nextLabel}
        <ChevronRight size={17} />
      </button>
    </div>
  );
}
function DataTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: Record<string, unknown>[];
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {headers.map((h) => (
                <td key={h}>{String(r[h] ?? "")}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const blankTrip = (settings: AppState["settings"]): Trip => {
  const vehicle = (settings.vehicles || []).find(
    (item) => item.id === settings.defaultVehicleId,
  );
  return {
    id: uid(),
    date: new Date().toLocaleDateString("sv-SE"),
    endDate: new Date().toLocaleDateString("sv-SE"),
    startTime: "08:00",
    endTime: "17:00",
    startPlace: "",
    destination: "",
    purpose: "",
    customer: "",
    order: "",
    costCenter: "",
    plate: vehicle?.plate || "",
    vehicle: vehicle?.name || "",
    vehicleId: vehicle?.id,
    vehicleType:
      vehicle?.ownership === "privatwagen"
        ? "privatfahrzeug"
        : "firmenfahrzeug",
    businessKm: 0,
    privateKm: 0,
    tripType: "dienstlich",
    notes: "",
    overnight: false,
    absenceConfirmed: false,
    meals: { breakfast: false, lunch: false, dinner: false },
    status: "ungeprüft",
    sourceHash: "",
    importedAt: new Date().toISOString(),
    warnings: [],
  };
};

/** Reisefenster (Neu, Bearbeiten, Löschen) über der Monatsübersicht. */
function Trips({
  state,
  update,
  notify,
  editing,
  setEditing,
  onSaved,
}: {
  state: AppState;
  update: (f: (s: AppState) => AppState) => void;
  notify: (s: string) => void;
  editing: Trip | null;
  setEditing: (trip: Trip | null) => void;
  onSaved?: () => void;
}) {
  usePendingWork(!!editing);
  // Stapelerfassung: Anzahl der in dieser Runde gespeicherten Reisen; endet, wenn das Fenster schließt.
  const [batch, setBatch] = useState(0);
  useEffect(() => { if (!editing) setBatch(0); }, [editing]);
  const save = (next = false) => {
    if (!editing || manualTripErrors(editing, state.trips.find(t => t.id === editing.id)?.order).length) return;
    const t = {
      ...editing,
      sourceHash: duplicateKey(editing),
      warnings: [...validateTrip(editing), ...manualTripReviewNotes(editing)],
      status: "ungeprüft" as ReviewStatus,
    };
    update((s) => {
      const i = s.trips.findIndex((x) => x.id === t.id);
      if (i >= 0) {
        s.changes.push({
          id: uid(),
          entityType: "trip",
          entityId: t.id,
          field: "Gesamtdatensatz",
          oldValue: s.trips[i],
          newValue: t,
          reason: "Manuelle Bearbeitung",
          user: s.settings.profileName || "Lokales Profil",
          changedAt: new Date().toISOString(),
        });
        s.trips[i] = t;
      } else s.trips.push(t);
      return s;
    });
    if (next) {
      setEditing(nextTripDraft(t, blankTrip(state.settings)));
      setBatch((n) => n + 1);
      focusFirstField();
      notify("Reise gespeichert – weiter mit der nächsten.");
      return;
    }
    setEditing(null);
    notify("Reise gespeichert. Eine Hotelrechnung bei Bedarf über „Hotelrechnung erfassen“ ergänzen; es wird keine Übernachtungspauschale hinzugefügt.");
    onSaved?.();
  };
  const del = (id: string) =>
    update((s) => removeTrip(s, id, { id: uid(), user: s.settings.profileName || "Lokales Profil", at: new Date().toISOString() }));
  // Aus dem Bearbeitungsfenster: mit Rückfrage, danach schließen.
  const deleteEditing = () => {
    if (!editing || !state.trips.some((t) => t.id === editing.id)) return;
    const linked = linkedExpenseCount(state, editing.id);
    if (!window.confirm(`Reise vom ${dateDe(editing.date)}${editing.destination ? ` nach ${editing.destination}` : ""} löschen?${linked ? ` ${linked === 1 ? "Eine zugeordnete Kostenposition bleibt" : `${linked} zugeordnete Kostenpositionen bleiben`} erhalten, aber ohne Reisezuordnung.` : ""} Gespeicherte Abrechnungen bleiben unverändert.`)) return;
    del(editing.id);
    setEditing(null);
    notify("Reise gelöscht. Die Löschung steht im Änderungsprotokoll.");
  };
  return (
    <>
      {editing && (
        <Modal
          title={
            state.trips.some((t) => t.id === editing.id)
              ? "Reise bearbeiten"
              : "Neue Dienstreise"
          }
          close={() => setEditing(null)}
          onSubmitShortcut={() => save(true)}
          wide
        >
          <TripForm
            key={editing.id}
            trip={editing}
            setTrip={setEditing}
            settings={state.settings}
            trips={state.trips}
          />
          <div className="modal-actions">
            <BatchCount count={batch} noun={["Reise", "Reisen"]} />
            {state.trips.some((t) => t.id === editing.id) && <button className="ghost danger modal-delete" onClick={deleteEditing}><Trash2 size={16} /> Reise löschen</button>}
            <button className="ghost" onClick={() => setEditing(null)}>
              Abbrechen
            </button>
            <button className="ghost batch-next" onClick={() => save(true)} disabled={!!manualTripErrors(editing, state.trips.find(t => t.id === editing.id)?.order).length} title="Strg+Enter">
              <Plus size={17} />
              Speichern & nächste
            </button>
            <button className="primary" onClick={() => save()} disabled={!!manualTripErrors(editing, state.trips.find(t => t.id === editing.id)?.order).length}>
              <Save size={17} />
              Speichern & fertig
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

function TripForm({ trip, setTrip, settings, trips }: {
  trip: Trip; setTrip: (t: Trip) => void; settings: AppState["settings"]; trips: Trip[];
}) {
  const set = <K extends keyof Trip>(k: K, v: Trip[K]) => setTrip({ ...trip, [k]: v });
  const originalProject = trips.find(t => t.id === trip.id)?.order;
  const existing = originalProject !== undefined;
  const errors = manualTripErrors(trip, originalProject);
  // Vor der ersten Eingabe keine roten Fehler, nur ein ruhiger Hinweis auf die Pflichtangaben.
  const [initial] = useState(() => JSON.stringify(trip));
  const untouched = !existing && JSON.stringify(trip) === initial;
  const interval = manualTripInterval(trip);
  const days = errors.length ? [] : [...groupTripsByDay([trip])].map(([date, dayTrips]) => calculateDay(date, dayTrips, settings));
  const selectedVehicle = settings.vehicles.find(v => v.id === trip.vehicleId);
  const duration = (minutes: number) => `${Math.floor(minutes / 60)} Std. ${minutes % 60} Min.`;
  const suggestedDestination = useRef(projectPlace(trip.order));
  const changeProject = (value: string) => {
    const place = projectPlace(value);
    const useSuggestion = !trip.destination || trip.destination === suggestedDestination.current;
    setTrip({ ...trip, order: value, destination: useSuggestion && place ? place : trip.destination });
    if (place) suggestedDestination.current = place;
  };
  return (
    // Zweispaltig: links die Eingaben, rechts Abwesenheit und Verpflegungsvorschau – passt ohne Scrollen auf übliche Bildschirme.
    <div className="manual-trip trip-layout">
    <div className="form-grid trip-fields">
      <p className="wide trip-intro">Pflichtangaben mit *. Erfasst wird die berufliche Abwesenheit von Wohnung und erster Tätigkeitsstätte.</p>
      <label className="wide">Projekt *
        <input aria-label="Projekt *" required list="trip-projects" placeholder="26.0123 Musterstadt" title="Nummer und Ort, frei eingeben oder bisheriges Projekt auswählen" value={trip.order} onChange={e => changeProject(e.target.value)} />
        <datalist id="trip-projects">{projectSuggestions(trips).map(p => <option key={p} value={p} />)}</datalist>
        {existing && !projectPlace(trip.order) && <small>Vorhandene Projektangabe kann unverändert bleiben.</small>}
      </label>
      <label>Reisegrund *<input required value={trip.purpose} onChange={e => set("purpose", e.target.value)} /></label>
      <label>Reiseziel *<input aria-label="Reiseziel *" required title="Projektort vorgeschlagen, frei überschreibbar. Vorschau nur für Inland." value={trip.destination} onChange={e => set("destination", e.target.value)} /></label>
      <div className="wide trip-times">
      <label>Abfahrt Datum *<input required type="date" value={trip.date} onChange={e => setTrip({...trip, date: e.target.value, endDate: !trip.endDate || trip.endDate === trip.date ? e.target.value : trip.endDate})} /></label>
      <label>Abfahrt Uhrzeit *<input required type="time" step="1" value={trip.startTime} onChange={e => set("startTime", e.target.value)} /></label>
      <label>Rückkehr Datum *<input required type="date" value={trip.endDate || trip.date} onChange={e => set("endDate", e.target.value)} /></label>
      <label>Rückkehr Uhrzeit *<input required type="time" step="1" value={trip.endTime} onChange={e => set("endTime", e.target.value)} /></label>
      </div>
      {(!!interval?.nights || trip.overnight) && <div className="wide trip-overnight">
        <label className="check"><input type="checkbox" checked={trip.overnight} onChange={e => set("overnight", e.target.checked)} />{interval?.nights === 1 ? "Auswärtige Übernachtung zwischen Abfahrt und Rückkehr tatsächlich erfolgt" : `Alle ${interval?.nights || 0} auswärtigen Übernachtungen zwischen Abfahrt und Rückkehr tatsächlich erfolgt`}</label>
        <small>Nächte: {days.slice(0,-1).map(d => dateDe(d.date)).join(" · ")} (jeweils auf den Folgetag). Bei abweichenden oder fehlenden Übernachtungen nicht bestätigen; Einzelheiten in Notizen festhalten.</small>
      </div>}
      <MealEditor trip={trip} setTrip={setTrip} />
      <details className="wide"><summary>Weitere Angaben · Fahrzeug, Korrekturen und Notizen</summary><div className="form-grid">
      <label>Startort<input value={trip.startPlace} onChange={e => set("startPlace", e.target.value)} /></label>
      <label>Kunde<input value={trip.customer} onChange={e => set("customer", e.target.value)} /></label>
      <label className="wide">Notizen / abweichende Übernachtungen<textarea value={trip.notes} onChange={e => set("notes", e.target.value)} /></label>
      <label>
        Verwendetes Fahrzeug
        <select
          value={trip.vehicleId || ""}
          onChange={(e) => {
            const vehicle = settings.vehicles.find(
              (item) => item.id === e.target.value,
            );
            // „Bisher: …“ / „Bitte Fahrzeug auswählen“ heißt: unverändert lassen.
            if (!vehicle) return;
            setTrip({
              ...trip,
              vehicleId: vehicle.id,
              vehicle: vehicle.name,
              plate: vehicle.plate,
              vehicleType:
                vehicle.ownership === "privatwagen"
                  ? "privatfahrzeug"
                  : "firmenfahrzeug",
            });
          }}
        >
          <option value="">
            {trip.vehicle
              ? `Bisher: ${trip.vehicle}`
              : "Bitte Fahrzeug auswählen"}
          </option>
          {settings.vehicles
            .filter(
              (vehicle) => vehicle.active || vehicle.id === trip.vehicleId,
            )
            .map((vehicle) => (
              <option key={vehicle.id} value={vehicle.id}>
                {vehicle.name} ·{" "}
                {vehicle.ownership === "privatwagen"
                  ? "Privatwagen"
                  : "Dienstwagen"}
              </option>
            ))}
        </select>
        <small>
          {selectedVehicle?.ownership === "privatwagen"
            ? selectedVehicle.reimbursementMethod === "pauschale"
              ? "Kilometerpauschale wird für dienstliche Kilometer berechnet."
              : "Abrechnung über tatsächliche Fahrzeugkosten."
            : selectedVehicle
              ? "Dienstwagen: keine persönliche Kilometerpauschale."
              : "Die Fahrzeugart beeinflusst die Kilometererstattung."}
        </small>
      </label>
      <label>
        Dienstliche Kilometer
        <input
          type="number"
          min="0"
          step="0.1"
          value={trip.businessKm}
          onChange={(e) => set("businessKm", Number(e.target.value))}
        />
      </label>
      <label>
        Kilometerstand Start
        <input
          type="number"
          value={trip.kmStart ?? ""}
          onChange={(e) =>
            set("kmStart", e.target.value ? Number(e.target.value) : undefined)
          }
        />
      </label>
      <label>
        Kilometerstand Ende
        <input
          type="number"
          value={trip.kmEnd ?? ""}
          onChange={(e) =>
            set("kmEnd", e.target.value ? Number(e.target.value) : undefined)
          }
        />
      </label>
      <label>
        Fahrtart
        <select
          value={trip.tripType}
          onChange={(e) => set("tripType", e.target.value as Trip["tripType"])}
        >
          <option>dienstlich</option>
          <option>privat</option>
          <option>erste Tätigkeitsstätte</option>
        </select>
      </label>
      <label>
        Manuelle Abwesenheit (Min.)
        <input
          type="number"
          value={trip.manualAbsenceMinutes ?? ""}
          onChange={(e) =>
            set(
              "manualAbsenceMinutes",
              e.target.value ? Number(e.target.value) : undefined,
            )
          }
        />
      </label>
      </div></details>
    </div>
    <aside className="trip-side">
      {errors.length > 0 && (untouched
        ? <p className="trip-required">Bitte Projekt, Reisegrund, Reiseziel sowie Abfahrt und Rückkehr angeben.</p>
        : <div className="trip-errors" role="alert">{errors.map(e => <p key={e}>{e}</p>)}</div>)}
      {interval && <div className="trip-summary"><b>Abwesenheitsdauer: {duration(interval.minutes)}</b><p>Keine Arbeitszeit. {interval.nights} Datumswechsel · {interval.nights + 1} Kalendertag(e).</p></div>}
      <label className="check confirm">
        <input
          type="checkbox"
          checked={trip.absenceConfirmed}
          onChange={(e) => set("absenceConfirmed", e.target.checked)}
        />
        <span>
          <b>Abwesenheitsdauer bestätigt</b>
          <small>
            Die Zeit bildet die berufliche Abwesenheit von Wohnung und erster
            Tätigkeitsstätte ab.
          </small>
        </span>
      </label>
      <section className="trip-preview" aria-label="Verpflegungsvorschau">
        <h3>Verpflegungsvorschau · Inland</h3>
        {days.map(day => <article key={day.date}>
          <div className="trip-preview-day"><b>{dateDe(day.date)} · {duration(day.absenceMinutes)}</b><b>{euro(day.allowanceAfter)}</b></div>
          <small>{day.reason}{day.breakfastCut || day.lunchCut || day.dinnerCut ? ` · ${euro(day.allowanceBefore)} − Frühstück ${euro(day.breakfastCut)} − Mittag ${euro(day.lunchCut)} − Abend ${euro(day.dinnerCut)}` : ""}</small>
        </article>)}
        {!!days.length && <p className="trip-preview-total"><b>Verpflegung gesamt: {euro(round2(days.reduce((sum,d) => sum + d.allowanceAfter, 0)))}</b></p>}
        {!days.length && <p className="muted">Erscheint, sobald Abfahrt und Rückkehr stimmen.</p>}
        {settings.ruleMode === "internal" && <p className="trip-preview-note">Achtung: interne Schwelle aus Einstellungen aktiv.</p>}
        {/* Zustandsabhängige Hinweise sichtbar; der immer gleiche Grundhinweis aufklappbar. */}
        {manualTripReviewNotes(trip).slice(1).map(note => <p key={note} className="trip-preview-note">{note}</p>)}
        <details className="trip-preview-more"><summary>Hinweise zur Vorschau</summary>
          <p>{settings.ruleMode === "internal" ? "Interne Schwelle aus Einstellungen aktiv." : "Gespeicherte Inlandstarife und gesetzlicher Schwellenmodus."} Vorschau dieser Reise; weitere Reisen desselben Tages können die Monatsberechnung beeinflussen.</p>
          <p>{manualTripReviewNotes(trip)[0]}</p>
          <p>Übernachtungspauschale: 0,00 €. Hotelrechnung separat über „Hotelrechnung“ erfassen. Keine doppelte Erstattung; keine automatische Zuordnung.</p>
        </details>
      </section>
    </aside>
    </div>
  );
}

function MealEditor({
  trip,
  setTrip,
}: {
  trip: Trip;
  setTrip: (t: Trip) => void;
}) {
  const days: string[] = [];
  const start = new Date(`${trip.date}T12:00:00Z`);
  const end = new Date(`${trip.endDate || trip.date}T12:00:00Z`);
  for (
    let d = start;
    d <= end && days.length < 60;
    d = new Date(d.getTime() + 86400000)
  )
    days.push(d.toISOString().slice(0, 10));
  const multi = days.length > 1;
  const setMeal = (
    day: string,
    field: "breakfast" | "lunch" | "dinner",
    checked: boolean,
  ) => {
    if (!multi)
      return setTrip({ ...trip, meals: { ...trip.meals, [field]: checked }, dailyMeals: { ...trip.dailyMeals, [day]: { ...(trip.dailyMeals?.[day] || trip.meals), [field]: checked } } });
    const current = trip.dailyMeals?.[day] || (day === trip.date ? trip.meals : { breakfast: false, lunch: false, dinner: false });
    setTrip({
      ...trip,
      dailyMeals: {
        ...(trip.dailyMeals || {}),
        [day]: { ...current, [field]: checked },
      },
    });
  };
  return (
    <div className="wide meal-days">
      <b>Gestellte / bezahlte Mahlzeiten</b>
      {days.map((day) => {
        const m = multi
          ? trip.dailyMeals?.[day] || (day === trip.date ? trip.meals : { breakfast: false, lunch: false, dinner: false })
          : trip.dailyMeals?.[day] || trip.meals;
        return (
          <fieldset key={day}>
            <legend>{multi ? dateDe(day) : "Reisetag"}</legend>
            {(["breakfast", "lunch", "dinner"] as const).map((f) => (
              <label className="check" key={f}>
                <input
                  type="checkbox"
                  checked={m[f]}
                  onChange={(e) => setMeal(day, f, e.target.checked)}
                />
                {f === "breakfast"
                  ? "Frühstück"
                  : f === "lunch"
                    ? "Mittagessen"
                    : "Abendessen"}
              </label>
            ))}
          </fieldset>
        );
      })}
    </div>
  );
}

const blankExpense = (): Expense => ({
  id: uid(),
  date: new Date().toISOString().slice(0, 10),
  category: "Parken",
  description: "",
  gross: 0,
  net: 0,
  vatRate: 19,
  vat: 0,
  currency: "EUR",
  exchangeRate: 1,
  paymentType: "privat vorgestreckt",
  paidBy: "Reisender",
  reimbursementStatus: "offen",
  businessShare: 100,
  notes: "",
  status: "ungeprüft",
  warnings: [],
});
/** Kostenfenster (Neu, Bearbeiten, Löschen) über der Monatsübersicht. */
function Expenses({
  state,
  update,
  notify,
  initialExpenseId,
  clearInitialExpense,
  initialDraft, clearInitialDraft, workspaceMonth, onSaved,
  onClosed,
}: {
  /** Formular ohne Speichern geschlossen. */
  onClosed?: () => void;
  state: AppState;
  update: (f: (s: AppState) => AppState) => void;
  notify: (s: string, undo?: () => void) => void;
  initialExpenseId: string | null;
  clearInitialExpense: () => void;
  initialDraft?: Expense | null;
  clearInitialDraft?: () => void;
  workspaceMonth?: string;
  onSaved?: () => void;
}) {
  const [editing, setEditing] = useState<Expense | null>(null);
  // Als Formular über der Monatsübersicht: nach Speichern oder Abbrechen wieder schließen.
  const wasEditing = useRef(false);
  useEffect(() => {
    if (editing) wasEditing.current = true;
    else if (wasEditing.current) { wasEditing.current = false; onClosed?.(); }
  }, [editing, onClosed]);
  useEffect(() => {
    if (initialDraft) {setEditing(initialDraft); clearInitialDraft?.();}
  }, [initialDraft, clearInitialDraft]);
  useEffect(() => {
    if (!initialExpenseId) return;
    const expense = state.expenses.find(e => e.id === initialExpenseId);
    if (expense) setEditing(structuredClone(expense));
    clearInitialExpense();
  }, [initialExpenseId, state.expenses, clearInitialExpense]);
  const [readingReceipt, setReadingReceipt] = useState(false);
  const receiptRevision = useRef(0);
  const saving = useRef(false);
  useEffect(() => {saving.current = false; receiptRevision.current++; setReadingReceipt(false);}, [editing?.id]);
  useEffect(() => () => {receiptRevision.current++;}, []);
  usePendingWork(!!editing);
  const mileageConflict =
    !!editing &&
    expenseConflictsWithMileageAllowance(state.settings, state.trips, editing);
  const [batch, setBatch] = useState(0);
  useEffect(() => { if (!editing) setBatch(0); }, [editing]);
  const save = (next = false) => {
    if (!editing || readingReceipt || saving.current) return;
    const problem = linkingErrors(editing)[0] || (!validDate(editing.date) || !Number.isFinite(editing.gross) || editing.gross <= 0 ? "Bitte Rechnungsdatum und positiven Betrag prüfen" : "") || duplicateMessage(state, editing);
    if (problem) return notify(problem);
    const duplicateReceipt =
      !!editing.receipt &&
      state.expenses.some(
        (x) => x.id !== editing.id && x.receipt?.hash === editing.receipt?.hash,
      );
    const duplicateDetails = state.expenses.some(
      (x) =>
        x.id !== editing.id &&
        x.date === editing.date &&
        x.gross === editing.gross &&
        !!editing.merchant &&
        x.merchant === editing.merchant &&
        (!editing.invoiceNumber || x.invoiceNumber === editing.invoiceNumber),
    );
    const e = {
      ...editing,
      ...cleanContext(editing),
      vat: round2(editing.gross - editing.net),
      reimbursementStatus: mileageConflict
        ? ("nicht erstattungsfähig" as const)
        : editing.reimbursementStatus,
      warnings: [
        ...(editing.receipt ? [] : ["Beleg fehlt"]),
        ...(editing.category === "Tanken" && !editing.vehicleId
          ? ["Tankbeleg ohne Fahrzeug"]
          : []),
        ...(duplicateReceipt || duplicateDetails
          ? ["Möglicher doppelter Beleg"]
          : []),
        ...(mileageConflict
          ? [
              "Durch die Kilometerpauschale abgegolten – nicht zusätzlich erstattungsfähig",
            ]
          : []),
      ],
    };
    if (!e.net && e.gross) {
      e.net = round2(e.gross / (1 + e.vatRate / 100));
      e.vat = round2(e.gross - e.net);
    }
    saving.current = true;
    update((s) => {
      const i = s.expenses.findIndex((x) => x.id === e.id);
      if (i >= 0) {
        s.changes.push({
          id: uid(),
          entityType: "expense",
          entityId: e.id,
          field: "Gesamtdatensatz",
          oldValue: s.expenses[i],
          newValue: e,
          reason: "Manuelle Bearbeitung",
          user: s.settings.profileName || "Lokales Profil",
          changedAt: new Date().toISOString(),
        });
        s.expenses[i] = e;
      } else s.expenses.push(e);
      syncExpenseLink(s, e);
      return s;
    });
    const message = workspaceMonth && !e.date.startsWith(workspaceMonth)
      ? `Kostenposition gespeichert. Rechnungsdatum ${dateDe(e.date)}: Die Ausgabe erscheint in ${monthLabel(e.date.slice(0,7))}; der Arbeitsmonat bleibt ${monthLabel(workspaceMonth)}.`
      : "Kostenposition gespeichert";
    if (next) {
      setEditing(nextExpenseDraft(e, blankExpense()));
      setBatch((n) => n + 1);
      focusFirstField();
      notify(message === "Kostenposition gespeichert" ? "Kostenposition gespeichert – weiter mit der nächsten." : message);
      return;
    }
    setEditing(null);
    notify(message);
    onSaved?.();
  };
  const deleteEditing = () => {
    if (!editing || !state.expenses.some((e) => e.id === editing.id)) return;
    if (!window.confirm(`Kostenposition „${editing.description || editing.category}“ über ${euro(editing.gross)} löschen? Gespeicherte Abrechnungen bleiben unverändert.`)) return;
    const returned = state.receiptInbox.some((item) => item.expenseId === editing.id);
    update((s) => removeExpense(s, editing.id, { id: uid(), user: s.settings.profileName || "Lokales Profil", at: new Date().toISOString() }).state);
    setEditing(null);
    notify(returned ? "Kostenposition gelöscht. Der Beleg liegt wieder im Beleg-Eingang." : "Kostenposition gelöscht. Die Löschung steht im Änderungsprotokoll.");
  };
  const receipt = async (file?: File) => {
    if (!file || !editing) return;
    const revision = ++receiptRevision.current;
    setReadingReceipt(true);
    try {
      const receipt = {id:uid(), ...await readReceiptFile(file)};
      if (revision === receiptRevision.current) setEditing(current => current ? {...current, receipt} : null);
    } catch { if (revision === receiptRevision.current) notify("Beleg konnte nicht gelesen werden. Bitte erneut auswählen."); }
    finally { if (revision === receiptRevision.current) setReadingReceipt(false); }
  };
  return (
    <>
      {editing && (
        <Modal title="Kosten & Beleg" close={() => setEditing(null)} onSubmitShortcut={() => save(true)} wide>
          {workspaceMonth && <p className="notice" role="status">Arbeitsmonat: {monthLabel(workspaceMonth)}. Rechnungsdatum bitte am Beleg prüfen.{validDate(editing.date) && !editing.date.startsWith(workspaceMonth) && ` Diese Ausgabe erscheint wegen ihres Rechnungsdatums in ${monthLabel(editing.date.slice(0,7))}.`}</p>}
          {/* Zweispaltig: links Betrag, Beleg und Details; rechts Projekt und Reisezuordnung. */}
          <div className="expense-layout">
          <div className="form-grid expense-fields">
            <label>
              Datum
              <input
                type="date"
                value={editing.date}
                onChange={(e) =>
                  setEditing({ ...editing, date: e.target.value })
                }
              />
            </label>
            <label>
              Kategorie
              <select
                aria-label="Kategorie"
                value={editing.category}
                onChange={(e) =>
                  setEditing({ ...editing, category: e.target.value })
                }
              >
                {expenseCategories.map((c) => (
                  <option key={c} value={c}>{c === "Hotel" ? "Hotel / Übernachtung" : c}</option>
                ))}
              </select>
            </label>
            <label className="wide">
              Beschreibung
              <input
                value={editing.description}
                onChange={(e) =>
                  setEditing({ ...editing, description: e.target.value })
                }
              />
            </label>
            <label>
              Brutto (€)
              <input
                type="number"
                step="0.01"
                value={editing.gross}
                onChange={(e) => {
                  const gross = Number(e.target.value);
                  const net = round2(gross / (1 + editing.vatRate / 100));
                  setEditing({
                    ...editing,
                    gross,
                    net,
                    vat: round2(gross - net),
                  });
                }}
              />
            </label>
            <PaymentSelect value={editing.paymentType} onChange={paymentType => setEditing({...editing, paymentType, paidBy:paymentPayer(paymentType)})} />
            {editing.category === "Tanken" && (
              <>
                <label>
                  Fahrzeug
                  <select
                    value={editing.vehicleId || ""}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        vehicleId: e.target.value || undefined,
                      })
                    }
                  >
                    <option value="">Bitte Fahrzeug auswählen</option>
                    {state.settings.vehicles
                      .filter((vehicle) => vehicle.active)
                      .map((vehicle) => (
                        <option value={vehicle.id} key={vehicle.id}>
                          {vehicle.name} · {vehicle.plate || "ohne Kennzeichen"}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Liter
                  <input
                    type="number"
                    step="0.01"
                    value={editing.fuelLiters || ""}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        fuelLiters: Number(e.target.value),
                      })
                    }
                  />
                </label>
                <label>
                  Kilometerstand
                  <input
                    type="number"
                    value={editing.odometer || ""}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        odometer: Number(e.target.value),
                      })
                    }
                  />
                </label>
                <label>
                  Preis je Liter
                  <input
                    disabled
                    value={
                      editing.fuelLiters
                        ? euro(editing.gross / editing.fuelLiters)
                        : "–"
                    }
                  />
                </label>
              </>
            )}
            <div className="wide expense-receipt">
              <label className="upload-box">
                <span>Beleg (PDF, JPG, PNG, HEIC)</span>
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.heic,image/*"
                  onChange={(e) => receipt(e.target.files?.[0])}
                />
                <b>
                  {editing.receipt?.name || "Datei auswählen oder fotografieren"}
                </b>
              </label>
              <ReceiptAttachment receipt={editing.receipt} />
            </div>
            <details className="wide expense-more" open={!!(editing.merchant || editing.invoiceNumber || editing.businessShare !== 100 || editing.reimbursementStatus !== "offen")}>
              <summary>Weitere Angaben · Händler, Rechnungsnummer, Steuer, Erstattungsstatus, Anteil</summary>
              <div className="form-grid">
              <label>
                Händler / Anbieter
                <input
                  value={editing.merchant || ""}
                  onChange={(e) =>
                    setEditing({ ...editing, merchant: e.target.value })
                  }
                />
              </label>
              <label>
                Rechnungsnummer
                <input
                  value={editing.invoiceNumber || ""}
                  onChange={(e) =>
                    setEditing({ ...editing, invoiceNumber: e.target.value })
                  }
                />
              </label>
              <label>
                Netto (€)
                <input
                  type="number"
                  step="0.01"
                  value={editing.net}
                  onChange={(e) =>
                    setEditing({ ...editing, net: Number(e.target.value) })
                  }
                />
              </label>
              <label>
                USt.-Satz
                <select
                  value={editing.vatRate}
                  onChange={(e) =>
                    setEditing({ ...editing, vatRate: Number(e.target.value) })
                  }
                >
                  <option value="0">0 %</option>
                  <option value="7">7 %</option>
                  <option value="19">19 %</option>
                </select>
              </label>
              <label>
                Umsatzsteuer
                <input
                  disabled
                  value={euro(round2(editing.gross - editing.net))}
                />
              </label>
              <label>
                Erstattungsstatus
                <select
                  value={editing.reimbursementStatus}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      reimbursementStatus: e.target
                        .value as Expense["reimbursementStatus"],
                    })
                  }
                >
                  <option>offen</option>
                  <option>erstattet</option>
                  <option>nicht erstattungsfähig</option>
                </select>
              </label>
              <label>
                Dienstlicher Anteil (%)
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={editing.businessShare}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      businessShare: Number(e.target.value),
                    })
                  }
                />
              </label>
              </div>
            </details>
          </div>
          <div className="expense-side">
            <ReceiptLinkFields value={editing} onChange={patch=>setEditing({...editing,...patch})} trips={state.trips} travelLabel="Reisezuordnung" compact />
            {mileageConflict && (
              <div className="error-box">
                <AlertTriangle />
                Mögliche Doppelerfassung: Bei Verwendung der Kilometerpauschale
                dürfen abgegoltene Fahrzeugkosten nicht zusätzlich angesetzt
                werden.
              </div>
            )}
          </div>
          </div>
          <div className="modal-actions">
            <BatchCount count={batch} noun={["Kostenposition", "Kostenpositionen"]} />
            {state.expenses.some((e) => e.id === editing.id) && <button className="ghost danger modal-delete" onClick={deleteEditing}><Trash2 size={16} /> Löschen</button>}
            <button className="ghost" onClick={() => setEditing(null)}>
              Abbrechen
            </button>
            <button className="ghost batch-next" onClick={() => save(true)} disabled={readingReceipt} title="Strg+Enter">
              <Plus size={17} />
              Speichern & nächste
            </button>
            <button className="primary" onClick={() => save()} disabled={readingReceipt}>
              <Save size={17} />
              Speichern & fertig
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

function Statements({
  state,
  month,
  statement: currentStatement,
  update,
  notify,
  startEntry, openCapture, viewRules,
  commitClosing, editClosingIssue, commitCorrection, folder, openImport, startInbox,
}: {
  openImport?: () => void;
  startInbox?: () => void;
  state: AppState;
  month: string;
  statement: ReturnType<typeof buildStatement>;
  update: (f: (s: AppState) => AppState) => void;
  notify: (s: string) => void;
  startEntry: (kind: "trip" | "Hotel" | "Parken") => void;
  openCapture: () => void;
  viewRules: () => void;
  commitClosing: (confirmation: ClosingConfirmation) => Promise<void>;
  commitCorrection: (month: string, expected: AppState) => Promise<string>;
  editClosingIssue: (target: NonNullable<ClosingIssue['target']>) => void;
  folder: FolderStorage;
}) {
  const [reviewMonth, setReviewMonth] = useState<string | null>(null);
  // Filter der Zeitleiste aus „Prüfen“; beim Monatswechsel zurücksetzen.
  const [timelineFilter, setTimelineFilter] = useState<TimelineFilter | null>(null);
  useEffect(() => setTimelineFilter(null), [month]);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [correctionSaving, setCorrectionSaving] = useState(false);
  const [correctionError, setCorrectionError] = useState("");
  const [pdfWorking, setPdfWorking] = useState(false);
  const pdfBusy = useRef(false);
  const correctionBusy = useRef(false);
  const reportHeading = useRef<HTMLElement>(null);
  useEffect(() => {if (reviewMonth === month) {reportHeading.current?.focus(); reportHeading.current?.scrollIntoView({block:"start"});}}, [reviewMonth, month]);
  useEffect(() => {setReviewMonth(null); setSelectedVersionId(null); setCorrectionError("");}, [month]);
  const versions = useMemo(() => state.statements.filter(s => s.month === month).sort((a, b) => b.version - a.version), [state.statements, month]);
  const latest = versions[0];
  const existing = versions.find(item => item.id === selectedVersionId) || latest;
  const historical = !!existing && existing.id !== latest?.id;
  const selectedHistoryLimitations = useMemo(() => existing ? snapshotHistoryLimitations(existing) : [], [existing]);
  const versionStatus = (version: StatementSnapshot) => {
    if (version.status === 'storniert') return version.locked ? 'Storniert' : 'Stornierter Entwurf';
    if (isClosedStatement(version)) return version.status === 'ausgezahlt' ? 'Ausgezahlt' : 'Abgeschlossen';
    if (version.locked || ['freigegeben', 'ausgezahlt'].includes(version.status)) return 'Status prüfen';
    return versions.some(item => item.version < version.version && isClosedStatement(item)) ? 'Korrekturentwurf' : 'Entwurf';
  };
  const comparison = useMemo(() => compareClosedStatementWithCurrent(state, month, currentStatement), [state, month, currentStatement]);
  const statement = existing?.data || currentStatement;
  const exportState = useMemo(() => existing ? stateForStatementVersion(state, existing) : state, [state, existing]);
  const exportContext = existing ? { version: existing.version, correction: versions.some(item => item.version < existing.version && isClosedStatement(item)) } : undefined;
  const number =
    existing?.number ||
    `RK-${month.replace("-", "")}-${String(state.statements.length + 1).padStart(3, "0")}`;
  const makePdf = async (print = false) => {
    if (pdfBusy.current) return;
    pdfBusy.current = true; setPdfWorking(true);
    try { await (print ? printPdf : exportPdf)(statement, exportState, number, exportContext); }
    catch { notify("Die PDF konnte nicht erstellt werden. Bitte erneut versuchen; die Abrechnung bleibt gespeichert."); }
    finally { pdfBusy.current = false; setPdfWorking(false); }
  };
  const usedVehicles = [
    ...new Map([
      ...statement.rows.flatMap((row) =>
        row.trips.map((trip) => {
          const profile = exportState.settings.vehicles.find(
            (vehicle) => vehicle.id === trip.vehicleId,
          );
          const vehicle = {
            id:
              profile?.id ||
              `${trip.vehicle}-${trip.plate}-${trip.vehicleType}`,
            name: profile?.name || trip.vehicle || "Fahrzeug nicht angegeben",
            plate: profile?.plate || trip.plate || "ohne Kennzeichen",
            type: profile
              ? profile.ownership === "privatwagen"
                ? "Privatwagen"
                : "Dienstwagen"
              : trip.vehicleType === "privatfahrzeug"
                ? "Privatwagen"
                : trip.vehicleType === "firmenfahrzeug"
                  ? "Dienstwagen"
                  : trip.vehicleType,
          };
          return [vehicle.id, vehicle] as const;
        }),
      ),
      ...exportState.expenses
        .filter(
          (expense) => expense.date.startsWith(month) && expense.vehicleId,
        )
        .flatMap((expense) => {
          const profile = exportState.settings.vehicles.find(
            (vehicle) => vehicle.id === expense.vehicleId,
          );
          if (!profile) return [];
          const vehicle = {
            id: profile.id,
            name: profile.name,
            plate: profile.plate || "ohne Kennzeichen",
            type:
              profile.ownership === "privatwagen"
                ? "Privatwagen"
                : "Dienstwagen",
          };
          return [[vehicle.id, vehicle] as const];
        }),
    ]).values(),
  ];
  const openVersion = (id: string | null = null) => {setSelectedVersionId(id); setReviewMonth(month);};
  const correct = async () => {
    if (correctionBusy.current) return;
    correctionBusy.current = true; setCorrectionSaving(true); setCorrectionError("");
    try { const id = await commitCorrection(month, state); openVersion(id); }
    catch (failure) { setCorrectionError(failure instanceof Error ? failure.message : "Korrekturentwurf konnte nicht gespeichert werden."); }
    finally { correctionBusy.current = false; setCorrectionSaving(false); }
  };
  const create = (reuseDraft = false) => {
    if (comparison.baseline) { if (reuseDraft && latest) openVersion(); else void correct(); return; }
    update((s) => {
      const latest = s.statements
        .filter((x) => x.month === month)
        .sort((a, b) => b.version - a.version)[0];
      if (reuseDraft && latest) return s;
      const snap: StatementSnapshot = {
        id: uid(),
        month,
        number,
        createdAt: new Date().toISOString(),
        status: "vollständig",
        version: (latest?.version || 0) + 1,
        locked: false,
        data: structuredClone(currentStatement),
        settingsSnapshot: structuredClone(s.settings),
        expensesSnapshot: structuredClone(s.expenses.filter((expense) => expense.date.startsWith(month))),
        relatedTripsSnapshot: relatedTripsForSnapshot(s, currentStatement),
      };
      s.statements.push(snap);
      return s;
    });
    openVersion();
    notify("Entwurf mit Tarifstand erstellt.");
  };
  const setStatus = (status: ReviewStatus) =>
    update((s) => changeStatementStatus(s, existing!.id, status, { id: uid(), at: new Date().toISOString() }));
  return (
    <>
      <MonthWorkspace state={state} month={month} statement={currentStatement} startEntry={startEntry} openCapture={openCapture}
        openStatement={() => {if (latest) openVersion(); else create(true);}}
        comparison={comparison}
        changes={<StatementChanges comparison={comparison} creating={correctionSaving} error={correctionError} create={() => void correct()} resume={openVersion} />}
        openImport={openImport} inboxCount={openInboxItems(state).length} startInbox={startInbox}
        timeline={<MonthTimeline state={state} month={month} statement={currentStatement} edit={editClosingIssue} startTrip={() => startEntry('trip')} filter={timelineFilter} setFilter={setTimelineFilter} />}
        checks={<MonthChecks state={state} month={month} update={update} notify={notify} viewRules={viewRules} startInbox={startInbox ?? (() => undefined)}
          showIssues={filter => { setTimelineFilter(filter); requestAnimationFrame(() => document.querySelector('.month-timeline')?.scrollIntoView({behavior: 'smooth', block: 'start'})); }} />} />
      {reviewMonth === month && <>
      <button className="ghost workspace-hide-report" onClick={() => setReviewMonth(null)}>Zurück zur Erfassung</button>
      <section className="statement-head" ref={reportHeading} tabIndex={-1} aria-label="Abrechnung prüfen">
        <div>
          <p className="eyebrow">Abrechnung {number}</p>
          <h2>
            {new Date(month + "-01T12:00").toLocaleDateString("de-DE", {
              month: "long",
              year: "numeric",
            })}
          </h2>
          <p>
            {statement.rows.length} Reisetage ·{" "}
            {exportState.expenses.filter((e) => e.date.startsWith(month) && e.status !== "storniert").length}{" "}
            Kostenpositionen · Gespeicherter Entwurfs- und Tarifstand.
          </p>
          {versions.length > 0 && <label className="statement-version-picker">Historische Version / aktueller Entwurf<select aria-label="Abrechnungsversion" value={existing.id} onChange={event => setSelectedVersionId(event.target.value)}>{versions.map(version => <option key={version.id} value={version.id}>Version {version.version} · {versionStatus(version)} · erstellt {dateDe(version.createdAt?.slice(0,10))}</option>)}</select></label>}
          {existing && <p>Freigabestatus: {existing.status}. {(() => { const closing = state.changes.filter(change => change.entityId === existing.id && change.field === 'Status' && (change.newValue === 'freigegeben' || (typeof change.newValue === 'object' && change.newValue !== null && 'status' in change.newValue && change.newValue.status === 'freigegeben'))).at(-1); return closing ? `Abgeschlossen am ${dateDe(closing.changedAt.slice(0,10))}.` : existing.locked ? 'Historisches Abschlussdatum ist nicht gesondert gespeichert.' : ''; })()}</p>}
        </div>
        <div className="statement-actions">
          {!historical && <button className="primary" disabled={correctionSaving || (!!comparison.baseline && !comparison.hasChanges && !comparison.limitations.length && !comparison.draft) || (!!comparison.draft && comparison.draftCurrent)} onClick={() => create()}>
            <Save size={18} />
            {existing ? "Neue Version erstellen" : "Abrechnung erstellen"}
          </button>}
          {existing && !historical && (
            <select
              aria-label="Abrechnungsstatus"
              value={existing.status}
              onChange={(e) => setStatus(e.target.value as ReviewStatus)}
            >
              {!existing.locked && <><option>vollständig</option><option>zur Freigabe eingereicht</option></>}
              {!["vollständig", "zur Freigabe eingereicht", "storniert", "ausgezahlt"].includes(existing.status) && <option disabled>{existing.status}</option>}
              {existing.locked && ["freigegeben", "ausgezahlt"].includes(existing.status) && <option>ausgezahlt</option>}
              <option>storniert</option>
            </select>
          )}
        </div>
      </section>
      {historical && <div className="notice" role="status">Historische Version {existing.version}: nur Ansicht und Export. Die gespeicherten Beträge, Tarife und Belege dieser ausgewählten Version werden verwendet.</div>}
      {!historical && <StatementClosing state={state} month={month} snapshot={existing} commit={commitClosing} edit={editClosingIssue} />}
      <section className="card statement-profile">
        <div>
          <span>Name</span>
          <b>{exportState.settings.profileName || "Nicht hinterlegt"}</b>
        </div>
        <div>
          <span>Abrechnungsmonat</span>
          <b>
            {new Date(month + "-01T12:00").toLocaleDateString("de-DE", {
              month: "long",
              year: "numeric",
            })}
          </b>
        </div>
        <div className="statement-vehicles">
          <span>Verwendete Fahrzeuge</span>
          {usedVehicles.length ? (
            usedVehicles.map((vehicle) => (
              <b key={vehicle.id}>
                <Car size={16} /> {vehicle.name} · {vehicle.type} ·{" "}
                {vehicle.plate}
              </b>
            ))
          ) : (
            <b>Keine Fahrzeugangabe im ausgewählten Monat</b>
          )}
        </div>
      </section>
      {existing && selectedHistoryLimitations.length > 0 && <div className="notice" role="status"><div><b>Historischer Vergleich eingeschränkt.</b><ul>{selectedHistoryLimitations.map((limitation, index) => <li key={index}>{limitation}</li>)}</ul>Fehlende historische Angaben werden im Export ausgelassen und nicht aus aktuellen Daten ergänzt. Die gespeicherten Berechnungsbeträge bleiben erhalten.</div></div>}
      {existing?.locked && (
        <div className="notice">
          <ShieldCheck />
          <div>
            <b>Abrechnung gesperrt</b>
            <p>
              Freigegebene Werte bleiben unverändert. Für Korrekturen erstellen
              Sie nach einer Änderung eine neue Version.
            </p>
          </div>
          <span>Version {existing.version}</span>
        </div>
      )}
      <section className="card">
        <div className="card-head">
          <div>
            <p className="eyebrow">Einzelaufstellung</p>
            <h3>Berechnung je Reisetag</h3>
          </div>
          <span className="status-pill">{existing?.status || "Entwurf"}</span>
        </div>
        <div className="table-wrap statement-table">
          <table>
            <thead>
              <tr>
                <th>Datum</th>
                <th>Zeit / Dauer</th>
                <th>Ziel & Zweck</th>
                <th>km</th>
                <th>Spesen vor</th>
                <th>Kürzungen</th>
                <th>Spesen nach</th>
                <th>Fahrtkosten</th>
                <th>Hotel</th>
                <th>Sonstiges</th>
                <th>Offen</th>
              </tr>
            </thead>
            <tbody>
              {statement.rows.map((r) => (
                <tr key={r.date}>
                  <td>
                    <b>{dateDe(r.date)}</b>
                  </td>
                  <td>
                    {r.firstStart}–{r.lastEnd}
                    <small>{duration(r.absenceMinutes)}</small>
                  </td>
                  <td>
                    {r.destinations.join(", ")}
                    <small>{r.trips.map((t) => t.purpose).join(", ")}</small>
                  </td>
                  <td>{r.totalKm}</td>
                  <td>{euro(r.allowanceBefore)}</td>
                  <td>-{euro(r.breakfastCut + r.lunchCut + r.dinnerCut)}</td>
                  <td>
                    <b>{euro(r.allowanceAfter)}</b>
                  </td>
                  <td>{euro(r.mileage + r.fuel)}</td>
                  <td>{euro(r.accommodation)}</td>
                  <td>{euro(r.other)}</td>
                  <td>
                    <b>{euro(r.openAmount)}</b>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={6}>Summen</td>
                <td>{euro(statement.totals.allowance)}</td>
                <td>
                  {euro(statement.totals.mileage + statement.totals.fuel)}
                </td>
                <td>{euro(statement.totals.accommodation)}</td>
                <td>{euro(statement.totals.other)}</td>
                <td>{euro(statement.totals.openAmount)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="statement-day-details">{statement.rows.map((row) => <DayDetails key={row.date} day={row} frozen={!!existing?.locked} />)}</div>
      </section>
      <MonthDetails statement={statement} frozen={!!existing?.locked} />
      <section className="summary-grid">
        <div>
          <span>Verpflegungspauschalen</span>
          <b>{euro(statement.totals.allowance)}</b>
        </div>
        <div>
          <span>Kilometererstattung</span>
          <b>{euro(statement.totals.mileage)}</b>
        </div>
        <div>
          <span>Privat vorgestreckt</span>
          <b>{euro(statement.totals.privatelyAdvanced)}</b>
        </div>
        <div className="total">
          <span>Persönlicher Erstattungsbetrag laut Abrechnungsstand</span>
          <b>{euro(statement.totals.openAmount)}</b>
        </div>
      </section>
      <section className="card export-card">
        <div>
          <p className="eyebrow">Export</p>
          <h3>Abrechnung weitergeben</h3>
          <p>
            PDF für Unterschrift, Tabellen für Buchhaltung oder Komplettpaket
            mit Belegen.
          </p>
          <p>Tabellen enthalten den vollständigen ausgewählten Abrechnungsstand. Die bestehende Spalte „OffenerBetrag“ bezeichnet dessen rechnerischen Erstattungsbetrag, keine tatsächliche Restzahlung.</p>
          {exportContext?.correction && <p className="correction-payment-note">{correctionExportNotice} CSV-/DATEV-Exporte vor einer Übernahme mit der Buchhaltung abstimmen; frühere Versionen nicht zusätzlich buchen.</p>}
        </div>
        <div className="export-buttons">
          <button disabled={pdfWorking} onClick={() => void makePdf()}>
            <FileDown />
            {pdfWorking ? 'PDF wird erstellt …' : 'PDF'}
          </button>
          <button onClick={() => exportExcel(statement, exportState, exportContext)}>
            <FileSpreadsheet />
            Excel
          </button>
          <button onClick={() => exportCsv(statement, exportState, false, exportContext)}>
            <Download />
            CSV
          </button>
          <button onClick={() => {
            if (exportContext?.correction && !window.confirm(`${correctionExportNotice}\n\nDiese DATEV-CSV ist keine zusätzliche Differenzbuchung. Vor einer Übernahme frühere Buchungen und Zahlungen gesondert abstimmen. Vollständigen ausgewählten Stand trotzdem exportieren?`)) return;
            exportCsv(statement, exportState, true, exportContext);
          }}>
            <FileSpreadsheet />
            DATEV-CSV
          </button>
          <button onClick={() => exportZip(statement, exportState, number, exportContext)}>
            <Archive />
            ZIP + Belege
          </button>
        </div>
      </section>
      {existing && isClosedStatement(existing) && <StatementFiling folder={folder} snapshot={existing} label={`${monthLabel(month)} (Version ${existing.version})`} print={() => void makePdf(true)} />}
      </>}
    </>
  );
}

function Reports({ state, month }: { state: AppState; month: string }) {
  const [year, setYear] = useState(() => Number(month.slice(0, 4)));
  const analysis = useMemo(() => buildAnnualAnalysis(state, year), [state, year]);
  const maximumMonth = Math.max(0, ...analysis.months.map(item => item.statement.totals.grandTotal));
  const categories = [
    ["Verpflegung", analysis.totals.allowance],
    ["Kilometer", analysis.totals.mileage],
    ["Übernachtung", analysis.totals.accommodation],
    ["Tanken", analysis.totals.fuel],
    ["Sonstige Kosten", analysis.totals.other],
  ] as const;
  const changeYear = (delta: number) => setYear(current => Math.max(1, Math.min(9999, current + delta)));
  const missingReceipts = state.expenses.filter(expense => expense.status !== "storniert" && expense.date.startsWith(`${String(year).padStart(4, "0")}-`) && !expense.receipt).length;
  return (
    <div className="annual-reports">
      <header className="annual-report-header">
        <div><p className="eyebrow">Aktuelle Erfassungsdaten</p><h2>Jahresanalyse</h2><p className="muted">Jahresanalyse nach den bestehenden Monatsberechnungen. Gespeicherte Abrechnungsstände bleiben unverändert.</p></div>
        <nav className="year-picker" aria-label="Analysejahr">
          <button className="ghost" aria-label="Vorheriges Jahr" onClick={() => changeYear(-1)} disabled={year <= 1}>‹</button>
          <strong aria-live="polite">{year}</strong>
          <button className="ghost" aria-label="Nächstes Jahr" onClick={() => changeYear(1)} disabled={year >= 9999}>›</button>
        </nav>
      </header>

      <section className="analysis-section" aria-labelledby="annual-metrics-heading">
        <div className="analysis-section-head"><p className="eyebrow">Jahreskennzahlen</p><h3 id="annual-metrics-heading">Reisekosten und Erstattung</h3></div>
        <div className="metric-grid annual-metric-grid">
          <Metric label="Gesamte Reisekosten" value={euro(analysis.totals.grandTotal)} sub="inkl. vom Unternehmen bezahlter Kosten" />
          <Metric label="Verpflegungspauschalen" value={euro(analysis.totals.allowance)} sub="aus den Monatsberechnungen" />
          <Metric label="Übernachtungskosten" value={euro(analysis.totals.accommodation)} sub="erfasste Hotel- und Übernachtungskosten" />
          <Metric label="Sonstige Reisekosten" value={euro(analysis.totals.other)} sub="ohne Tanken und Übernachtung" />
          <Metric label="Offene persönliche Erstattung" value={euro(analysis.totals.openAmount)} sub="Pauschalen, Kilometer und offene Privatauslagen" strong />
        </div>
        <div className="annual-counts" aria-label="Weitere Jahreskennzahlen">
          <span><b>{analysis.businessKm.toLocaleString("de-DE")} km</b> dienstliche Kilometer</span>
          <span><b>{analysis.allowanceDayCount}</b> Tage mit Spesen</span>
          <span><b>{analysis.tripCount}</b> eindeutige Dienstreisen</span>
          <span><b>{analysis.travelDayCount}</b> Reisetage</span>
          <span><b>{analysis.entryMonthCount}</b> Monate mit Einträgen</span>
          <span><b>{analysis.closedMonthCount}</b> ausdrücklich abgeschlossene Monate</span>
        </div>
      </section>

      <div className="analysis-grid">
        <section className="card analysis-card full" aria-labelledby="year-months-heading">
          <p className="eyebrow">Monatsvergleich</p><h3 id="year-months-heading">Reisekosten von Januar bis Dezember {year}</h3>
          <div className="annual-month-bars" role="list">
            {analysis.months.map(item => {
              const amount = item.statement.totals.grandTotal;
              return <div className="annual-month-row" key={item.month} role="listitem" aria-label={`${item.label}: ${euro(amount)}`}>
                <span>{item.label}</span><div className="annual-bar-track" aria-hidden="true"><i style={{ width: `${maximumMonth > 0 ? amount / maximumMonth * 100 : 0}%` }} /></div><b>{euro(amount)}</b>
              </div>;
            })}
          </div>
        </section>

        <section className="card analysis-card" aria-labelledby="cost-types-heading">
          <p className="eyebrow">Kostenarten</p><h3 id="cost-types-heading">Aufteilung im Jahr {year}</h3>
          <div className="analysis-rows">{categories.map(([label, amount]) => <div className="analysis-row" key={label}><span>{label}</span><b>{euro(amount)}</b></div>)}</div>
          <p className="analysis-note">Summe: {euro(analysis.totals.grandTotal)} · Gesamtkosten einschließlich Firmenkosten; die offene persönliche Erstattung wird getrennt ausgewiesen.</p>
        </section>

        <section className="card analysis-card" aria-labelledby="projects-heading">
          <p className="eyebrow">Interne Kostenanalyse</p><h3 id="projects-heading">Reisekosten nach Projekt</h3>
          <p className="analysis-note">Keine verbindliche steuerliche oder buchhalterische Zuordnung. Tagespauschalen werden nur bei einem eindeutig belegten Projekt zugeordnet.</p>
          {analysis.projects.length ? <div className="analysis-rows">{analysis.projects.map(project => <div className="analysis-row" key={project.key}><span>{project.label}</span><b>{euro(project.amount)}</b></div>)}</div> : <p className="muted">Für dieses Jahr liegen keine eindeutig zuordenbaren Projektkosten vor.</p>}
          <div className="analysis-row unassigned-row"><span>Nicht eindeutig zugeordnet</span><b>{euro(analysis.unassignedProjectCosts)}</b></div>
          {analysis.projectRoundingAdjustment !== 0 && <><div className="analysis-row"><span>Rundungsabgleich Kilometer</span><b>{euro(analysis.projectRoundingAdjustment)}</b></div><p className="analysis-note">Abgleich zwischen den gerundeten Tageskilometerbeträgen der Monatsabrechnung und den gerundeten Projektanteilen.</p></>}
        </section>

        <section className="card analysis-card" aria-labelledby="reimbursements-heading">
          <p className="eyebrow">Erstattungsübersicht</p><h3 id="reimbursements-heading">Zahlungsarten und persönliche Auszahlung</h3>
          <div className="analysis-rows">
            <div className="analysis-row"><span>Privat vorgestreckt</span><b>{euro(analysis.totals.privatelyAdvanced)}</b></div>
            <div className="analysis-row"><span>Vom Unternehmen bezahlt</span><b>{euro(analysis.totals.companyPaid)}</b></div>
            <div className="analysis-row"><span>Bereits erstattet</span><b>{euro(analysis.totals.reimbursed)}</b></div>
            <div className="analysis-row"><span>Zahlungsart unbekannt</span><b>{euro(analysis.totals.unknownPayment)}</b></div>
            <div className="analysis-row open-reimbursement"><span>Offene persönliche Erstattung</span><b>{euro(analysis.totals.openAmount)}</b></div>
          </div>
          <p className="analysis-note">Privat vorgestreckt heißt nicht automatisch offen. Unbekannte Zahlungsarten zählen nicht zur persönlichen Auszahlung. Zahlungsart und Erstattungsstatus sind getrennte Merkmale und können sich überschneiden. Fehlende Belege: {missingReceipts}.</p>
        </section>
      </div>
    </div>
  );
}

function Metric({ label, value, sub, strong }: { label: string; value: string; sub: string; strong?: boolean }) {
  return <div className={`metric ${strong ? "strong" : ""}`}><span>{label}</span><b>{value}</b><small>{sub}</small></div>;
}

function SettingsPanel({
  state,
  update,
  notify,
}: {
  state: AppState;
  update: (f: (s: AppState) => AppState) => void;
  notify: (s: string) => void;
}) {
  const [local, setLocal] = useState(structuredClone(state.settings));
  usePendingWork(JSON.stringify(local) !== JSON.stringify(state.settings));
  const addVehicle = (ownership: VehicleProfile["ownership"]) => {
    const vehicle: VehicleProfile = {
      id: uid(),
      name:
        ownership === "privatwagen" ? "Neuer Privatwagen" : "Neuer Dienstwagen",
      plate: "",
      ownership,
      reimbursementMethod: ownership === "privatwagen" ? "pauschale" : "keine",
      active: true,
    };
    setLocal({
      ...local,
      vehicles: [...(local.vehicles || []), vehicle],
      defaultVehicleId: local.defaultVehicleId || vehicle.id,
    });
  };
  const updateVehicle = (id: string, patch: Partial<VehicleProfile>) =>
    setLocal({
      ...local,
      vehicles: (local.vehicles || []).map((vehicle) =>
        vehicle.id === id ? { ...vehicle, ...patch } : vehicle,
      ),
    });
  const deleteVehicle = (id: string) => {
    if ((local.vehicles || []).length <= 1) return;
    const vehicles = local.vehicles.filter((vehicle) => vehicle.id !== id);
    setLocal({
      ...local,
      vehicles,
      defaultVehicleId:
        local.defaultVehicleId === id
          ? vehicles.find((vehicle) => vehicle.active)?.id || vehicles[0].id
          : local.defaultVehicleId,
    });
  };
  const save = () => {
    update((s) => {
      s.changes.push({
        id: uid(),
        entityType: "settings",
        entityId: "main",
        field: "Einstellungen und Tarife",
        oldValue: s.settings,
        newValue: local,
        reason: "Einstellungen gespeichert",
        user: local.profileName || "Lokales Profil",
        changedAt: new Date().toISOString(),
      });
      s.settings = local;
      return s;
    });
    notify("Einstellungen gespeichert");
  };
  return (
    <div className="settings-layout">
      <section className="card app-version"><p className="eyebrow">Über diese App</p><h3>SpesenKit {appRelease.version}</h3>
        <p>Laufende Version{appRelease.commit ? ` · Commit ${appRelease.commit}` : ""}. Daten und Belege bleiben lokal in diesem Browser.</p>
      </section>
      <section className="card">
        <p className="eyebrow">Profil & Unternehmen</p>
        <h3>Angaben für die Abrechnung</h3>
        <div className="form-grid">
          <label>
            Name
            <input
              value={local.profileName}
              onChange={(e) =>
                setLocal({ ...local, profileName: e.target.value })
              }
            />
          </label>
          <label>
            Firma
            <input
              value={local.company}
              onChange={(e) => setLocal({ ...local, company: e.target.value })}
            />
          </label>
          <label>
            Abteilung
            <input
              value={local.department}
              onChange={(e) =>
                setLocal({ ...local, department: e.target.value })
              }
            />
          </label>
          <label>
            Kostenstelle
            <input
              value={local.costCenter}
              onChange={(e) =>
                setLocal({ ...local, costCenter: e.target.value })
              }
            />
          </label>
          <label>
            Zeitzone
            <input
              value={local.timezone}
              onChange={(e) => setLocal({ ...local, timezone: e.target.value })}
            />
          </label>
          <label className="wide">
            Wohnort / Startadresse
            <input
              value={local.homeAddress}
              onChange={(e) =>
                setLocal({ ...local, homeAddress: e.target.value })
              }
            />
          </label>
          <label className="wide">
            Erste Tätigkeitsstätte
            <input
              value={local.firstWorkplace}
              onChange={(e) =>
                setLocal({ ...local, firstWorkplace: e.target.value })
              }
            />
          </label>
          <label className="wide">
            Weitere Firmenstandorte
            <input
              value={local.regularSites}
              onChange={(e) =>
                setLocal({ ...local, regularSites: e.target.value })
              }
            />
          </label>
        </div>
      </section>
      <section className="card full vehicle-settings">
        <div className="card-head">
          <div>
            <p className="eyebrow">Fahrzeuge & Kilometererstattung</p>
            <h3>Dienstwagen und Privatwagen unterscheiden</h3>
          </div>
          <div className="vehicle-add-actions">
            <button className="ghost" onClick={() => addVehicle("dienstwagen")}>
              <Plus size={16} /> Dienstwagen
            </button>
            <button className="ghost" onClick={() => addVehicle("privatwagen")}>
              <Plus size={16} /> Privatwagen
            </button>
          </div>
        </div>
        <div className="info-box green vehicle-rule-note">
          <Car />
          <div>
            <b>Die Auswahl gilt je Fahrt</b>
            <p>
              Für einen Dienstwagen wird keine persönliche Kilometerpauschale
              berechnet. Beim Privatwagen wählen Sie Kilometerpauschale oder
              tatsächliche Fahrzeugkosten.
            </p>
          </div>
        </div>
        <div className="vehicle-list">
          {(local.vehicles || []).map((vehicle) => (
            <article
              key={vehicle.id}
              className={local.defaultVehicleId === vehicle.id ? "default" : ""}
            >
              <label className="vehicle-default">
                <input
                  type="radio"
                  name="defaultVehicle"
                  checked={local.defaultVehicleId === vehicle.id}
                  onChange={() =>
                    setLocal({ ...local, defaultVehicleId: vehicle.id })
                  }
                />
                <span>
                  <b>Standard</b>
                  <small>für neue und importierte Fahrten</small>
                </span>
              </label>
              <label>
                Fahrzeug / Modell
                <input
                  value={vehicle.name}
                  onChange={(event) =>
                    updateVehicle(vehicle.id, { name: event.target.value })
                  }
                />
              </label>
              <label>
                Kennzeichen
                <input
                  value={vehicle.plate}
                  placeholder="z. B. K-RK 123"
                  onChange={(event) =>
                    updateVehicle(vehicle.id, { plate: event.target.value })
                  }
                />
              </label>
              <label>
                Fahrzeugart
                <select
                  value={vehicle.ownership}
                  onChange={(event) => {
                    const ownership = event.target
                      .value as VehicleProfile["ownership"];
                    updateVehicle(vehicle.id, {
                      ownership,
                      reimbursementMethod:
                        ownership === "dienstwagen" ? "keine" : "pauschale",
                    });
                  }}
                >
                  <option value="dienstwagen">Dienstwagen</option>
                  <option value="privatwagen">Privatwagen</option>
                </select>
              </label>
              <label>
                Kilometerabrechnung
                {vehicle.ownership === "privatwagen" ? (
                  <select
                    value={vehicle.reimbursementMethod}
                    onChange={(event) =>
                      updateVehicle(vehicle.id, {
                        reimbursementMethod: event.target
                          .value as VehicleProfile["reimbursementMethod"],
                      })
                    }
                  >
                    <option value="pauschale">Kilometerpauschale</option>
                    <option value="tatsächliche Kosten">
                      tatsächliche Fahrzeugkosten
                    </option>
                  </select>
                ) : (
                  <div className="vehicle-no-mileage">
                    Keine persönliche Kilometerpauschale
                  </div>
                )}
              </label>
              <label className="vehicle-active check">
                <input
                  type="checkbox"
                  checked={vehicle.active}
                  onChange={(event) =>
                    updateVehicle(vehicle.id, { active: event.target.checked })
                  }
                />
                In Auswahllisten anzeigen
              </label>
              <button
                className="icon danger"
                onClick={() => deleteVehicle(vehicle.id)}
                disabled={(local.vehicles || []).length <= 1}
                aria-label={`${vehicle.name} löschen`}
              >
                <Trash2 size={16} />
              </button>
            </article>
          ))}
        </div>
      </section>
      <section className="card">
        <p className="eyebrow">Abwesenheitsregel</p>
        <h3>Wann entsteht ein Pauschbetrag?</h3>
        <div className="segmented">
          <button
            className={local.ruleMode === "legal" ? "active" : ""}
            onClick={() => setLocal({ ...local, ruleMode: "legal" })}
          >
            Gesetzliche Regel
          </button>
          <button
            className={local.ruleMode === "internal" ? "active" : ""}
            onClick={() => setLocal({ ...local, ruleMode: "internal" })}
          >
            Interne Firmenregel
          </button>
        </div>
        {local.ruleMode === "legal" ? (
          <div className="info-box green">
            <ShieldCheck />
            <div>
              <b>Mehr als 8:00 Stunden</b>
              <p>8:00 Stunden: 0,00 € · 8:01 Stunden: 14,00 €</p>
            </div>
          </div>
        ) : (
          <>
            <div className="field-row">
              <label>
                Vergleich
                <select
                  value={local.internalComparator}
                  onChange={(e) =>
                    setLocal({
                      ...local,
                      internalComparator: e.target
                        .value as typeof local.internalComparator,
                    })
                  }
                >
                  <option value="greater">mehr als</option>
                  <option value="atLeast">mindestens</option>
                </select>
              </label>
              <label>
                Grenze (Minuten)
                <input
                  type="number"
                  value={local.internalMinutes}
                  onChange={(e) =>
                    setLocal({
                      ...local,
                      internalMinutes: Number(e.target.value),
                    })
                  }
                />
              </label>
            </div>
            <div className="info-box yellow">
              <AlertTriangle />
              <div>
                <b>Interne Abrechnungsregel</b>
                <p>
                  Kann von der steuerlichen Höchstgrenze oder
                  Anspruchsvoraussetzung abweichen.
                </p>
              </div>
            </div>
          </>
        )}
      </section>
      <section className="card full">
        <div className="card-head">
          <div>
            <p className="eyebrow">Versionierte Tarife</p>
            <h3>Zentrale Rechts- und Pauschalwertkonfiguration</h3>
          </div>
          <button
            className="ghost"
            onClick={() =>
              setLocal({
                ...local,
                tariffs: [
                  ...local.tariffs,
                  {
                    id: uid(),
                    label: "Neuer Tarif",
                    validFrom: new Date().toISOString().slice(0, 10),
                    amount: 0,
                    country: "DE",
                    kind: "partial",
                    source: "Manuell ergänzt",
                    checkedAt: new Date().toISOString().slice(0, 10),
                    unit: "EUR",
                  },
                ],
              })
            }
          >
            <Plus size={16} />
            Tarif
          </button>
        </div>
        <div className="tariff-table">
          {local.tariffs.map((t, i) => (
            <div key={t.id}>
              <input
                value={t.label}
                onChange={(e) => {
                  const a = [...local.tariffs];
                  a[i] = { ...t, label: e.target.value };
                  setLocal({ ...local, tariffs: a });
                }}
              />
              <select
                value={t.kind}
                onChange={(e) => {
                  const a = [...local.tariffs];
                  a[i] = { ...t, kind: e.target.value as typeof t.kind };
                  setLocal({ ...local, tariffs: a });
                }}
              >
                <option value="partial">Teilbetrag</option>
                <option value="full">Voller Tag</option>
                <option value="arrival">Anreise</option>
                <option value="departure">Abreise</option>
                <option value="mileage">Kilometer</option>
                <option value="breakfast">Frühstück</option>
                <option value="lunch">Mittag</option>
                <option value="dinner">Abend</option>
              </select>
              <input
                type="date"
                value={t.validFrom}
                onChange={(e) => {
                  const a = [...local.tariffs];
                  a[i] = { ...t, validFrom: e.target.value };
                  setLocal({ ...local, tariffs: a });
                }}
              />
              <input
                type="number"
                step="0.01"
                value={t.amount}
                onChange={(e) => {
                  const a = [...local.tariffs];
                  a[i] = { ...t, amount: Number(e.target.value) };
                  setLocal({ ...local, tariffs: a });
                }}
              />
              <span>{t.unit === "EUR" ? "€" : "%"}</span>
            </div>
          ))}
        </div>
      </section>
      <div className="sticky-save">
        <button className="primary" onClick={save}>
          <Save size={18} />
          Einstellungen speichern
        </button>
      </div>
    </div>
  );
}

function Backup({
  state,
  setState,
  notify,
  folder,
}: {
  state: AppState;
  setState: (s: AppState) => void;
  notify: (s: string) => void;
  folder: FolderStorage;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [restoring, setRestoring] = useState(false);
  usePendingWork(restoring);
  const restore = async (file?: File) => {
    if (!file) return;
    setRestoring(true);
    try {
      let restored: AppState;
      try {
        const parsed = JSON.parse(await file.text()) as AppState;
        if (!parsed.settings || !Array.isArray(parsed.trips)) throw new Error();
        restored = normalizeState(parsed);
      } catch { notify("Ungültige Datensicherung"); return; }
      // Ausdrücklich bestätigen; abgeschlossene Abrechnungen, die dabei wegfielen, werden genannt.
      const dropped = droppedClosings(state, restored);
      const linked = folder.status.kind === "ok";
      if (!confirm(`Aktuellen Datenbestand durch „${file.name}“ ersetzen?\n\nInhalt: ${restored.trips.length} Reisen, ${restored.expenses.length} Kosten, ${restored.statements.length} Abrechnungsversionen.${linked ? "\nDer aktuelle Stand wird vorher im SpesenKit-Ordner gesichert." : "\nOhne SpesenKit-Ordner gibt es keine automatische Sicherung des aktuellen Stands – vorher „Sicherung herunterladen“ verwenden."}${dropped.length ? `\n\nACHTUNG: Diese abgeschlossenen Abrechnungen sind in der Datei nicht enthalten: ${dropped.join(", ")}.` : ""}`)) return;
      if (linked) {
        try { await folder.backupNow("vor_wiederherstellung"); }
        catch (error) { notify(`Nicht wiederhergestellt: Der aktuelle Stand konnte nicht gesichert werden (${error instanceof Error ? error.message : "Fehler"}).`); return; }
      }
      setState(restored);
      notify("Datensicherung wiederhergestellt");
    } finally { setRestoring(false); }
  };
  const reset = async () => {
    const linked = folder.status.kind === "ok";
    if (!confirm(linked ? "Wirklich alle Daten löschen? Auch die Datei im SpesenKit-Ordner wird geleert; der vorherige Stand bleibt als spesenkit.vorher.json im Ordner „Daten“." : "Wirklich alle lokalen Daten löschen?")) return;
    // Use the guarded autosave transaction, including its cross-tab check.
    setState(structuredClone(emptyState));
    notify("Lokale Daten gelöscht");
  };
  return (
    <div className="backup-grid">
      <FolderCard folder={folder} />
      <section className="card backup-card">
        <div className="backup-icon">
          <Download />
        </div>
        <h2>Vollständige Datensicherung</h2>
        <p>
          Exportiert Fahrten, Kosten, Belege, Regeln, Importprofile und
          abgeschlossene Abrechnungen als JSON.
        </p>
        <button className="primary" onClick={() => exportBackup(state)}>
          <Download size={18} />
          Sicherung herunterladen
        </button>
      </section>
      <section className="card backup-card">
        <div className="backup-icon">
          <RotateCcw />
        </div>
        <h2>Sicherung wiederherstellen</h2>
        <p>
          Vor dem Einspielen wird die vorhandene Datenbank ersetzt. Erstellen
          Sie vorher eine aktuelle Sicherung.
        </p>
        <input
          ref={input}
          hidden
          type="file"
          accept=".json"
          onChange={(e) => restore(e.target.files?.[0])}
        />
        <button className="ghost" onClick={() => input.current?.click()}>
          <Upload size={18} />
          JSON auswählen
        </button>
      </section>
      <section className="card full demo-box">
        <div>
          <p className="eyebrow">Demo-Modus</p>
          <h3>Alle Sonderfälle in Ruhe ausprobieren</h3>
          <p>
            Erzeugt erfundene Fahrten mit Grenzfällen, Mehrtagesreise,
            Mahlzeitenkürzung, Duplikat, Firmen- und Privatfahrzeug sowie
            fehlendem Beleg.
          </p>
        </div>
        <button
          className="ghost"
          onClick={() => {
            setState(demoState());
            notify("Demo-Daten geladen");
          }}
        >
          Demo-Daten laden
        </button>
      </section>
      <section className="card full">
        <div className="card-head">
          <div>
            <p className="eyebrow">Revisionsprotokoll</p>
            <h3>Letzte Änderungen</h3>
          </div>
          <span className="status-pill">{state.changes.length} Einträge</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Zeitpunkt</th>
                <th>Bereich</th>
                <th>Änderung</th>
                <th>Grund</th>
                <th>Profil</th>
              </tr>
            </thead>
            <tbody>
              {state.changes
                .slice()
                .reverse()
                .slice(0, 10)
                .map((c) => (
                  <tr key={c.id}>
                    <td>{new Date(c.changedAt).toLocaleString("de-DE")}</td>
                    <td>{c.entityType}</td>
                    <td>{c.field}</td>
                    <td>{c.reason}</td>
                    <td>{c.user}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          {state.changes.length === 0 && (
            <p className="muted" style={{ padding: "12px" }}>
              Noch keine manuellen Änderungen protokolliert.
            </p>
          )}
        </div>
      </section>
      <section className="danger-zone">
        <div>
          <h3>Alle lokalen Daten löschen</h3>
          <p>
            Dieser Vorgang kann nur mit einer zuvor exportierten Sicherung
            rückgängig gemacht werden.
          </p>
        </div>
        <button className="danger-button" onClick={reset}>
          <Trash2 size={17} />
          Daten löschen
        </button>
      </section>
    </div>
  );
}

/** Nach „Speichern & nächste“: Fokus auf das erste Eingabefeld des (neu gerenderten) Formulars. */
function focusFirstField() {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    document.querySelector<HTMLElement>(".modal-body input:not([type=hidden]):not([disabled]), .modal-body select, .modal-body textarea")?.focus();
  }));
}

/** Zähler der Stapelerfassung im Fenster. */
function BatchCount({ count, noun }: { count: number; noun: [string, string] }) {
  if (!count) return null;
  return <span className="batch-count" role="status">{count} {count === 1 ? noun[0] : noun[1]} in dieser Runde erfasst</span>;
}

function Modal({
  title,
  close,
  children,
  onSubmitShortcut,
  wide = false,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
  /** Breiteres Fenster für zweispaltige Formulare. */
  wide?: boolean;
  /** Strg+Enter (macOS: ⌘+Enter) im Fenster. */
  onSubmitShortcut?: () => void;
}) {
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className={wide ? "modal modal-wide" : "modal"}
        onKeyDown={onSubmitShortcut ? (e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onSubmitShortcut(); }
        } : undefined}
      >
        <header>
          <h2>{title}</h2>
          <button className="icon" onClick={close}>
            <X />
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
function Empty({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="empty">
      <div>{icon}</div>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
