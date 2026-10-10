"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Archive,
  BarChart3,
  Camera,
  Car,
  Check,
  ChevronRight,
  CircleGauge,
  Clock3,
  Copy,
  Download,
  FileDown,
  FileSpreadsheet,
  Fuel,
  Import,
  Inbox,
  LayoutDashboard,
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
  clearState,
  normalizeState,
} from "../lib/storage";
import {
  buildStatement,
  calculateDay,
  duplicateKey,
  expenseConflictsWithMileageAllowance,
  groupTripsByDay,
  round2,
  validateTrip,
} from "../lib/calculations";
import {
  canonicalFields,
  parseImportFile,
  rowsToTrips,
  suggestMapping,
} from "../lib/importer";
import { demoState } from "../lib/demo";
import { applyMerchantRule, recognizeReceiptLocally } from "../lib/receipt-ocr";
import {
  exportBackup,
  exportCsv,
  exportExcel,
  exportPdf,
  exportZip,
} from "../lib/exports";

type Tab =
  | "Übersicht"
  | "Fahrten importieren"
  | "Reisen"
  | "Kosten & Belege"
  | "Monatsabrechnungen"
  | "Auswertungen"
  | "Einstellungen"
  | "Datensicherung";
const tabs: { name: Tab; icon: typeof LayoutDashboard }[] = [
  { name: "Übersicht", icon: LayoutDashboard },
  { name: "Fahrten importieren", icon: Import },
  { name: "Reisen", icon: ReceiptText },
  { name: "Kosten & Belege", icon: Fuel },
  { name: "Monatsabrechnungen", icon: FileSpreadsheet },
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
  const [tab, setTab] = useState<Tab>("Übersicht");
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [sidebar, setSidebar] = useState(false);
  const [toast, setToast] = useState("");
  const [undoAction, setUndoAction] = useState<(() => void) | null>(null);
  const [quickOpen, setQuickOpen] = useState(false);
  const [receiptCaptureOpen, setReceiptCaptureOpen] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    loadState().then((s) => {
      setState(s);
      setReady(true);
    });
    if ("serviceWorker" in navigator) {
      const workerUrl = new URL("sw.js", document.baseURI);
      navigator.serviceWorker.register(workerUrl).catch(() => undefined);
    }
  }, []);
  useEffect(() => {
    if (ready) saveState(state);
  }, [state, ready]);
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
  const update = (fn: (s: AppState) => AppState) =>
    setState((s) => fn(structuredClone(s)));
  const statement = useMemo(() => buildStatement(state, month), [state, month]);
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
        <span />
        <p>Reisekosten werden lokal geladen …</p>
      </div>
    );
  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebar ? "open" : ""}`}>
        <div className="brand">
          <div className="brand-mark">RK</div>
          <div>
            <b>Reisekosten Pro</b>
            <small>Lokal · nachvollziehbar</small>
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
              className={tab === name ? "active" : ""}
              onClick={() => {
                setTab(name);
                setSidebar(false);
              }}
            >
              <Icon size={19} />
              <span>{name}</span>
              {name === "Übersicht" && issueCount > 0 && <em>{issueCount}</em>}
            </button>
          ))}
        </nav>
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
            <button
              className="ghost receipt-top"
              onClick={() => setReceiptCaptureOpen(true)}
            >
              <Camera size={17} />
              Beleg
            </button>
            <button
              className="primary quick-top"
              onClick={() => setQuickOpen(true)}
            >
              <Plus size={17} />
              Ausgabe
            </button>
            <label className="month-picker">
              Abrechnungsmonat
              <input
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
              />
            </label>
            <div className={`quality ${issueCount ? "warn" : "ok"}`}>
              <CircleGauge size={18} />
              <span>
                {issueCount ? `${issueCount} Prüfhinweise` : "Alles geprüft"}
              </span>
            </div>
          </div>
        </header>
        <div className="content">
          {tab === "Übersicht" && (
            <Dashboard
              state={state}
              month={month}
              statement={statement}
              issueCount={issueCount}
              go={setTab}
              update={update}
              notify={notify}
              openQuick={() => setQuickOpen(true)}
              openCapture={() => setReceiptCaptureOpen(true)}
            />
          )}
          {tab === "Fahrten importieren" && (
            <ImportWizard
              state={state}
              update={update}
              notify={notify}
              go={setTab}
            />
          )}
          {tab === "Reisen" && (
            <Trips
              state={state}
              month={month}
              update={update}
              notify={notify}
            />
          )}
          {tab === "Kosten & Belege" && (
            <Expenses
              state={state}
              month={month}
              update={update}
              notify={notify}
              openCapture={() => setReceiptCaptureOpen(true)}
            />
          )}
          {tab === "Monatsabrechnungen" && (
            <Statements
              state={state}
              month={month}
              statement={statement}
              update={update}
              notify={notify}
            />
          )}
          {tab === "Auswertungen" && <Reports state={state} month={month} />}
          {tab === "Einstellungen" && (
            <SettingsPanel state={state} update={update} notify={notify} />
          )}
          {tab === "Datensicherung" && (
            <Backup state={state} setState={setState} notify={notify} />
          )}
        </div>
      </main>
      <button
        className="quick-fab"
        onClick={() => setQuickOpen(true)}
        aria-label="Ausgabe schnell erfassen"
      >
        <Plus size={24} />
        <span>Ausgabe</span>
      </button>
      <button
        className="camera-fab"
        onClick={() => setReceiptCaptureOpen(true)}
        aria-label="Beleg fotografieren"
      >
        <Camera size={22} />
      </button>
      {quickOpen && (
        <QuickExpense
          state={state}
          month={month}
          update={update}
          notify={notify}
          close={() => setQuickOpen(false)}
        />
      )}
      {receiptCaptureOpen && (
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
  );
}

function Dashboard({
  state,
  month,
  statement,
  issueCount,
  go,
  update,
  notify,
  openQuick,
  openCapture,
}: {
  state: AppState;
  month: string;
  statement: ReturnType<typeof buildStatement>;
  issueCount: number;
  go: (t: Tab) => void;
  update: (f: (s: AppState) => AppState) => void;
  notify: (s: string) => void;
  openQuick: () => void;
  openCapture: () => void;
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
  return (
    <>
      <section className="month-command">
        <div className="command-intro">
          <div>
            <p className="eyebrow">Ihr schneller Monatsabschluss</p>
            <h2>
              {new Date(month + "-01T12:00").toLocaleDateString("de-DE", {
                month: "long",
                year: "numeric",
              })}
            </h2>
            <p>Nur die gelben Punkte brauchen Ihre Aufmerksamkeit.</p>
          </div>
          <div className="time-saved">
            <Sparkles size={18} />
            <span>
              {issueCount
                ? `${issueCount} Punkte offen`
                : "Bereit zum Abschluss"}
            </span>
          </div>
        </div>
        <div className="workflow-steps">
          <button onClick={() => go("Fahrten importieren")}>
            <span className={monthTrips.length ? "step-done" : "step-open"}>
              {monthTrips.length ? <Check size={18} /> : "1"}
            </span>
            <div>
              <b>Fahrten</b>
              <small>
                {monthTrips.length
                  ? `${monthTrips.length} übernommen`
                  : "Fahrtenbuch importieren"}
              </small>
            </div>
            <ChevronRight size={17} />
          </button>
          <button onClick={openCapture}>
            <span
              className={
                state.receiptInbox.some((item) => item.status !== "zugeordnet")
                  ? "step-warn"
                  : "step-done"
              }
            >
              <Camera size={18} />
            </span>
            <div>
              <b>Belege & Ausgaben</b>
              <small>
                {state.receiptInbox.filter(
                  (item) => item.status !== "zugeordnet",
                ).length
                  ? `${state.receiptInbox.filter((item) => item.status !== "zugeordnet").length} Belege warten`
                  : monthExpenses.length
                    ? `${monthExpenses.length} erfasst`
                    : "Beleg fotografieren"}
              </small>
            </div>
            <ChevronRight size={17} />
          </button>
          <button onClick={() => go("Reisen")}>
            <span className={issueCount ? "step-warn" : "step-done"}>
              {issueCount || <Check size={18} />}
            </span>
            <div>
              <b>Prüfen</b>
              <small>
                {issueCount ? "Nur Ausnahmen ansehen" : "Alles plausibel"}
              </small>
            </div>
            <ChevronRight size={17} />
          </button>
          <button onClick={() => go("Monatsabrechnungen")}>
            <span className={issueCount ? "step-locked" : "step-done"}>4</span>
            <div>
              <b>Abschließen</b>
              <small>PDF und Export erstellen</small>
            </div>
            <ChevronRight size={17} />
          </button>
        </div>
        {confirmable.length > 0 && (
          <div className="batch-confirm">
            <div>
              <Clock3 size={18} />
              <span>
                <b>{confirmable.length} vollständige Fahrten</b> können
                gemeinsam bestätigt werden.
              </span>
            </div>
            <button className="primary" onClick={confirmClearTrips}>
              Eindeutige Zeiten bestätigen
            </button>
          </div>
        )}
      </section>
      <section className="hero-panel compact">
        <div>
          <span className="status-pill">
            {monthTrips.length ? "Monat in Bearbeitung" : "Bereit zum Start"}
          </span>
          <h2>
            {monthTrips.length
              ? `${monthTrips.length} Fahrten – ${statement.rows.length} Reisetage`
              : "Fahrtenbuch importieren und loslegen"}
          </h2>
          <p>
            Fahrten importieren, Ausgaben kurz ergänzen und den Monat
            abschließen – ohne Buchhaltungsformular.
          </p>
        </div>
        <div className="hero-actions">
          {monthTrips.length && (
            <button className="ghost" onClick={openQuick}>
              <Plus size={18} /> Betrag erfassen
            </button>
          )}
          <button
            className="primary"
            onClick={() =>
              monthTrips.length ? openCapture() : go("Fahrten importieren")
            }
          >
            {monthTrips.length ? "Beleg fotografieren" : "Datei importieren"}
            {monthTrips.length ? (
              <Camera size={18} />
            ) : (
              <ChevronRight size={18} />
            )}
          </button>
        </div>
      </section>
      <section className="metric-grid">
        <Metric
          label="Dienstliche Kilometer"
          value={`${statement.rows.reduce((s, r) => s + r.totalKm, 0).toLocaleString("de-DE")} km`}
          sub={`${monthTrips.length} Fahrten`}
        />
        <Metric
          label="Tage mit Spesen"
          value={String(
            statement.rows.filter((r) => r.allowanceAfter > 0).length,
          )}
          sub={euro(statement.totals.allowance)}
        />
        <Metric
          label="Gesamtkosten"
          value={euro(statement.totals.grandTotal)}
          sub="inkl. Firmenkosten"
        />
        <Metric
          label="Offene Auszahlung"
          value={euro(statement.totals.openAmount)}
          sub="an Reisenden"
          strong
        />
      </section>
      <section className="dashboard-grid">
        <div className="card">
          <div className="card-head">
            <div>
              <p className="eyebrow">Monatsverlauf</p>
              <h3>Kostenaufteilung</h3>
            </div>
            <span className="muted">{month}</span>
          </div>
          <div className="cost-bars">
            {[
              ["Verpflegung", statement.totals.allowance],
              ["Kilometer", statement.totals.mileage],
              ["Tanken", statement.totals.fuel],
              ["Übernachtung", statement.totals.accommodation],
              ["Sonstiges", statement.totals.other],
            ].map(([label, value]) => (
              <div className="bar-row" key={String(label)}>
                <span>{label}</span>
                <div>
                  <i
                    style={{
                      width: `${Math.max(3, (Number(value) / Math.max(1, statement.totals.grandTotal)) * 100)}%`,
                    }}
                  />
                </div>
                <b>{euro(Number(value))}</b>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <div className="card-head">
            <div>
              <p className="eyebrow">Noch zu tun</p>
              <h3>Prüfliste</h3>
            </div>
            <span className={`count ${issueCount ? "yellow" : "green"}`}>
              {issueCount}
            </span>
          </div>
          <div className="check-list">
            <CheckRow
              label="Ungeprüfte Datensätze"
              value={issueCount}
              go={() => go("Reisen")}
            />
            <CheckRow
              label="Fehlende Belege"
              value={missingReceipts}
              go={() => go("Kosten & Belege")}
            />
            <CheckRow
              label="Mögliche Duplikate"
              value={duplicates}
              go={() => go("Fahrten importieren")}
            />
            <CheckRow
              label="Abrechnung erstellt"
              value={state.statements.some((s) => s.month === month) ? 0 : 1}
              go={() => go("Monatsabrechnungen")}
            />
          </div>
        </div>
      </section>
      <div className="notice">
        <ShieldCheck />
        <div>
          <b>Gesetzliche Standardregel aktiv</b>
          <p>
            Mehr als 8 Stunden: 14,00 € · voller Tag: 28,00 €. Tarife werden
            anhand des Reisedatums bestimmt.
          </p>
        </div>
        <button className="ghost" onClick={() => go("Einstellungen")}>
          Regeln ansehen
        </button>
      </div>
    </>
  );
}

function Metric({
  label,
  value,
  sub,
  strong,
}: {
  label: string;
  value: string;
  sub: string;
  strong?: boolean;
}) {
  return (
    <div className={`metric ${strong ? "strong" : ""}`}>
      <span>{label}</span>
      <b>{value}</b>
      <small>{sub}</small>
    </div>
  );
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

const quickPresets: Array<{
  label: string;
  category: string;
  payment: Expense["paymentType"];
  vat: number;
}> = [
  {
    label: "Parken",
    category: "Parken",
    payment: "privat vorgestreckt",
    vat: 19,
  },
  { label: "Tanken", category: "Tanken", payment: "Firmenkarte", vat: 19 },
  { label: "Hotel", category: "Hotel", payment: "privat vorgestreckt", vat: 7 },
  { label: "Bahn", category: "Bahn", payment: "privat vorgestreckt", vat: 7 },
  { label: "Taxi", category: "Taxi", payment: "privat vorgestreckt", vat: 7 },
  {
    label: "Sonstiges",
    category: "sonstige Nebenkosten",
    payment: "privat vorgestreckt",
    vat: 19,
  },
];

function QuickExpense({
  state,
  month,
  update,
  notify,
  close,
}: {
  state: AppState;
  month: string;
  update: (f: (s: AppState) => AppState) => void;
  notify: (s: string, undo?: () => void) => void;
  close: () => void;
}) {
  const now = new Date().toISOString().slice(0, 10);
  const defaultDate = now.startsWith(month) ? now : `${month}-01`;
  const [draft, setDraft] = useState<Expense>({
    ...blankExpense(),
    date: defaultDate,
    category: "Parken",
    description: "Parken",
    vatRate: 19,
  });
  const [advanced, setAdvanced] = useState(false);
  const amountRef = useRef<HTMLInputElement>(null);
  useEffect(() => amountRef.current?.focus(), []);

  const selectPreset = (preset: (typeof quickPresets)[number]) => {
    setDraft((d) => ({
      ...d,
      category: preset.category,
      description: preset.label,
      paymentType: preset.payment,
      paidBy:
        preset.payment === "privat vorgestreckt" ? "Reisender" : "Unternehmen",
      reimbursementStatus:
        preset.payment === "privat vorgestreckt"
          ? "offen"
          : "nicht erstattungsfähig",
      vatRate: preset.vat,
    }));
    requestAnimationFrame(() => amountRef.current?.focus());
  };

  const addReceipt = async (file?: File) => {
    if (!file) return;
    const dataUrl = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsDataURL(file);
    });
    const hash = crypto.subtle
      ? await crypto.subtle
          .digest("SHA-256", await file.arrayBuffer())
          .then((bytes) =>
            [...new Uint8Array(bytes)]
              .map((x) => x.toString(16).padStart(2, "0"))
              .join(""),
          )
      : `${file.name}-${file.size}`;
    setDraft((d) => ({
      ...d,
      receipt: {
        id: uid(),
        name: file.name,
        type: file.type,
        size: file.size,
        hash,
        dataUrl,
      },
    }));
  };

  const saveQuick = () => {
    if (!(draft.gross > 0)) {
      notify("Bitte zuerst einen Betrag eingeben");
      amountRef.current?.focus();
      return;
    }
    const vatRate = draft.vatRate || 0;
    const net = round2(draft.gross / (1 + vatRate / 100));
    const autoTrip =
      draft.tripId || state.trips.find((t) => t.date === draft.date)?.id;
    const duplicateReceipt =
      !!draft.receipt &&
      state.expenses.some((e) => e.receipt?.hash === draft.receipt?.hash);
    const item: Expense = {
      ...draft,
      id: uid(),
      tripId: autoTrip,
      net,
      vat: round2(draft.gross - net),
      status: draft.receipt ? "vollständig" : "geprüft",
      warnings: duplicateReceipt ? ["Möglicher doppelter Beleg"] : [],
    };
    update((s) => {
      s.expenses.push(item);
      return s;
    });
    notify(`${item.category}: ${euro(item.gross)} gespeichert`, () =>
      update((s) => {
        s.expenses = s.expenses.filter((expense) => expense.id !== item.id);
        return s;
      }),
    );
    close();
  };

  return (
    <div
      className="quick-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <section className="quick-sheet" aria-label="Ausgabe schnell erfassen">
        <header>
          <div>
            <p className="eyebrow">Schnellerfassung</p>
            <h2>Ausgabe in wenigen Sekunden</h2>
          </div>
          <button className="icon" onClick={close} aria-label="Schließen">
            <X />
          </button>
        </header>
        <div className="quick-presets">
          {quickPresets.map((preset) => (
            <button
              key={preset.label}
              className={draft.category === preset.category ? "active" : ""}
              onClick={() => selectPreset(preset)}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="quick-core">
          <label className="quick-amount">
            Betrag
            <div>
              <input
                ref={amountRef}
                inputMode="decimal"
                type="number"
                min="0"
                step="0.01"
                placeholder="0,00"
                value={draft.gross || ""}
                onChange={(e) =>
                  setDraft({ ...draft, gross: Number(e.target.value) })
                }
                onKeyDown={(e) => e.key === "Enter" && saveQuick()}
              />
              <span>€</span>
            </div>
          </label>
          <label
            className={`receipt-button ${draft.receipt ? "has-file" : ""}`}
          >
            <Camera size={21} />
            <span>
              {draft.receipt ? draft.receipt.name : "Beleg fotografieren"}
            </span>
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.heic,image/*"
              capture="environment"
              onChange={(e) => addReceipt(e.target.files?.[0])}
            />
          </label>
          <button className="primary quick-save" onClick={saveQuick}>
            <Check size={20} />
            Speichern
          </button>
        </div>
        <button
          className="advanced-toggle"
          onClick={() => setAdvanced(!advanced)}
        >
          {advanced
            ? "Weitere Angaben ausblenden"
            : "Datum, Zahlungsart oder Reise ändern"}
          <ChevronRight size={16} className={advanced ? "rotated" : ""} />
        </button>
        {advanced && (
          <div className="quick-advanced">
            <label>
              Datum
              <input
                type="date"
                value={draft.date}
                onChange={(e) => setDraft({ ...draft, date: e.target.value })}
              />
            </label>
            <label>
              Zahlungsart
              <select
                value={draft.paymentType}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    paymentType: e.target.value as Expense["paymentType"],
                  })
                }
              >
                <option>privat vorgestreckt</option>
                <option>Firmenkarte</option>
                <option>Unternehmen</option>
                <option>bereits erstattet</option>
              </select>
            </label>
            <label>
              Reise
              <select
                value={draft.tripId || ""}
                onChange={(e) =>
                  setDraft({ ...draft, tripId: e.target.value || undefined })
                }
              >
                <option value="">Automatisch nach Datum</option>
                {state.trips
                  .filter((t) => t.date.startsWith(month))
                  .map((t) => (
                    <option value={t.id} key={t.id}>
                      {dateDe(t.date)} · {t.destination}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Beschreibung
              <input
                value={draft.description}
                onChange={(e) =>
                  setDraft({ ...draft, description: e.target.value })
                }
              />
            </label>
          </div>
        )}
        <p className="quick-hint">
          Datum, Steuer und Reisezuordnung werden automatisch vorgeschlagen und
          können später jederzeit geändert werden.
        </p>
      </section>
    </div>
  );
}

function ReceiptCapture({
  state,
  month,
  update,
  notify,
  close,
  initial,
}: {
  state: AppState;
  month: string;
  update: (f: (s: AppState) => AppState) => void;
  notify: (s: string, undo?: () => void) => void;
  close: () => void;
  initial?: ReceiptInboxItem;
}) {
  const now = new Date().toISOString().slice(0, 10);
  const [receipt, setReceipt] = useState(initial?.receipt);
  const [suggestion, setSuggestion] = useState(
    initial?.suggestion || {
      date: now.startsWith(month) ? now : `${month}-01`,
      category: "sonstige Nebenkosten",
      vatRate: 19,
      confidence: 0,
    },
  );
  const [paymentType, setPaymentType] = useState<Expense["paymentType"]>(
    "privat vorgestreckt",
  );
  const [tripId, setTripId] = useState<string | undefined>(initial?.tripId);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [scanStatus, setScanStatus] = useState("");
  const [scanError, setScanError] = useState("");

  const automaticTripId = suggestion.date
    ? state.trips.find((trip) => trip.date === suggestion.date)?.id
    : undefined;
  const selectedTripId = tripId === undefined ? automaticTripId : tripId;
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

  const scan = async (nextReceipt: NonNullable<typeof receipt>) => {
    if (!/^image\/(jpeg|jpg|png|webp)$/i.test(nextReceipt.type)) {
      setScanError(
        "Dieser Dateityp kann gespeichert, aber nicht automatisch gelesen werden.",
      );
      return;
    }
    setScanning(true);
    setScanError("");
    try {
      const recognized = await recognizeReceiptLocally(
        nextReceipt.dataUrl,
        (value, status) => {
          setProgress(value);
          setScanStatus(status);
        },
      );
      const learned = applyMerchantRule(recognized, state.merchantRules);
      setSuggestion((current) => ({ ...current, ...learned.suggestion }));
      if (learned.rule) setPaymentType(learned.rule.paymentType);
    } catch {
      setScanError(
        "Die automatische Erkennung war nicht möglich. Der Beleg kann trotzdem gespeichert und manuell bestätigt werden.",
      );
    } finally {
      setScanning(false);
    }
  };

  const chooseFile = async (file?: File) => {
    if (!file) return;
    const dataUrl = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsDataURL(file);
    });
    const hash = crypto.subtle
      ? await crypto.subtle
          .digest("SHA-256", await file.arrayBuffer())
          .then((bytes) =>
            [...new Uint8Array(bytes)]
              .map((x) => x.toString(16).padStart(2, "0"))
              .join(""),
          )
      : `${file.name}-${file.size}`;
    const nextReceipt = {
      id: initial?.receipt.id || uid(),
      name: file.name,
      type: file.type,
      size: file.size,
      hash,
      dataUrl,
    };
    setReceipt(nextReceipt);
    void scan(nextReceipt);
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
    notes: initial?.notes || "",
  });

  const saveInbox = () => {
    if (!receipt) return;
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
    close();
  };

  const createExpenseFromReceipt = () => {
    if (!receipt || !suggestion.gross || !suggestion.date) {
      notify("Bitte Datum und Betrag bestätigen");
      return;
    }
    const vatRate = suggestion.vatRate ?? 19;
    const net = round2(suggestion.gross / (1 + vatRate / 100));
    const expenseId = initial?.expenseId || uid();
    const duplicate = duplicateReceipt;
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
    const expense: Expense = {
      id: expenseId,
      date: suggestion.date,
      tripId:
        selectedTripId ||
        state.trips.find((trip) => trip.date === suggestion.date)?.id,
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
        paymentType === "privat vorgestreckt" ? "Reisender" : "Unternehmen",
      reimbursementStatus:
        paymentType === "privat vorgestreckt"
          ? "offen"
          : "nicht erstattungsfähig",
      merchant: suggestion.merchant,
      invoiceNumber: suggestion.invoiceNumber,
      businessShare: 100,
      notes: "Aus Beleg-Eingang übernommen",
      receipt,
      status: duplicate ? "ungeprüft" : "vollständig",
      warnings: duplicate ? ["Möglicher doppelter Beleg"] : [],
    };
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
    close();
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
            <p className="eyebrow">Beleg-Eingang</p>
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
              {duplicateReceipt && (
                <div className="info-box yellow">
                  <Copy size={18} />
                  <div>
                    <b>Möglicher doppelter Beleg</b>
                    <p>
                      Diese Datei wurde bereits erfasst. Bitte prüfen Sie sie
                      vor dem Speichern.
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
                    value={suggestion.category || "sonstige Nebenkosten"}
                    onChange={(event) =>
                      setSuggestion({
                        ...suggestion,
                        category: event.target.value,
                      })
                    }
                  >
                    {expenseCategories.map((category) => (
                      <option key={category}>{category}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Zahlungsart
                  <select
                    value={paymentType}
                    onChange={(event) =>
                      setPaymentType(
                        event.target.value as Expense["paymentType"],
                      )
                    }
                  >
                    <option>privat vorgestreckt</option>
                    <option>Firmenkarte</option>
                    <option>Unternehmen</option>
                    <option>bereits erstattet</option>
                  </select>
                </label>
                <label className="wide">
                  Passende Reise
                  <select
                    value={selectedTripId || ""}
                    onChange={(event) => setTripId(event.target.value)}
                  >
                    <option value="">
                      Keine Reise gefunden / später zuordnen
                    </option>
                    {state.trips
                      .filter((trip) => trip.date.startsWith(month))
                      .map((trip) => (
                        <option key={trip.id} value={trip.id}>
                          {dateDe(trip.date)} · {trip.destination} ·{" "}
                          {trip.purpose}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
            </div>
          </div>
        )}
        {receipt && (
          <footer>
            <button className="ghost" onClick={saveInbox}>
              <Inbox size={17} />
              Nur im Eingang speichern
            </button>
            <button
              className="primary"
              onClick={createExpenseFromReceipt}
              disabled={scanning}
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
  update,
  notify,
  go,
}: {
  state: AppState;
  update: (f: (s: AppState) => AppState) => void;
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
  const rows = sheets[sheet] || [];
  const headers = rows[0] ? Object.keys(rows[0]) : [];
  const choose = async (f?: File) => {
    if (!f) return;
    setError("");
    setFile(f);
    try {
      const parsed = await parseImportFile(f);
      setFormat(parsed.format);
      if (parsed.format === "vimcar") setProfileName("Vimcar CSV");
      setSheets(parsed.sheets);
      const first = Object.keys(parsed.sheets)[0];
      setSheet(first);
      setMapping(suggestMapping(Object.keys(parsed.sheets[first]?.[0] || {})));
      setStep(2);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Datei konnte nicht gelesen werden.",
      );
    }
  };
  const applyProfile = (id: string) => {
    const p = state.profiles.find((x) => x.id === id);
    if (p) {
      setMapping(p.mapping);
      setProfileName(p.name);
    }
  };
  const doImport = () => {
    const converted = rowsToTrips(
      rows,
      mapping,
      state.trips,
      state.settings.vehicles,
      state.settings.defaultVehicleId,
      state.settings.homeAddress,
      state.settings.firstWorkplace,
    );
    update((s) => {
      s.trips.push(...converted.trips);
      const importedVehicle = converted.trips[0];
      const defaultVehicle = s.settings.vehicles.find(
        (vehicle) => vehicle.id === s.settings.defaultVehicleId,
      );
      if (
        converted.format === "vimcar" &&
        importedVehicle &&
        defaultVehicle &&
        defaultVehicle.name === "Mein Dienstwagen" &&
        !defaultVehicle.plate
      ) {
        defaultVehicle.name = importedVehicle.vehicle || defaultVehicle.name;
        defaultVehicle.plate = importedVehicle.plate;
      }
      s.profiles = [
        ...s.profiles.filter((p) => p.name !== profileName),
        {
          id: uid(),
          name: profileName,
          mapping,
          createdAt: new Date().toISOString(),
        },
      ];
      return s;
    });
    setResult(converted);
    setStep(5);
    notify(`${converted.trips.length} Betriebsfahrten importiert`);
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
              next={() => setStep(4)}
              disabled={!mapping.date}
            />
          </div>
        )}
        {step === 4 && (
          <div className="wizard-body">
            <p className="eyebrow">Vorschau</p>
            <h2>Bitte Daten kurz prüfen</h2>
            <DataTable headers={headers.slice(0, 7)} rows={rows.slice(0, 8)} />
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
            <WizardNav
              back={() => setStep(3)}
              next={doImport}
              nextLabel={
                format === "vimcar"
                  ? "Betriebsfahrten importieren"
                  : `${rows.length} Zeilen importieren`
              }
            />
          </div>
        )}
        {step === 5 && (
          <div className="success-state">
            <div className="success-icon">
              <Check />
            </div>
            <h2>Import abgeschlossen</h2>
            <p>
              {result?.trips.length || 0} Betriebsfahrten wurden übernommen.
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
              {result?.format === "vimcar" && (
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
                <span>Profil gespeichert</span>
              </div>
            </div>
            <button className="primary" onClick={() => go("Reisen")}>
              Import prüfen
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
    date: new Date().toISOString().slice(0, 10),
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

function Trips({
  state,
  month,
  update,
  notify,
}: {
  state: AppState;
  month: string;
  update: (f: (s: AppState) => AppState) => void;
  notify: (s: string) => void;
}) {
  const [editing, setEditing] = useState<Trip | null>(null);
  const [query, setQuery] = useState("");
  const trips = state.trips
    .filter(
      (t) =>
        t.date.startsWith(month) &&
        [t.destination, t.purpose, t.customer]
          .join(" ")
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime),
    );
  const groups = [...groupTripsByDay(trips).entries()]
    .filter(([d]) => d.startsWith(month))
    .sort(([a], [b]) => a.localeCompare(b));
  const save = () => {
    if (!editing) return;
    const t = {
      ...editing,
      sourceHash: duplicateKey(editing),
      warnings: validateTrip(editing),
      status: editing.absenceConfirmed
        ? ("geprüft" as ReviewStatus)
        : ("ungeprüft" as ReviewStatus),
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
    setEditing(null);
    notify("Reise gespeichert");
  };
  const del = (id: string) =>
    update((s) => {
      const old = s.trips.find((t) => t.id === id);
      if (old)
        s.changes.push({
          id: uid(),
          entityType: "trip",
          entityId: id,
          field: "Status",
          oldValue: old,
          newValue: "gelöscht",
          reason: "Manuell gelöscht",
          user: s.settings.profileName || "Lokales Profil",
          changedAt: new Date().toISOString(),
        });
      s.trips = s.trips.filter((t) => t.id !== id);
      return s;
    });
  const mealOnDay = (
    trip: Trip,
    date: string,
    meal: "breakfast" | "lunch" | "dinner",
  ) =>
    (trip.dailyMeals?.[date] ||
      (trip.date === date
        ? trip.meals
        : { breakfast: false, lunch: false, dinner: false }))[meal];
  const toggleDayMeal = (
    date: string,
    dayTrips: Trip[],
    meal: "breakfast" | "lunch" | "dinner",
  ) => {
    const host = dayTrips[0];
    if (!host) return;
    const nextValue = !dayTrips.some((t) => mealOnDay(t, date, meal));
    update((s) => {
      const trip = s.trips.find((t) => t.id === host.id);
      if (!trip) return s;
      const isMultiDay = !!trip.endDate && trip.endDate !== trip.date;
      if (isMultiDay || date !== trip.date) {
        const current = trip.dailyMeals?.[date] || {
          breakfast: false,
          lunch: false,
          dinner: false,
        };
        trip.dailyMeals = {
          ...(trip.dailyMeals || {}),
          [date]: { ...current, [meal]: nextValue },
        };
      } else {
        trip.meals = { ...trip.meals, [meal]: nextValue };
      }
      return s;
    });
    notify(
      `${meal === "breakfast" ? "Frühstück" : meal === "lunch" ? "Mittagessen" : "Abendessen"} ${nextValue ? "eingetragen" : "entfernt"}`,
    );
  };
  const confirmDay = (dayTrips: Trip[]) => {
    const ids = new Set(dayTrips.map((t) => t.id));
    update((s) => {
      s.trips = s.trips.map((trip) => {
        if (!ids.has(trip.id)) return trip;
        const next = { ...trip, absenceConfirmed: true };
        next.warnings = validateTrip(next);
        next.status = next.warnings.length ? "ungeprüft" : "geprüft";
        return next;
      });
      return s;
    });
    notify("Abwesenheitszeit bestätigt");
  };
  return (
    <>
      <div className="toolbar">
        <div className="search">
          <input
            placeholder="Ziel, Zweck oder Kunde suchen"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <button
          className="primary"
          onClick={() => setEditing(blankTrip(state.settings))}
        >
          <Plus size={18} />
          Reise erfassen
        </button>
      </div>
      <div className="day-list">
        {groups.length === 0 && (
          <Empty
            icon={<ReceiptText />}
            title="Noch keine Reisen in diesem Monat"
            text="Importieren Sie Ihr Fahrtenbuch oder erfassen Sie eine Reise manuell."
          />
        )}
        {groups.map(([date, dayTrips]) => {
          const c = calculateDay(date, dayTrips, state.settings);
          return (
            <article className="day-card" key={date}>
              <header>
                <div className="date-tile">
                  <b>
                    {new Date(date + "T12:00").toLocaleDateString("de-DE", {
                      day: "2-digit",
                    })}
                  </b>
                  <span>
                    {new Date(date + "T12:00").toLocaleDateString("de-DE", {
                      month: "short",
                    })}
                  </span>
                </div>
                <div className="day-title">
                  <h3>{c.destinations.join(" · ") || "Reiseziel offen"}</h3>
                  <p>
                    {c.firstStart}–{c.lastEnd} · {duration(c.absenceMinutes)} ·{" "}
                    {c.totalKm} km · {dayTrips.length} Fahrt
                    {dayTrips.length === 1 ? "" : "en"}
                  </p>
                </div>
                <div className="allowance">
                  <span>Spesen</span>
                  <b>{euro(c.allowanceAfter)}</b>
                </div>
              </header>
              {c.warnings.length > 0 && (
                <div className="warning-line">
                  <AlertTriangle size={16} />
                  <span>
                    {c.warnings[0]}
                    {c.warnings.length > 1 &&
                      ` + ${c.warnings.length - 1} weitere`}
                  </span>
                  {dayTrips.some((t) => !t.absenceConfirmed) && (
                    <button onClick={() => confirmDay(dayTrips)}>
                      Zeit bestätigen
                    </button>
                  )}
                </div>
              )}
              <div className="day-quick-actions">
                <span>Gestellte Mahlzeit:</span>
                {(
                  [
                    ["breakfast", "Frühstück"],
                    ["lunch", "Mittag"],
                    ["dinner", "Abend"],
                  ] as const
                ).map(([meal, label]) => {
                  const active = dayTrips.some((t) => mealOnDay(t, date, meal));
                  return (
                    <button
                      key={meal}
                      className={active ? "active" : ""}
                      onClick={() => toggleDayMeal(date, dayTrips, meal)}
                    >
                      {active && <Check size={14} />}
                      {label}
                    </button>
                  );
                })}
              </div>
              <div className="formula">
                <span>{c.reason}</span>
                <code>
                  {euro(c.allowanceBefore)} – {euro(c.breakfastCut)} –{" "}
                  {euro(c.lunchCut)} – {euro(c.dinnerCut)} ={" "}
                  <b>{euro(c.allowanceAfter)}</b>
                </code>
              </div>
              <div className="trip-rows">
                {dayTrips.map((t) => (
                  <div key={t.id}>
                    <span
                      className={`status-dot ${t.warnings.length ? "warn" : "ok"}`}
                    />
                    <b>
                      {t.startTime}–{t.endTime}
                    </b>
                    <span>
                      {t.startPlace || "Start offen"} →{" "}
                      {t.destination || "Ziel offen"}
                    </span>
                    <span>{t.purpose || "Zweck fehlt"}</span>
                    <span>{t.businessKm} km</span>
                    <button
                      className="link"
                      onClick={() => setEditing(structuredClone(t))}
                    >
                      Bearbeiten
                    </button>
                    <button
                      className="icon danger"
                      onClick={() => del(t.id)}
                      aria-label="Löschen"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            </article>
          );
        })}
      </div>
      {editing && (
        <Modal
          title={
            state.trips.some((t) => t.id === editing.id)
              ? "Reise bearbeiten"
              : "Reise erfassen"
          }
          close={() => setEditing(null)}
        >
          <TripForm
            trip={editing}
            setTrip={setEditing}
            settings={state.settings}
          />
          <div className="modal-actions">
            <button className="ghost" onClick={() => setEditing(null)}>
              Abbrechen
            </button>
            <button className="primary" onClick={save}>
              <Save size={17} />
              Speichern
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

function TripForm({
  trip,
  setTrip,
  settings,
}: {
  trip: Trip;
  setTrip: (t: Trip) => void;
  settings: AppState["settings"];
}) {
  const set = <K extends keyof Trip>(k: K, v: Trip[K]) =>
    setTrip({ ...trip, [k]: v });
  const selectedVehicle = (settings.vehicles || []).find(
    (vehicle) => vehicle.id === trip.vehicleId,
  );
  return (
    <div className="form-grid">
      <label>
        Datum
        <input
          type="date"
          value={trip.date}
          onChange={(e) => set("date", e.target.value)}
        />
      </label>
      <label>
        Enddatum
        <input
          type="date"
          value={trip.endDate || ""}
          onChange={(e) => set("endDate", e.target.value || undefined)}
        />
      </label>
      <label>
        Beginn
        <input
          type="time"
          step="1"
          value={trip.startTime}
          onChange={(e) => set("startTime", e.target.value)}
        />
      </label>
      <label>
        Ende
        <input
          type="time"
          step="1"
          value={trip.endTime}
          onChange={(e) => set("endTime", e.target.value)}
        />
      </label>
      <label>
        Startort
        <input
          value={trip.startPlace}
          onChange={(e) => set("startPlace", e.target.value)}
        />
      </label>
      <label>
        Reiseziel
        <input
          value={trip.destination}
          onChange={(e) => set("destination", e.target.value)}
        />
      </label>
      <label className="wide">
        Reisezweck
        <input
          value={trip.purpose}
          onChange={(e) => set("purpose", e.target.value)}
        />
      </label>
      <label>
        Kunde
        <input
          value={trip.customer}
          onChange={(e) => set("customer", e.target.value)}
        />
      </label>
      <label>
        Auftrag / Aktenzeichen
        <input
          value={trip.order}
          onChange={(e) => set("order", e.target.value)}
        />
      </label>
      <label>
        Verwendetes Fahrzeug
        <select
          value={trip.vehicleId || ""}
          onChange={(e) => {
            const vehicle = settings.vehicles.find(
              (item) => item.id === e.target.value,
            );
            if (!vehicle) return setTrip({ ...trip, vehicleId: undefined });
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
      <MealEditor trip={trip} setTrip={setTrip} />
      <label className="check wide confirm">
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
  const start = new Date(`${trip.date}T12:00:00`);
  const end = new Date(`${trip.endDate || trip.date}T12:00:00`);
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
      return setTrip({ ...trip, meals: { ...trip.meals, [field]: checked } });
    const current = trip.dailyMeals?.[day] || {
      breakfast: false,
      lunch: false,
      dinner: false,
    };
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
          ? trip.dailyMeals?.[day] || {
              breakfast: false,
              lunch: false,
              dinner: false,
            }
          : trip.meals;
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
function Expenses({
  state,
  month,
  update,
  notify,
  openCapture,
}: {
  state: AppState;
  month: string;
  update: (f: (s: AppState) => AppState) => void;
  notify: (s: string, undo?: () => void) => void;
  openCapture: () => void;
}) {
  const [editing, setEditing] = useState<Expense | null>(null);
  const [reviewing, setReviewing] = useState<ReceiptInboxItem | null>(null);
  const inboxItems = state.receiptInbox.filter(
    (item) =>
      item.status !== "zugeordnet" &&
      ((item.suggestion.date || "").startsWith(month) ||
        item.capturedAt.startsWith(month)),
  );
  const items = state.expenses
    .filter((e) => e.date.startsWith(month))
    .sort((a, b) => a.date.localeCompare(b.date));
  const mileageConflict =
    !!editing &&
    expenseConflictsWithMileageAllowance(state.settings, state.trips, editing);
  const save = () => {
    if (!editing) return;
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
      return s;
    });
    setEditing(null);
    notify("Kostenposition gespeichert");
  };
  const receipt = async (file?: File) => {
    if (!file || !editing) return;
    const dataUrl = await new Promise<string>((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.readAsDataURL(file);
    });
    const hash = await crypto.subtle
      .digest("SHA-256", await file.arrayBuffer())
      .then((b) =>
        [...new Uint8Array(b)]
          .map((x) => x.toString(16).padStart(2, "0"))
          .join(""),
      );
    setEditing({
      ...editing,
      receipt: {
        id: uid(),
        name: file.name,
        type: file.type,
        size: file.size,
        hash,
        dataUrl,
      },
    });
  };
  return (
    <>
      <section
        className={`receipt-inbox card ${inboxItems.length ? "" : "empty"}`}
      >
        <div className="card-head">
          <div>
            <p className="eyebrow">Beleg-Eingang</p>
            <h3>
              {inboxItems.length
                ? `${inboxItems.length} Beleg${inboxItems.length === 1 ? " wartet" : "e warten"} auf Zuordnung`
                : "Belege fotografieren und später zuordnen"}
            </h3>
          </div>
          {inboxItems.length ? (
            <span className="count yellow">{inboxItems.length}</span>
          ) : (
            <button className="primary" onClick={openCapture}>
              <Camera size={17} /> Beleg fotografieren
            </button>
          )}
        </div>
        {inboxItems.length ? (
          <div className="inbox-strip">
            {inboxItems.map((item) => (
              <article key={item.id}>
                <div className="inbox-thumb">
                  {item.receipt.type.startsWith("image/") &&
                  !item.receipt.type.includes("heic") ? (
                    // Data-URLs aus der lokalen IndexedDB benötigen keine Bildoptimierung.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.receipt.dataUrl} alt="Belegvorschau" />
                  ) : (
                    <ReceiptText size={24} />
                  )}
                </div>
                <div>
                  <b>{item.suggestion.merchant || "Neuer Beleg"}</b>
                  <span>
                    {item.suggestion.date
                      ? dateDe(item.suggestion.date)
                      : "Datum offen"}{" "}
                    ·{" "}
                    {item.suggestion.gross
                      ? euro(item.suggestion.gross)
                      : "Betrag offen"}
                  </span>
                </div>
                <button
                  className="primary"
                  onClick={() => setReviewing(structuredClone(item))}
                >
                  Prüfen
                </button>
              </article>
            ))}
          </div>
        ) : (
          <p className="receipt-inbox-empty">
            Fotografierte Belege können mit „Nur im Eingang speichern“ hier
            gesammelt und später in Ruhe geprüft werden.
          </p>
        )}
      </section>
      <div className="toolbar">
        <div>
          <p className="muted">
            {items.length} Kostenpositionen ·{" "}
            {euro(items.reduce((s, e) => s + e.gross, 0))}
          </p>
        </div>
        <button className="primary" onClick={() => setEditing(blankExpense())}>
          <Plus size={18} />
          Kosten erfassen
        </button>
      </div>
      <div className="expense-grid">
        {items.length === 0 && (
          <Empty
            icon={<ReceiptText />}
            title="Noch keine Kosten erfasst"
            text="Parken, Hotel, Tanken und weitere Reisekosten lassen sich mit Beleg dokumentieren."
          />
        )}
        {items.map((e) => (
          <article className="expense-card" key={e.id}>
            <div className="expense-icon">
              {e.category === "Tanken" ? <Fuel /> : <ReceiptText />}
            </div>
            <div>
              <span>
                {dateDe(e.date)} · {e.category}
              </span>
              <h3>{e.description || "Ohne Beschreibung"}</h3>
              <p>
                {e.paymentType} · {e.reimbursementStatus}
              </p>
            </div>
            <div className="expense-amount">
              <b>{euro(e.gross)}</b>
              <span className={e.receipt ? "receipt-ok" : "receipt-missing"}>
                {e.receipt ? "Beleg vorhanden" : "Beleg fehlt"}
              </span>
            </div>
            <button
              className="ghost"
              onClick={() => setEditing(structuredClone(e))}
            >
              Bearbeiten
            </button>
          </article>
        ))}
      </div>
      {editing && (
        <Modal title="Kosten & Beleg" close={() => setEditing(null)}>
          <div className="form-grid">
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
                value={editing.category}
                onChange={(e) =>
                  setEditing({ ...editing, category: e.target.value })
                }
              >
                {expenseCategories.map((c) => (
                  <option key={c}>{c}</option>
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
              Zahlungsart
              <select
                value={editing.paymentType}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    paymentType: e.target.value as Expense["paymentType"],
                  })
                }
              >
                <option>privat vorgestreckt</option>
                <option>Firmenkarte</option>
                <option>Unternehmen</option>
                <option>bereits erstattet</option>
              </select>
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
              Reisezuordnung
              <select
                value={editing.tripId || ""}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    tripId: e.target.value || undefined,
                  })
                }
              >
                <option value="">Keine Zuordnung</option>
                {state.trips.map((t) => (
                  <option value={t.id} key={t.id}>
                    {dateDe(t.date)} · {t.destination}
                  </option>
                ))}
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
            <label className="wide upload-box">
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
          </div>
          {mileageConflict && (
            <div className="error-box">
              <AlertTriangle />
              Mögliche Doppelerfassung: Bei Verwendung der Kilometerpauschale
              dürfen abgegoltene Fahrzeugkosten nicht zusätzlich angesetzt
              werden.
            </div>
          )}
          <div className="modal-actions">
            <button className="ghost" onClick={() => setEditing(null)}>
              Abbrechen
            </button>
            <button className="primary" onClick={save}>
              <Save size={17} />
              Speichern
            </button>
          </div>
        </Modal>
      )}
      {reviewing && (
        <ReceiptCapture
          state={state}
          month={month}
          update={update}
          notify={notify}
          initial={reviewing}
          close={() => setReviewing(null)}
        />
      )}
    </>
  );
}

function Statements({
  state,
  month,
  statement,
  update,
  notify,
}: {
  state: AppState;
  month: string;
  statement: ReturnType<typeof buildStatement>;
  update: (f: (s: AppState) => AppState) => void;
  notify: (s: string) => void;
}) {
  const existing = state.statements
    .filter((s) => s.month === month)
    .sort((a, b) => b.version - a.version)[0];
  const number =
    existing?.number ||
    `RK-${month.replace("-", "")}-${String(state.statements.length + 1).padStart(3, "0")}`;
  const usedVehicles = [
    ...new Map([
      ...statement.rows.flatMap((row) =>
        row.trips.map((trip) => {
          const profile = state.settings.vehicles.find(
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
      ...state.expenses
        .filter(
          (expense) => expense.date.startsWith(month) && expense.vehicleId,
        )
        .flatMap((expense) => {
          const profile = state.settings.vehicles.find(
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
  const create = () => {
    update((s) => {
      const latest = s.statements
        .filter((x) => x.month === month)
        .sort((a, b) => b.version - a.version)[0];
      const snap: StatementSnapshot = {
        id: uid(),
        month,
        number,
        createdAt: new Date().toISOString(),
        status: "vollständig",
        version: (latest?.version || 0) + 1,
        locked: false,
        data: statement,
      };
      s.statements.push(snap);
      return s;
    });
    notify("Abrechnung mit Tarifstand gespeichert");
  };
  const setStatus = (status: ReviewStatus) =>
    update((s) => {
      const x = s.statements.find((x) => x.id === existing?.id);
      if (x) {
        s.changes.push({
          id: uid(),
          entityType: "statement",
          entityId: x.id,
          field: "Status",
          oldValue: x.status,
          newValue: status,
          reason: "Status geändert",
          user: s.settings.profileName || "Lokales Profil",
          changedAt: new Date().toISOString(),
        });
        x.status = status;
        x.locked = ["freigegeben", "ausgezahlt"].includes(status);
      }
      return s;
    });
  return (
    <>
      <section className="statement-head">
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
            {state.expenses.filter((e) => e.date.startsWith(month)).length}{" "}
            Kostenpositionen · Tarifstand wird beim Abschluss eingefroren.
          </p>
        </div>
        <div className="statement-actions">
          {!existing && (
            <button className="primary" onClick={create}>
              <Save size={18} />
              Abrechnung erstellen
            </button>
          )}
          {existing && (
            <select
              value={existing.status}
              onChange={(e) => setStatus(e.target.value as ReviewStatus)}
            >
              <option>vollständig</option>
              <option>zur Freigabe eingereicht</option>
              <option>freigegeben</option>
              <option>ausgezahlt</option>
              <option>storniert</option>
            </select>
          )}
        </div>
      </section>
      <section className="card statement-profile">
        <div>
          <span>Name</span>
          <b>{state.settings.profileName || "Nicht hinterlegt"}</b>
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
      </section>
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
          <span>Offener Erstattungsbetrag</span>
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
        </div>
        <div className="export-buttons">
          <button onClick={() => exportPdf(statement, state, number)}>
            <FileDown />
            PDF
          </button>
          <button onClick={() => exportExcel(statement, state)}>
            <FileSpreadsheet />
            Excel
          </button>
          <button onClick={() => exportCsv(statement, state)}>
            <Download />
            CSV
          </button>
          <button onClick={() => exportCsv(statement, state, true)}>
            <FileSpreadsheet />
            DATEV-CSV
          </button>
          <button onClick={() => exportZip(statement, state, number)}>
            <Archive />
            ZIP + Belege
          </button>
        </div>
      </section>
    </>
  );
}

function Reports({ state, month }: { state: AppState; month: string }) {
  const data = buildStatement(state, month);
  const byCustomer = new Map<string, number>();
  data.rows.forEach((r) =>
    r.customers.forEach((c) =>
      byCustomer.set(
        c || "Ohne Kunde",
        (byCustomer.get(c || "Ohne Kunde") || 0) + r.openAmount,
      ),
    ),
  );
  const max = Math.max(1, ...[...byCustomer.values()]);
  return (
    <div className="report-grid">
      <section className="card">
        <p className="eyebrow">Kosten nach Kunde</p>
        <h3>Wer verursacht welche Reisekosten?</h3>
        <div className="ranking">
          {[...byCustomer.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => (
              <div key={k}>
                <span>{k}</span>
                <div>
                  <i style={{ width: `${(v / max) * 100}%` }} />
                </div>
                <b>{euro(v)}</b>
              </div>
            ))}
          {byCustomer.size === 0 && (
            <p className="muted">Noch keine Kundendaten im gewählten Monat.</p>
          )}
        </div>
      </section>
      <section className="card">
        <p className="eyebrow">Offene Erstattungen</p>
        <h3>{euro(data.totals.openAmount)}</h3>
        <div className="big-number">
          <span>{data.rows.length}</span>
          <p>Reisetage</p>
        </div>
        <div className="big-number">
          <span>
            {
              state.expenses.filter(
                (e) => e.date.startsWith(month) && !e.receipt,
              ).length
            }
          </span>
          <p>fehlende Belege</p>
        </div>
      </section>
      <section className="card full">
        <p className="eyebrow">Monatsvergleich</p>
        <h3>Reisekosten der letzten Monate</h3>
        <div className="month-bars">
          {Array.from({ length: 6 }, (_, i) => {
            const d = new Date(month + "-01T12:00");
            d.setMonth(d.getMonth() - 5 + i);
            const m = d.toISOString().slice(0, 7);
            const v = buildStatement(state, m).totals.grandTotal;
            return (
              <div key={m}>
                <b>{euro(v)}</b>
                <i
                  style={{
                    height: `${Math.max(
                      4,
                      (v /
                        Math.max(
                          1,
                          ...Array.from({ length: 6 }, (_, j) => {
                            const x = new Date(month + "-01T12:00");
                            x.setMonth(x.getMonth() - 5 + j);
                            return buildStatement(
                              state,
                              x.toISOString().slice(0, 7),
                            ).totals.grandTotal;
                          }),
                        )) *
                        150,
                    )}px`,
                  }}
                />
                <span>{d.toLocaleDateString("de-DE", { month: "short" })}</span>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
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
}: {
  state: AppState;
  setState: (s: AppState) => void;
  notify: (s: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const restore = async (file?: File) => {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as AppState;
      if (!parsed.settings || !Array.isArray(parsed.trips)) throw new Error();
      setState(normalizeState(parsed));
      notify("Datensicherung wiederhergestellt");
    } catch {
      notify("Ungültige Datensicherung");
    }
  };
  const reset = async () => {
    if (!confirm("Wirklich alle lokalen Daten löschen?")) return;
    await clearState();
    setState(structuredClone(emptyState));
    notify("Lokale Daten gelöscht");
  };
  return (
    <div className="backup-grid">
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

function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="modal">
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
