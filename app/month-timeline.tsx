import { useMemo } from 'react';
import { AlertTriangle, Car, ReceiptText } from 'lucide-react';
import type { AppState, StatementData } from '../lib/types';
import { monthTimeline, type TimelineEntry } from '../lib/month-timeline';
import { paymentLabel } from '../lib/receipt-linking';

const euro = (value: number) => value.toLocaleString('de-DE', {style: 'currency', currency: 'EUR'});
const dayLabel = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString('de-DE', {weekday: 'short', day: '2-digit', month: '2-digit'});
const short = (date: string) => `${date.slice(8, 10)}.${date.slice(5, 7)}.`;

/** Kompakte Monatsansicht: je Tag eine Zeile mit Verpflegung, darunter je Reise/Kostenposition eine Zeile. Klick bearbeitet. */
export function MonthTimeline({state, month, statement, edit, startTrip}: {
  state: AppState; month: string; statement: StatementData;
  edit: (target: {kind: 'trip' | 'expense'; id: string}) => void;
  /** Leerer Monat: direkter Einstieg. */
  startTrip?: () => void;
}) {
  const days = useMemo(() => monthTimeline(state, month, statement), [state, month, statement]);
  const counts = days.flatMap(d => d.entries).reduce((n, e) => e.kind === 'trip' ? (e.continued ? n : {...n, trips: n.trips + 1}) : {...n, expenses: n.expenses + 1}, {trips: 0, expenses: 0});
  const row = (entry: TimelineEntry) => {
    if (entry.kind === 'trip') {
      const t = entry.trip; const warnings = [...new Set(t.warnings)];
      const title = entry.continued ? `${t.destination || 'Dienstreise'} · Tag ${entry.dayOfTrip} von ${entry.days}` : `${t.startTime || '–'}–${t.endTime || '–'}${entry.days > 1 ? ` (bis ${short(t.endDate || t.date)})` : ''} · ${t.destination || 'Ziel fehlt'}`;
      const detail = entry.continued ? 'Fortsetzung der mehrtägigen Reise' : [t.purpose, t.order, t.businessKm ? `${t.businessKm.toLocaleString('de-DE')} km` : ''].filter(Boolean).join(' · ');
      return <button type="button" className={`timeline-entry trip${entry.continued ? ' continued' : ''}`} onClick={() => edit({kind: 'trip', id: t.id})} aria-label={`Dienstreise ${title} bearbeiten`}>
        <Car size={16} aria-hidden="true" />
        <span className="timeline-main"><b>{title}</b><small>{detail}</small></span>
        {warnings.length > 0 && <span className="timeline-flag" title={warnings.join(' · ')}><AlertTriangle size={14} aria-hidden="true" />{warnings.length === 1 ? 'Hinweis' : `${warnings.length} Hinweise`}</span>}
        {t.status === 'ungeprüft' || t.status === 'importiert' ? <span className="timeline-state">ungeprüft</span> : null}
      </button>;
    }
    const e = entry.expense; const trip = e.tripId ? state.trips.find(item => item.id === e.tripId) : undefined;
    const warnings = [...new Set(e.warnings)].filter(w => w !== 'Beleg fehlt');
    return <button type="button" className="timeline-entry expense" onClick={() => edit({kind: 'expense', id: e.id})} aria-label={`${e.category} ${e.description} bearbeiten`}>
      <ReceiptText size={16} aria-hidden="true" />
      <span className="timeline-main"><b>{e.category}{e.description ? ` · ${e.description}` : ''}</b><small>{[paymentLabel(e.paymentType), trip ? `Reise ${trip.destination || short(trip.date)}` : 'keiner Reise zugeordnet'].join(' · ')}</small></span>
      {!e.receipt && <span className="timeline-flag">Beleg fehlt</span>}
      {warnings.length > 0 && <span className="timeline-flag" title={warnings.join(' · ')}><AlertTriangle size={14} aria-hidden="true" />{warnings.length === 1 ? 'Hinweis' : `${warnings.length} Hinweise`}</span>}
      <span className="timeline-amount">{euro(e.gross)}</span>
    </button>;
  };
  return <section className="month-timeline" aria-label="Monat im Überblick">
    <h3>Monat im Überblick <small>{counts.trips} {counts.trips === 1 ? 'Dienstreise' : 'Dienstreisen'} · {counts.expenses} {counts.expenses === 1 ? 'Kostenposition' : 'Kostenpositionen'}</small></h3>
    {days.length === 0 ? <div className="timeline-empty"><p>Für diesen Monat ist noch nichts erfasst.</p>{startTrip && <button className="ghost" onClick={startTrip}>Erste Dienstreise erfassen</button>}</div> :
      <ol className="timeline-days">{days.map(d => <li key={d.date} className="timeline-day">
        <div className="timeline-date"><b>{dayLabel(d.date)}</b>{d.allowance !== null && <small title={d.allowanceReason}>{d.allowance > 0 ? `Verpflegung ${euro(d.allowance)}` : 'keine Pauschale'}</small>}</div>
        <ul>{d.entries.map(entry => <li key={entry.kind === 'trip' ? `t-${entry.trip.id}` : `e-${entry.expense.id}`}>{row(entry)}</li>)}</ul>
      </li>)}</ol>}
    {days.length > 0 && <p className="muted">Ein Klick auf eine Zeile öffnet sie zum Bearbeiten. Die Verpflegung je Tag stammt aus der Monatsberechnung (mehrere Reisen eines Tages teilen sich eine Pauschale).</p>}
  </section>;
}
