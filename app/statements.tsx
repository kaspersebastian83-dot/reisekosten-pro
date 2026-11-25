// Aus app/page.tsx herausgelöst (1.18.3, unverändert verschoben); Übersicht im README unter „Aufbau der Oberfläche“.
import { useEffect, useMemo, useRef, useState } from "react";
import { Archive, Car, Check, ChevronRight, Download, FileDown, FileSpreadsheet, Save, ShieldCheck } from "lucide-react";
import type { AppState, ReviewStatus, StatementSnapshot } from "../lib/types";
import { buildStatement, validateTrip } from "../lib/calculations";
import { MissingReceiptImageError } from "../lib/receipt-images";
import { MonthWorkspace } from "./month-workspace";
import { StatementClosing } from "./statement-closing";
import { StatementChanges } from "./statement-changes";
import { compareClosedStatementWithCurrent, isClosedStatement, relatedTripsForSnapshot, snapshotHistoryLimitations, stateForStatementVersion } from "../lib/statement-comparison";
import { MonthTimeline } from "./month-timeline";
import { StatementFiling, type FolderStorage } from "./folder-storage";
import { changeStatementStatus, type ClosingConfirmation, type ClosingIssue } from "../lib/statement-closing";
import { monthLabel, monthOverview } from "../lib/month-navigation";
import { touchDevice } from "../lib/device-settings";
import { type SendStatus } from "./uebergabe";
import { ExportDeliveryChoice, type ExportShare } from "./export-share";
import { exportCsv, exportExcel, exportPdf, printPdf, exportZip, correctionExportNotice } from "../lib/exports";

import { DayDetails, MonthDetails } from "./calculation-details";
import { openInboxItems } from "../lib/entry-removal";
import type { TimelineFilter } from "../lib/month-timeline";
import { dateDe, duration, euro, uid } from "./shared";

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
export function Statements({
  state,
  month,
  statement: currentStatement,
  update,
  notify,
  startEntry, openCapture, viewRules,
  commitClosing, editClosingIssue, commitCorrection, folder, openImport, startInbox, share, sendStatus,
}: {
  share: ExportShare;
  sendStatus?: (id: string) => SendStatus | undefined;
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
  // Handy/Tablet: Einzelaufstellung der Abrechnung zunächst zugeklappt (siehe unten); am PC gibt es das Aufklappen nicht.
  const [foldDetails] = useState(() => touchDevice());
  const [detailsOpen, setDetailsOpen] = useState(false);
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
    catch (error) { notify(error instanceof MissingReceiptImageError ? error.message : "Die PDF konnte nicht erstellt werden. Bitte erneut versuchen; die Abrechnung bleibt gespeichert."); }
    finally { pdfBusy.current = false; setPdfWorking(false); }
  };
  // Abgeschlossene Abrechnung: „Abrechnung weitergeben“ steht direkt unter dem Kopf statt am Seitenende (auf dem Handy lag
  // sie rund neun Bildschirme tiefer). Entwürfe behalten die bisherige Reihenfolge.
  const exportFirst = !!existing && isClosedStatement(existing);
  const exportCard = (
      <section className="card export-card">
        <div>
          <p className="eyebrow">Export</p>
          <h3>Abrechnung weitergeben</h3>
          <ExportDeliveryChoice share={share} />
          <p>
            PDF für Unterschrift, Tabellen für Buchhaltung oder Komplettpaket
            mit Belegen.
          </p>
          <p>Die Buchungsliste (CSV) nennt je Tag Datum, Text, Betrag und Kostenstelle – zum Abtippen oder Weiterverarbeiten, kein DATEV-Buchungsstapel.</p>
          <p>Tabellen enthalten den vollständigen ausgewählten Abrechnungsstand. Die bestehende Spalte „OffenerBetrag“ bezeichnet dessen rechnerischen Erstattungsbetrag, keine tatsächliche Restzahlung.</p>
          {exportContext?.correction && <p className="correction-payment-note">{correctionExportNotice} CSV-Exporte und Buchungsliste vor einer Übernahme mit der Buchhaltung abstimmen; frühere Versionen nicht zusätzlich buchen.</p>}
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
            if (exportContext?.correction && !window.confirm(`${correctionExportNotice}\n\nDiese Buchungsliste ist keine zusätzliche Differenzbuchung. Vor einer Übernahme frühere Buchungen und Zahlungen gesondert abstimmen. Vollständigen ausgewählten Stand trotzdem exportieren?`)) return;
            exportCsv(statement, exportState, true, exportContext);
          }}>
            <FileSpreadsheet />
            Buchungsliste (CSV)
          </button>
          <button onClick={() => void exportZip(statement, exportState, number, exportContext).catch((error) => notify(error instanceof MissingReceiptImageError ? error.message : "Das ZIP konnte nicht erstellt werden. Bitte erneut versuchen."))}>
            <Archive />
            ZIP + Belege
          </button>
        </div>
      </section>
  );
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
  const detailBlock = <>
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
  </>;
  const summaryGrid = (
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
  );
  return (
    <>
      <MonthWorkspace state={state} month={month} statement={currentStatement} startEntry={startEntry} openCapture={openCapture}
        openStatement={() => {if (latest) openVersion(); else create(true);}}
        comparison={comparison}
        changes={<StatementChanges comparison={comparison} creating={correctionSaving} error={correctionError} create={() => void correct()} resume={openVersion} />}
        openImport={openImport} inboxCount={openInboxItems(state).length} startInbox={startInbox}
        timeline={<MonthTimeline state={state} month={month} statement={currentStatement} edit={editClosingIssue} startTrip={() => startEntry('trip')} sendStatus={sendStatus} filter={timelineFilter} setFilter={setTimelineFilter} />}
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
      {exportFirst && exportCard}
      {/* Handy: erst die Summen, die Einzelaufstellung (breite Tabelle, Rechenweg je Tag) aufklappbar – die Seite war dort
          rund zehn Bildschirme lang. Am PC unverändert: alles offen, Summen nach der Einzelaufstellung. */}
      {foldDetails ? <>
        {summaryGrid}
        <details className="statement-fold" open={detailsOpen} onToggle={(event) => setDetailsOpen(event.currentTarget.open)}>
          <summary><span>Einzelaufstellung und Rechenweg</span><small>{statement.rows.length} {statement.rows.length === 1 ? "Tag" : "Tage"} · {detailsOpen ? "zuklappen" : "aufklappen"}</small></summary>
          {detailsOpen && detailBlock}
        </details>
      </> : <>{detailBlock}{summaryGrid}</>}
      {!exportFirst && exportCard}
      {existing && isClosedStatement(existing) && <StatementFiling folder={folder} snapshot={existing} label={`${monthLabel(month)} (Version ${existing.version})`} print={() => void makePdf(true)} />}
      </>}
    </>
  );
}
