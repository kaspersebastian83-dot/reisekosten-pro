import { useMemo, type ReactNode } from 'react';
import { Camera, Plus } from 'lucide-react';
import type { AppState, StatementData } from '../lib/types';
import { latestStatement, monthLabel, monthOverview } from '../lib/month-navigation';
import { round2 } from '../lib/calculations';
import { isClosedStatement, type StatementComparison } from '../lib/statement-comparison';
import { closingPreview, groupClosingIssues } from '../lib/statement-closing';

const euro = (value: number) => value.toLocaleString('de-DE', {style:'currency', currency:'EUR'});
export function MonthWorkspace({state, month, statement, startEntry, editCosts, editTrips, openCapture, openStatement, checks, comparison, changes, timeline}: {
  state: AppState; month: string; statement: StatementData;
  startEntry: (kind: 'trip' | 'Hotel' | 'Parken') => void;
  editCosts: () => void; editTrips: () => void; openCapture: () => void; openStatement: () => void; checks: ReactNode;
  comparison?: StatementComparison; changes?: ReactNode; timeline?: ReactNode;
}) {
  const existing = latestStatement(state, month);
  const overview = useMemo(() => monthOverview(state, month, comparison), [state, month, comparison]);
  const totals = statement.totals;
  const trips = new Set(statement.rows.flatMap(row => row.trips.map(trip => trip.id))).size;
  const expenses = state.expenses.filter(e => e.status !== 'storniert' && e.date.startsWith(month)).length;
  // Dieselbe Prüfung wie beim Abschluss – nur lesen, nichts anlegen.
  const preview = useMemo(() => closingPreview(state, month), [state, month]);
  const closed = !!existing && isClosedStatement(existing) && !comparison?.draft && !comparison?.hasChanges;
  const captured = trips + expenses > 0;
  const step = !captured ? 1 : closed ? 4 : preview.errors.length ? 2 : 3;
  const stepsAndAction = <section className="workspace-statement-action" aria-label="Monatsabrechnung">
    <h3>Abschluss</h3>
    <ol className="workspace-steps" aria-label="Weg zum Abschluss">
      <li className={step > 1 ? 'done' : 'current'}><b>Erfassen</b><small>{captured ? `${trips} ${trips === 1 ? 'Reise' : 'Reisen'}, ${expenses} ${expenses === 1 ? 'Kostenposition' : 'Kostenpositionen'}` : 'Noch nichts erfasst'}</small></li>
      <li className={closed ? 'done' : step === 2 ? 'current blocked' : step === 3 ? 'done' : ''}><b>Prüfen</b><small>{!captured ? '–' : closed ? 'Geprüft' : preview.errors.length ? `${preview.errors.length} Fehler vor dem Abschluss beheben` : preview.warnings.length ? `${preview.warnings.length} Hinweise in ${groupClosingIssues(preview.warnings).length} Gruppen – blockieren nicht` : 'Keine bekannten Probleme'}</small></li>
      <li className={closed ? 'done' : step === 3 ? 'current' : ''}><b>Abschließen</b><small>{closed ? `Abgeschlossen · Version ${existing!.version}` : existing && !existing.locked ? `Entwurf Version ${existing.version} – Abschlussprüfung öffnen` : 'Entwurf erstellen, prüfen und verbindlich abschließen'}</small></li>
    </ol>
    <button className="primary" onClick={openStatement}>{existing ? existing.locked ? 'Abrechnung ansehen' : 'Abrechnung fortsetzen' : 'Spesenabrechnung erstellen'}</button>
    <p className="muted">{existing ? `Version ${existing.version} · ${existing.status}. Prüfung und Freigabe erfolgen in der bestehenden Abrechnung.` : 'Der Entwurf entsteht erst auf Knopfdruck. Freigabe und Abschluss erfolgen anschließend separat.'}</p>
    {changes}
  </section>;
  return <section className="card month-entry-workspace" aria-label="Monatsarbeitsbereich">
    <header className="workspace-head">
      <div className="workspace-title"><p className="eyebrow">Monatsarbeitsbereich</p><h2>{monthLabel(month)}</h2><span className={`status-pill month-${overview.status}`}>{overview.label}</span></div>
      <section className="workspace-toolbar" aria-label="Spesen erfassen">
        <button className="primary workspace-trip-entry" onClick={() => startEntry('trip')}><Plus size={18}/> Dienstreise erfassen</button>
        <button className="ghost" onClick={() => startEntry('Hotel')}><Plus size={17}/> Hotelrechnung erfassen</button>
        <button className="ghost" onClick={() => startEntry('Parken')}><Plus size={17}/> Sonstige Kosten erfassen</button>
        <button className="ghost" onClick={openCapture} title="Beleg fotografieren oder Datei wählen; Text wird lokal erkannt"><Camera size={17}/> Beleg fotografieren / OCR</button>
      </section>
    </header>
    <div className="workspace-layout">
      <div className="workspace-main">
        {timeline}
        <div className="workspace-links">
          <button className="link" onClick={editTrips}>Alle Reisen bearbeiten</button>
          <button className="link" onClick={editCosts}>Alle Kosten & Belege bearbeiten</button>
          <span className="muted">Bei Rechnungen zählt das Rechnungsdatum für die Monatszuordnung.</span>
        </div>
        {checks}
      </div>
      <aside className="workspace-side">
        <section aria-label="Bisher erfasst" className="workspace-summary">
          <div className="workspace-reimbursement-summary">
            <b>{comparison?.baseline ? 'Persönlicher Erstattungsbetrag laut aktuellem Rechenstand' : 'Voraussichtliche persönliche Erstattung'}</b><strong>{euro(totals.openAmount)}</strong>
          </div>
          <dl className="workspace-figures">
            <div><dt>Dienstreisen</dt><dd>{trips}</dd></div>
            <div><dt>Verpflegungspauschalen · Vorschau</dt><dd>{euro(totals.allowance)}</dd></div>
            <div><dt>Hotelkosten · erfasst</dt><dd>{euro(totals.accommodation)}</dd></div>
            <div><dt>Weitere Kosten inkl. Tanken · erfasst</dt><dd>{euro(round2(totals.other + totals.fuel))}</dd></div>
          </dl>
          <p className="workspace-company-paid">Vom Unternehmen bezahlt: <b>{euro(totals.companyPaid)}</b></p>
          <details className="workspace-note"><summary>Wie entsteht die Vorschau?</summary><p>Aktueller Erfassungsstand nach den bestehenden Regeln. Erfasste Kosten sind nicht automatisch persönlich erstattungsfähig. Diese Vorschau erstellt keinen Abrechnungsentwurf.</p></details>
          {existing?.locked && <p className="notice">Die Übersicht zeigt aktuelle Eingaben. Der bereits abgeschlossene Bericht bleibt unverändert und ist über „Abrechnung ansehen“ erreichbar.</p>}
        </section>
        {stepsAndAction}
      </aside>
    </div>
  </section>;
}
