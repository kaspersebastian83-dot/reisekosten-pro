import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { AppState } from '../lib/types';
import { localCalendarMonth, monthLabel, monthNames, openActivityMonths, yearOverview, type MonthStatus } from '../lib/month-navigation';

const symbols: Record<MonthStatus,string> = {closed:'✓',working:'◐',open:'○',review:'!'};
export function MonthNavigation({state,month,onSelect,children}: {
  state: AppState; month: string; onSelect: (month: string)=>void; children: ReactNode;
}) {
  const [year,setYear] = useState(()=>Number(month.slice(0,4)));
  useEffect(()=>setYear(Number(month.slice(0,4))),[month]);
  const rows = useMemo(()=>yearOverview(state,year),[state,year]);
  const currentMonth = localCalendarMonth();
  const backlog = useMemo(()=>openActivityMonths(state),[state,currentMonth]);
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
      <p className="month-mobile-key">✓ Abgeschlossen · ◐ In Bearbeitung · ○ Offen · ! Prüfung erforderlich</p>
      <p className="year-selection">Ausgewählt: <b>{monthLabel(month)}</b></p>
      <details className="month-legend"><summary>Status verstehen</summary><p>✓ Abgeschlossen · ◐ In Bearbeitung · ○ Offen · ! Prüfung erforderlich</p><p>Grün entspricht der gespeicherten Freigabe/Auszahlung der jüngsten gesperrten Version. PDF und Berechnung schließen keinen Monat ab.</p><p>Rot zeigt nur konkrete gespeicherte Prüfhinweise oder einen stornierten/widersprüchlichen Abschlussstatus. Nachträgliche Änderungen werden hier noch nicht automatisch erkannt.</p></details>
      <section className="month-backlog" aria-label="Offene Abrechnungsmonate">
        {backlog.length ? <><b>{backlog.length} {backlog.length===1?'Monat mit offener Abrechnung':'Monate mit offenen Abrechnungen'}</b><p>Nur zurückliegende Monate mit Reisen oder Ausgaben.</p><button className="primary" onClick={()=>chooseMonth(backlog[0].month)}>Mit {monthLabel(backlog[0].month)} beginnen</button></> : <p>Keine offenen Abrechnungsmonate mit vorhandenen Einträgen. Alles im Blick.</p>}
      </section>
    </aside>
    <div className="month-statement">
      {children}
    </div>
  </div>;
}
