"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, BookOpen, MessageSquare, Camera, Check, CircleGauge, Menu, Plus, ShieldCheck, Undo2, X } from "lucide-react";
import type { AppState, Expense, Trip } from "../lib/types";
import { emptyState } from "../lib/config";
import { loadState, loadStateForApp, saveState, commitTripImport } from "../lib/storage";
import { buildStatement } from "../lib/calculations";
import { paymentPayer, syncExpenseLink } from "../lib/receipt-linking";
import { MissingReceiptImageError, detachReceipts, pruneReceiptImages } from "../lib/receipt-images";
import { Buerokasse, ModusChip, useKasseModus, type ModusWahl } from "./buerokasse";
import { latestStatement } from "../lib/month-navigation";
import { isClosedStatement, persistCorrectionDraft } from "../lib/statement-comparison";
import { FolderBanner, FolderConflictDialog, FolderStatusLine, useFolderStorage } from "./folder-storage";
import { persistStatementClosing, type ClosingConfirmation } from "../lib/statement-closing";
import { MonthNavigation } from "./month-navigation";
import { isMonth, previousCalendarMonth, localCalendarMonth, monthLabel, monthOverview } from "../lib/month-navigation";
import { slimChangeLog } from "../lib/change-log";
import { isEmptyState } from "../lib/folder-store";
import { useHandoff } from "./uebergabe";
import { ExportReadySheet, useExportShare } from "./export-share";
import { exportBackup } from "../lib/exports";

