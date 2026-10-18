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
  return <div className="month-workspace">
    <aside className="year-navigation card" aria-label="Jahresübersicht">
      <div className="year-switch">
        <button className="ghost" aria-label="Vorheriges Jahr" disabled={year<=1} onClick={()=>setYear(y=>y-1)}><ChevronLeft size={18} /></button>
        <h2 aria-live="polite">{year}</h2>
        <button className="ghost" aria-label="Nächstes Jahr" disabled={year>=9999} onClick={()=>setYear(y=>y+1)}><ChevronRight size={18} /></button>
      </div>
      <nav className="year-months" aria-label="Abrechnungsmonat auswählen">
        {rows.map((row,i)=><button key={row.month} className={`year-month month-${row.status} ${row.month===month?'selected':''}`} aria-current={row.month===month?'date':undefined} aria-label={`${monthLabel(row.month)} · ${row.label} · ${row.tripCount} ${row.tripCount===1?'Reise':'Reisen'}`} title={row.reasons.join(' · ') || row.label} onClick={()=>chooseMonth(row.month)}>
          <span className="month-symbol" aria-hidden="true">{symbols[row.status]}</span>
          <span className="month-name"><span className="month-full">{monthNames[i]}</span><span className="month-short" aria-hidden="true">{monthNames[i].slice(0,3)}</span><small>{row.tripCount} {row.tripCount===1?'Reise':'Reisen'}</small></span>
          <span className="month-state">{row.label}</span>
        </button>)}
      </nav>
      <p className="month-mobile-key">✓ Abgeschlossen · Δ Änderungen offen · ↻ Korrekturentwurf · ? Historie prüfen · ◐ In Bearbeitung · ○ Offen · ! Prüfung erforderlich</p>
      <p className="year-selection">Ausgewählt: <b>{monthLabel(month)}</b></p>
      <details className="month-legend"><summary>Status verstehen</summary><p>✓ Abgeschlossen und unverändert · Δ Abschluss mit offenen Änderungen · ↻ Abschluss vorhanden, Korrekturentwurf offen · ? Historie oder Stornierung prüfen.</p><p>Grün kennzeichnet einen gespeicherten, vergleichbaren Abschluss ohne bekannte nachträgliche Änderungen. PDF und Berechnung schließen keinen Monat ab. Freigabe und Auszahlung bleiben getrennt.</p><p>Ein Korrekturentwurf ersetzt den historischen Abschluss erst nach erneuter ausdrücklicher Freigabe. Eine stornierte neuere Version reaktiviert keine ältere Version.</p></details>
      <section className="month-backlog" aria-label="Offene Abrechnungsmonate">
        {backlog.length ? <><b>{backlog.length} {backlog.length===1?'Monat mit offener Abrechnung':'Monate mit offenen Abrechnungen'}</b><p>Zurückliegende Monate mit Einträgen oder prüfbedürftigen Abschlüssen.</p><button className="primary" onClick={()=>chooseMonth(backlog[0].month)}>Mit {monthLabel(backlog[0].month)} beginnen</button></> : <p>Keine offenen Abrechnungsmonate mit vorhandenen Einträgen. Alles im Blick.</p>}
      </section>
    </aside>
    <div className="month-statement">
      {children}
    </div>
  </div>;
}
