// Aus app/page.tsx herausgelöst (1.18.3, unverändert verschoben); Übersicht im README unter „Aufbau der Oberfläche“.
import { useMemo, useState } from "react";
import type { AppState } from "../lib/types";
import { buildAnnualAnalysis } from "../lib/annual-reports";

import { euro } from "./shared";

export function Reports({ state, month }: { state: AppState; month: string }) {
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
