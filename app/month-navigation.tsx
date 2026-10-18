import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { AppState } from '../lib/types';
import { localCalendarMonth, monthLabel, monthNames, monthOverview, openActivityMonths, yearOverview, type MonthStatus } from '../lib/month-navigation';

const symbols: Record<MonthStatus,string> = {closed:'✓','closed-changed':'Δ',correction:'↻','history-review':'?',working:'◐',open:'○',review:'!'};
export function MonthNavigation({state,month,onSelect,children}: {
  state: AppState; month: string; onSelect: (month: string)=>void; children: ReactNode;
}) {
  const [year,setYear] = useState(()=>Number(month.slice(0,4)));
  useEffect(()=>setYear(Number(month.slice(0,4))),[month]);
  // Instance-local memoization: year navigation and backlog share month comparisons.
  const readOverview = useMemo(() => { const cache = new Map<string, ReturnType<typeof monthOverview>>(); return (value: string) => { if (!cache.has(value)) cache.set(value, monthOverview(state, value)); return cache.get(value)!; }; }, [state]);
  const rows = useMemo(()=>yearOverview(state,year,readOverview),[state,year,readOverview]);
  const currentMonth = localCalendarMonth();
  const backlog = useMemo(()=>openActivityMonths(state, new Date(),readOverview),[state,currentMonth,readOverview]);
  const chooseMonth = (value: string) => {setYear(Number(value.slice(0,4))); onSelect(value);};
  const statusText = (row: (typeof rows)[number]) => row.tripCount ? `${row.tripCount} ${row.tripCount===1?'Reise':'Reisen'}` : row.status === 'open' ? '' : row.label;
  return <div className="month-workspace">
    {/* Monatsleiste: Jahr und alle zwölf Monate in einer Zeile (Handy: zwei Reihen), Stand als Symbol. */}
    <nav className="year-navigation card" aria-label="Jahresübersicht">
      <div className="year-switch">
        <button className="ghost" aria-label="Vorheriges Jahr" disabled={year<=1} onClick={()=>setYear(y=>y-1)}><ChevronLeft size={18} /></button>
        <h2 aria-live="polite">{year}</h2>
        <button className="ghost" aria-label="Nächstes Jahr" disabled={year>=9999} onClick={()=>setYear(y=>y+1)}><ChevronRight size={18} /></button>
      </div>
      <div className="year-months" role="group" aria-label="Abrechnungsmonat auswählen">
        {rows.map((row,i)=><button key={row.month} className={`year-month month-${row.status} ${row.month===month?'selected':''}`} aria-current={row.month===month?'date':undefined} aria-label={`${monthLabel(row.month)} · ${row.label} · ${row.tripCount} ${row.tripCount===1?'Reise':'Reisen'}`} title={[row.label, ...row.reasons].join(' · ')} onClick={()=>chooseMonth(row.month)}>
          <span className="month-name">{monthNames[i].slice(0,3)}</span>
          <span className="month-symbol" aria-hidden="true">{symbols[row.status]}</span>
          <small className="month-state" aria-hidden="true"><span className="month-state-long">{statusText(row)}</span><span className="month-state-short">{row.tripCount || ''}</span></small>
        </button>)}
      </div>
      <div className="year-meta">
        <section className="month-backlog" aria-label="Offene Abrechnungsmonate">
          {backlog.length ? <><b>{backlog.length} {backlog.length===1?'Monat mit offener Abrechnung':'Monate mit offenen Abrechnungen'}</b><button className="link" onClick={()=>chooseMonth(backlog[0].month)}>Mit {monthLabel(backlog[0].month)} beginnen</button></> : <span>Keine offenen Abrechnungsmonate mit vorhandenen Einträgen.</span>}
        </section>
        <details className="month-legend"><summary>Status verstehen</summary><p>✓ Abgeschlossen · Δ Änderungen offen · ↻ Korrekturentwurf · ? Historie prüfen · ◐ In Bearbeitung · ○ Offen · ! Prüfung erforderlich.</p><p>Grün kennzeichnet einen gespeicherten, vergleichbaren Abschluss ohne bekannte nachträgliche Änderungen. PDF und Berechnung schließen keinen Monat ab. Freigabe und Auszahlung bleiben getrennt.</p><p>Ein Korrekturentwurf ersetzt den historischen Abschluss erst nach erneuter ausdrücklicher Freigabe. Eine stornierte neuere Version reaktiviert keine ältere Version.</p></details>
      </div>
    </nav>
    <div className="month-statement">
      {children}
    </div>
  </div>;
}