import { PendingWork } from "../lib/pending-work";
import { appRelease } from "../lib/release";
import { UpdateNotice } from "./update-notice";
import { openInboxItems } from "../lib/entry-removal";
import { Backup } from "./backup";
import { Expenses } from "./expenses";
import { ImportWizard } from "./import-wizard";
import { ReceiptCapture } from "./receipt-capture";
import { Reports } from "./reports";
import { SettingsPanel } from "./settings-panel";
import { type Tab, blankExpense, blankTrip, tabs, uid } from "./shared";
import { Statements } from "./statements";
import { Trips } from "./trips";

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
  // Arbeitsbereich je Gerät: Außendienst / Innendienst (persönliche Spesen) oder Bürokasse (Kassenbuch der Büro-Barkasse).
  const kasse = useKasseModus();
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
    if (kasse.modus === "buerokasse") { kasse.setModus("spesen"); setTab(target); return; }
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
    return loadStateForApp().then(({ state: s, embeddedImages }) => {
      lastSaved.current = s;
      // Einmalig: Belegbilder aus älteren Protokolleinträgen entfernen – wird wie jede Änderung gespeichert.
      // Ältere Stände mit eingebetteten Belegbildern: einmal im neuen Format speichern (Bilder getrennt, Bestand klein).
      const next = slimChangeLog(s);
      setState(embeddedImages && next === s ? { ...s } : next);
      setReady(true);
      // Nicht mehr verwendete Belegbilder im Browser aufräumen (nur ältere, siehe pruneReceiptImages).
      if (!embeddedImages) void loadState().then((current) => pruneReceiptImages(current)).catch(() => undefined);
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
  const exportShare = useExportShare(notify);
  const handoff = useHandoff(state, exportShare, notify, appRelease.version);
  // Belegbilder nie ins Änderungsprotokoll kopieren (siehe lib/change-log.ts).
  // Neu erfasste Belegbilder werden sofort herausgelöst: im Bestand steht nur der Verweis (lib/receipt-images.ts).
  const update = (fn: (s: AppState) => AppState) =>
    setState((s) => detachReceipts(slimChangeLog(fn(structuredClone(s)))));
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

  const wahleModus = (wahl: ModusWahl) => {
    if (!leaveForm()) return;
    if (wahl === "buerokasse") { kasse.setModus("buerokasse"); setSidebar(false); return; }
    kasse.setModus("spesen");
    if (state.settings.staffRole !== wahl) {
      update((s) => { s.settings.staffRole = wahl; return s; });
      notify(wahl === "innendienst" ? "Innendienst: nur Kosten und Belege, ohne Dienstreisen." : "Außendienst: Dienstreisen, Fahrtenbuch und Verpflegung.");
    }
  };
  /** Persönliche Kosten, die in die Bürokasse übernommen werden können (nicht storniert, Monat nicht abgeschlossen). */
  const kostenFuerKasse = {
    kosten: state.expenses.filter((e) => e.status !== "storniert" && e.paymentType !== "Bürokasse" && !(() => { const s = latestStatement(state, e.date.slice(0, 7)); return !!s && isClosedStatement(s); })()),
    uebernommen: (ids: string[]) => update((s) => {
      for (const expense of s.expenses) if (ids.includes(expense.id)) {
        expense.paymentType = "Bürokasse"; expense.paidBy = paymentPayer("Bürokasse"); expense.reimbursementStatus = "nicht erstattungsfähig";
        syncExpenseLink(s, expense);
      }
      return s;
    }),
  };
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
              className={kasse.modus !== "buerokasse" && (tab === name || (tab === "Fahrten importieren" && name === "Monatsübersicht")) ? "active" : ""}
              aria-current={kasse.modus !== "buerokasse" && (tab === name || (tab === "Fahrten importieren" && name === "Monatsübersicht")) ? "page" : undefined}
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
        <a className="suite-link" href={`../rueckmeldung/?app=spesenkit&version=${encodeURIComponent(appRelease.version)}`} target="rueckmeldung" rel="noopener" title="Fehler oder Wunsch melden – öffnet das Rückmeldeformular in einem eigenen Fenster, Programm und Version sind schon eingetragen">
          <MessageSquare size={16} aria-hidden="true" />
          <span><b>Rückmeldung</b><small>Fehler oder Wunsch melden</small></span>
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
          <button onClick={() => void exportBackup(state, { download: true }).catch((error) => notify(error instanceof MissingReceiptImageError ? error.message : "JSON-Sicherung konnte nicht erstellt werden."))}>JSON-Sicherung herunterladen</button>
          <button onClick={() => setSaveRetry((n) => n + 1)}>Speichern erneut versuchen</button>
        </div>}
        {/* Der Hinweis gilt dem persönlichen SpesenKit-Ordner – in der Bürokasse hat sie ihre eigene Sicherung. */}
        {kasse.modus !== "buerokasse" && <FolderBanner folder={folder} openBackup={() => navigate("Datensicherung")} hasData={!isEmptyState(state)} handoff={handoff} />}
        <header className="topbar">
          <button
            className="icon mobile-only"
            onClick={() => setSidebar(true)}
            aria-label="Menü öffnen"
          >
            <Menu />
          </button>
          <div>
            <p className="eyebrow">{kasse.modus === "buerokasse" ? "Kassenbuch" : "Reisekostenabrechnung"}</p>
            <h1>{kasse.modus === "buerokasse" ? "Bürokasse" : tab}</h1>
          </div>
          <span className="modus-kopf"><ModusChip staffRole={state.settings.staffRole} modus={kasse.modus} kasse={kasse.sichtbar} onWahl={wahleModus} /></span>
          {kasse.modus !== "buerokasse" && <div className="top-actions">
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
          </div>}
        </header>
        <div className="content">
          {/* Handy: Der Arbeitsbereich steht einmal oben im Inhalt statt dauerhaft in der mitlaufenden Kopfzeile. */}
          <div className="modus-inhalt"><ModusChip staffRole={state.settings.staffRole} modus={kasse.modus} kasse={kasse.sichtbar} onWahl={wahleModus} /></div>
          {kasse.modus === "buerokasse" ? <Buerokasse appVersion={appRelease.version} notify={notify} uebernahme={kostenFuerKasse} /> : <>
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
              share={exportShare}
              sendStatus={handoff.phone ? handoff.status : undefined}
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
            <SettingsPanel state={state} update={update} notify={notify} kasse={kasse} />
          )}
          {tab === "Datensicherung" && (
            <Backup state={state} setState={setState} notify={notify} folder={folder} share={exportShare} handoff={handoff} />
          )}
          </>}
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
      {/* Handy: die zwei häufigsten Handgriffe immer in Daumenreichweite (nur bis 760 px sichtbar, siehe globals.css). */}
      {tab === "Monatsübersicht" && kasse.modus !== "buerokasse" && !editingTrip && !inlineExpense && !receiptCaptureOpen && !inboxQueue && (
        <nav className="quick-bar" aria-label="Schnell erfassen">
          <button type="button" className="primary" onClick={() => setReceiptCaptureOpen(true)}><Camera size={20} />Belegfoto</button>
          <button type="button" onClick={() => startMonthEntry("trip")}><Plus size={20} />Neue Reise</button>
        </nav>
      )}
      {receiptCaptureOpen && tab !== "Auswertungen" && (
        <ReceiptCapture
          state={state}
          month={month}
          update={update}
          notify={notify}
          close={() => setReceiptCaptureOpen(false)}
        />
      )}
      <ExportReadySheet share={exportShare} />
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
