import { useMemo, type ReactNode } from 'react';
import { Camera, Plus } from 'lucide-react';
import type { AppState, StatementData } from '../lib/types';
import { latestStatement, monthLabel, monthOverview } from '../lib/month-navigation';
import { round2 } from '../lib/calculations';
import type { StatementComparison } from '../lib/statement-comparison';

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
  return <section className="card month-entry-workspace" aria-label="Monatsarbeitsbereich">
    <header><p className="eyebrow">Monatsarbeitsbereich</p><h2>{monthLabel(month)}</h2><span className="status-pill">{overview.label}</span></header>
    <section aria-label="Spesen erfassen">
      <h3>Spesen erfassen</h3>
      <div className="workspace-entry-actions">
        <button className="primary workspace-trip-entry" onClick={() => startEntry('trip')}><Plus size={20}/> Dienstreise erfassen</button>
        <div className="workspace-secondary-entry-actions">
          <button className="ghost" onClick={() => startEntry('Hotel')}><Plus size={18}/> Hotelrechnung erfassen</button>
          <button className="ghost" onClick={() => startEntry('Parken')}><Plus size={18}/> Sonstige Kosten erfassen</button>
        </div>
      </div>
      <div className="workspace-edit-actions">
        <button className="ghost" onClick={openCapture}><Camera size={17}/> Beleg fotografieren / OCR</button>
        <button className="ghost" onClick={editTrips}>Reisen bearbeiten</button>
        <button className="ghost" onClick={editCosts}>Kosten & Belege bearbeiten</button>
      </div>
      <p className="muted">Eingaben werden lokal gespeichert und können später weiterbearbeitet werden. Bei Rechnungen zählt das tatsächliche Rechnungsdatum für die Monatszuordnung.</p>
    </section>
    {timeline}
    {checks}
    <section className="workspace-statement-action" aria-label="Monatsabrechnung">
      <h3>Monatsabrechnung</h3>
      <p>{existing ? `Version ${existing.version} · ${existing.status}. Prüfung und Freigabe erfolgen in der bestehenden Abrechnung.` : 'Erst nach der Erfassung bewusst einen Entwurf erstellen. Freigabe und Abschluss erfolgen anschließend separat.'}</p>
      <button className="primary" onClick={openStatement}>{existing ? existing.locked ? 'Abrechnung ansehen' : 'Abrechnung fortsetzen' : 'Spesenabrechnung erstellen'}</button>
      {changes}
    </section>
    <section aria-label="Bisher erfasst" className="workspace-summary">
      <h3>Bisher erfasst</h3>
      <dl className="workspace-figures">
        <div><dt>Dienstreisen</dt><dd>{trips}</dd></div>
        <div><dt>Verpflegungspauschalen · Vorschau</dt><dd>{euro(totals.allowance)}</dd></div>
        <div><dt>Hotelkosten · erfasst</dt><dd>{euro(totals.accommodation)}</dd></div>
        <div><dt>Weitere Kosten inkl. Tanken · erfasst</dt><dd>{euro(round2(totals.other + totals.fuel))}</dd></div>
      </dl>
      <div className="workspace-reimbursement-summary">
        <b>{comparison?.baseline ? 'Persönlicher Erstattungsbetrag laut aktuellem Rechenstand' : 'Voraussichtliche persönliche Erstattung'}</b><strong>{euro(totals.openAmount)}</strong>
      </div>
      <p className="workspace-company-paid">Vom Unternehmen bezahlt: <b>{euro(totals.companyPaid)}</b></p>
      <p className="muted">Aktueller Erfassungsstand nach den bestehenden Regeln. Erfasste Kosten sind nicht automatisch persönlich erstattungsfähig. Diese Vorschau erstellt keinen Abrechnungsentwurf.</p>
      {existing?.locked && <p className="notice">Die Übersicht zeigt aktuelle Eingaben. Der bereits abgeschlossene Bericht bleibt unverändert und ist über „Abrechnung ansehen“ erreichbar.</p>}
    </section>
  </section>;
}
