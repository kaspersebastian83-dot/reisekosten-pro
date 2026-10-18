import { describe, expect, it } from 'vitest';
import { emptyState } from '../lib/config';
import { demoState } from '../lib/demo';
import { buildStatement } from '../lib/calculations';
import { isMonth, localCalendarMonth, monthLabel, monthOverview, openActivityMonths, previousCalendarMonth, yearOverview } from '../lib/month-navigation';
import type { AppState, StatementSnapshot, Trip } from '../lib/types';
const trip=(extra: Partial<Trip> = {}): Trip => ({...demoState().trips[0],id:'synthetic-trip',date:'2026-07-20',endDate:'2026-07-22',tripType:'dienstlich',status:'ungeprüft',warnings:[],...extra});
const fresh=()=>structuredClone(emptyState);
const snapshot=(state:AppState,extra:Partial<StatementSnapshot> = {}): StatementSnapshot=>({id:'synthetic-snapshot',month:'2026-07',number:'SYNTHETIC-1',createdAt:'2026-08-01T10:00:00Z',status:'freigegeben',version:1,locked:true,data:buildStatement(state,'2026-07'),...extra});

describe('Lokale Monatsauswahl',()=>{
  it.each([[2026,11,5,'2026-11'],[2027,0,10,'2026-12'],[2026,0,1,'2025-12'],[2026,2,29,'2026-02']])('suggests previous local calendar month %s/%s/%s', (year,month,day,expected)=>{
    const date=new Date(year as number,month as number,day as number,0,1);
    expect(previousCalendarMonth(date)).toBe(expected);
    expect(localCalendarMonth(date)).toBe(`${year}-${String(Number(month)+1).padStart(2,'0')}`);
  });
  it('validates the shared native month input',()=>{
    for(const month of ['','2026-00','2026-13','0000-01','26-01'])expect(isMonth(month)).toBe(false);
    expect(isMonth('2026-08')).toBe(true);expect(monthLabel('2026-08')).toBe('August 2026');
  });
});

describe('Ausschließlich abgeleiteter Monatsstatus',()=>{
  it('offers all twelve months without creating records',()=>{
    const state=fresh();const before=structuredClone(state);
    const months=yearOverview(state,2026);
    expect(months.map(m=>m.month)).toEqual(Array.from({length:12},(_,i)=>`2026-${String(i+1).padStart(2,'0')}`));
    expect(months.every(m=>m.status==='open')).toBe(true);expect(state).toEqual(before);
  });
  it('does not treat calculation or a draft as explicit completion',()=>{
    const state=fresh();state.trips=[trip()];const before=structuredClone(state);
    buildStatement(state,'2026-07');expect(monthOverview(state,'2026-07').status).toBe('working');expect(state).toEqual(before);
    state.statements=[snapshot(state,{locked:false,status:'vollständig'})];
    expect(monthOverview(state,'2026-07').status).toBe('working');
  });
  it.each(['freigegeben','ausgezahlt'] as const)('recognizes only persisted locked %s as closed',status=>{
    const state=fresh();state.trips=[trip()];state.statements=[snapshot(state,{status})];
    expect(monthOverview(state,'2026-07').status).toBe('closed');
    state.statements[0].locked=false;expect(monthOverview(state,'2026-07').status).toBe('review');
  });
  it('shows a cancelled latest snapshot as an existing review condition',()=>{
    const state=fresh();state.trips=[trip()];state.statements=[snapshot(state,{status:'storniert'})];
    expect(monthOverview(state,'2026-07').status).toBe('review');
  });
  it('uses latest version like the current statement view',()=>{
    const state=fresh();state.trips=[trip()];state.statements=[snapshot(state),snapshot(state,{id:'new',version:2,locked:false,status:'vollständig'})];
    expect(monthOverview(state,'2026-07').status).toBe('working');
  });
  it('uses concrete stored warnings without adding tax or completeness checks',()=>{
    const state=fresh();state.trips=[trip({warnings:['Inlandsvorschau nach gespeicherten Regeln. Ausland ist nicht geprüft.'],absenceConfirmed:false})];
    expect(monthOverview(state,'2026-07').status).toBe('working'); // no new missing-confirmation check
    state.trips[0].warnings=['Reiseziel fehlt'];
    expect(monthOverview(state,'2026-07').status).toBe('review');expect(monthOverview(state,'2026-07').reasons).toEqual(['Reiseziel fehlt']);
    state.trips=[];state.expenses=[{...demoState().expenses[0],date:'2026-07-20',status:'ungeprüft',warnings:[]}];
    expect(monthOverview(state,'2026-07').status).toBe('working');
    state.expenses[0].warnings=['Beleg fehlt'];expect(monthOverview(state,'2026-07').status).toBe('review');
  });
  it('does not flag changes after closure or alter frozen data (reserved for 3.2)',()=>{
    const state=fresh();state.trips=[trip()];state.statements=[snapshot(state)];const frozen=structuredClone(state.statements);
    state.trips.push(trip({id:'new-trip',warnings:['Reiseziel fehlt']}));
    expect(monthOverview(state,'2026-07').status).toBe('closed');expect(monthOverview(state,'2026-07').tripCount).toBe(1);
    expect(state.statements).toEqual(frozen);
  });
  it('counts unique business trips by existing month overlap and ignores cancellations',()=>{
    const state=fresh();state.trips=[trip({date:'2026-07-31',endDate:'2026-08-02'}),trip({id:'private',tripType:'privat'}),trip({id:'cancelled',status:'storniert'})];
    expect(monthOverview(state,'2026-07').tripCount).toBe(1);expect(monthOverview(state,'2026-08').tripCount).toBe(1);
    expect(buildStatement(state,'2026-08').rows).toHaveLength(2);
  });
  it('uses invoice month for expenses, without moving costs to the linked trip month',()=>{
    const state=fresh();state.expenses=[{...demoState().expenses[0],date:'2026-08-05',tripId:'july-trip',status:'ungeprüft',warnings:[]}];
    expect(monthOverview(state,'2026-07').status).toBe('open');expect(monthOverview(state,'2026-08').status).toBe('working');
  });
});

describe('Älteste offene Monate',()=>{
  it('counts only past activity, including expense-only months, across years',()=>{
    const state=fresh();state.trips=[trip({date:'2025-12-31',endDate:'2026-01-02'}),trip({id:'aug',date:'2026-08-01',endDate:undefined}),trip({id:'future',date:'2027-01-01',endDate:undefined}),trip({id:'current',date:'2026-12-02',endDate:undefined})];
    state.expenses=[{...demoState().expenses[0],date:'2026-09-20',status:'ungeprüft',warnings:[]}];
    state.statements=[snapshot(state,{month:'2025-12'})];
    expect(openActivityMonths(state,new Date(2026,11,5)).map(m=>m.month)).toEqual(['2026-01','2026-08','2026-09']);
  });
  it('does not count empty months, empty drafts, cancelled entries or completed months',()=>{
    const state=fresh();state.trips=[trip({status:'storniert'})];state.statements=[snapshot(state,{month:'2026-06',locked:false,status:'vollständig'})];
    expect(openActivityMonths(state,new Date(2026,11,5))).toEqual([]);
    state.trips=[trip()];state.statements=[snapshot(state)];expect(openActivityMonths(state,new Date(2026,11,5))).toEqual([]);
  });
});
