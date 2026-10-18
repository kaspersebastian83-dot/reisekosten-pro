import { describe, it, expect } from 'vitest';
import { demoState } from '../lib/demo';
import { buildStatement, expenseReimbursable } from '../lib/calculations';
import { normalizeState } from '../lib/storage';
import { cleanContext, duplicateExpense, duplicateMessage, linkingErrors, matchingTrips, paymentPayer, projectNumber, similarExpense, syncExpenseLink } from '../lib/receipt-linking';
import { parseReceiptText } from '../lib/receipt-ocr';
import type { Expense, Trip } from '../lib/types';
const trip = (id = 'a', extra: Partial<Trip> = {}): Trip => ({...demoState().trips[0], id, order:'26.0123 Musterstadt', date:'2026-10-20',endDate:'2026-10-21',tripType:'dienstlich',status:'ungeprüft', ...extra});
const hotel = {category:'Hotel',date:'2026-10-29', projectNumber:'26.0123', stayStart:'2026-10-20',stayEnd:'2026-10-21'};
const expense = (extra: Partial<Expense> = {}): Expense => ({...demoState().expenses[0],id:'expense-a',date:'2026-10-29',category:'Hotel',gross:115,net:115,vat:0,vatRate:0,paymentType:'privat vorgestreckt',reimbursementStatus:'offen',businessShare:100,exchangeRate:1,merchant:'Musterhotel',invoiceNumber:'INV-001',...extra});

describe('Projekt- und zeitraumbezogene Belegzuordnung', () => {
  it('uses number identity independently of project place and late invoice date', () => {
    expect(projectNumber('26.0123 Anderer Ort')).toBe('26.0123');
    expect(matchingTrips(hotel,[trip(),trip('b',{date:'2026-11-20',endDate:'2026-11-21'}),trip('c',{order:'26.0124 Musterstadt'})]).map(t=>t.id)).toEqual(['a']);
  });
  it('returns all overlapping candidates, never first-match assignment', () => {
    expect(matchingTrips(hotel,[trip(),trip('b')]).map(t=>t.id)).toEqual(['a','b']);
    expect(hotel).not.toHaveProperty('tripId');
  });
  it('does not substitute hotel invoice date for stay period', () => {
    expect(matchingTrips({...hotel,projectNumber:undefined,stayStart:undefined,stayEnd:undefined},[trip()])).toEqual([]);
    expect(matchingTrips({...hotel,stayStart:undefined,stayEnd:undefined},[trip(),trip('b')])).toHaveLength(2);
  });
  it('excludes unrelated, cancelled and private journeys', () => {
    expect(matchingTrips({...hotel,projectNumber:'26.9999'},[trip()])).toEqual([]);
    expect(matchingTrips(hotel,[trip('a',{status:'storniert'}),trip('b',{tripType:'privat'})])).toEqual([]);
  });
  it('uses date containment for ordinary receipts, including multi-month trips', () => {
    expect(matchingTrips({category:'Parken',date:'2026-11-01',projectNumber:'26.0123'},[trip('a',{date:'2026-10-31',endDate:'2026-11-02'})])).toHaveLength(1);
  });
  it.each([{stayStart:'2026-10-22'}, {stayEnd:'2026-10-20'}, {stayStart:'2026-02-30'}, {stayEnd:undefined}, {projectNumber:'Kein Projektformat'}])('blocks invalid context %j', extra => {
    expect(linkingErrors({...hotel,...extra}).length).toBeGreaterThan(0);
    expect(matchingTrips({...hotel,...extra},[trip()])).toEqual([]);
  });
  it('extracts only a unique OCR project as an unconfirmed suggestion', () => {
    expect(parseReceiptText('Hotel Projekt 26.0123 Musterstadt Gesamt 115,00').projectNumber).toBe('26.0123');
    expect(parseReceiptText('Projekt 26.0123 / 26.0124').projectNumber).toBeUndefined();
    expect(parseReceiptText('Hotel Frühstück 20.10.2026 bis 21.10.2026')).not.toHaveProperty('breakfastIncluded');
  });
  it('keeps actual project reference, inbox and receipt synchronized without editing a snapshot', () => {
    const state=demoState(); const e=expense({tripId:'a',...hotel});
    state.expenses=[e];state.receiptInbox=[{id:'inbox',receipt:{id:'r',name:'test.pdf',type:'application/pdf',size:5,hash:'hash',dataUrl:'data:application/pdf;base64,AA=='},capturedAt:'2026-10-29',status:'zugeordnet',expenseId:e.id,tripId:'old',suggestion:{confidence:0},notes:''}];
    const snapshots=structuredClone(state.statements);const trips=structuredClone(state.trips);
    syncExpenseLink(state,e);expect(state.receiptInbox[0].tripId).toBe('a');
    syncExpenseLink(state,{...e,tripId:undefined});expect(state.receiptInbox[0].tripId).toBeUndefined();
    expect(state.trips).toEqual(trips);expect(state.statements).toEqual(snapshots);
  });
  it('blocks exact file and invoice identities but permits editing the same expense', () => {
    const receipt={id:'r',name:'a.pdf',type:'application/pdf',size:5,hash:'hash',dataUrl:'data:application/pdf;base64,AA=='};
    const e=expense({receipt});
    expect(duplicateExpense([e],{...e,id:'new',date:'2026-11-01',receipt:undefined,merchant:' MUSTERHOTEL '})).toBe(e);
    expect(duplicateExpense([e],{id:'new',receipt})).toBe(e);
    expect(duplicateExpense([e],e)).toBeUndefined();
    expect(similarExpense([e],{...e,id:'new',receipt:undefined,invoiceNumber:undefined})).toBe(e);
    expect(similarExpense([e],{...e,id:'new',receipt:undefined,invoiceNumber:'INV-002'})).toBeUndefined();
    const state=demoState();state.expenses=[];state.receiptInbox=[{id:'inbox',receipt,capturedAt:'2026-10-29',status:'neu',suggestion:{confidence:0},notes:''}];
    expect(duplicateMessage(state,{receipt})).toContain('Beleg-Eingang');
    expect(duplicateMessage(state,{receipt},'inbox')).toBe('');
  });
});

describe('Abrechnung und rückwärtskompatible Belegdaten', () => {
  it.each(['Firmenkarte','Unternehmen','unbekannt','bereits erstattet'] as const)('does not reimburse %s', paymentType => {
    expect(expenseReimbursable(expense({paymentType}))).toBe(0);
    if(paymentType === 'unbekannt') expect(paymentPayer(paymentType)).toBe('');
  });
  it('reimburses private hotels once, keeps breakfast selections and old reports untouched', () => {
    const state=demoState();state.trips=[trip()];state.expenses=[];
    const before=buildStatement(state,'2026-10');const trips=structuredClone(state.trips);const snapshots=structuredClone(state.statements);
    state.expenses=[expense({...hotel,breakfastIncluded:'yes',tripId:'a'}),expense({id:'company',paymentType:'Firmenkarte'})];
    const after=buildStatement(state,'2026-10');
    expect(after.totals.openAmount).toBe(before.totals.openAmount+115);
    expect(after.totals.allowance).toBe(before.totals.allowance);
    expect(after.totals.companyPaid).toBe(115);expect(state.trips).toEqual(trips);expect(state.statements).toEqual(snapshots);
  });
  it('roundtrips optional context without a DB migration and does not infer missing legacy payment', () => {
    const state=demoState();state.expenses=[expense({...hotel,breakfastIncluded:'unknown',tripId:'a'})];
    const encoded=JSON.parse(JSON.stringify(state));const normalized=normalizeState(encoded);
    expect(normalized.expenses).toEqual(encoded.expenses);
    expect(cleanContext(normalized.expenses[0]).projectNumber).toBe('26.0123');
    delete encoded.expenses[0].paymentType;
    const restored=normalizeState(encoded);
    expect(restored.expenses[0].paymentType).toBe('unbekannt');
    expect(expenseReimbursable(restored.expenses[0])).toBe(0);
    expect(encoded.expenses[0]).not.toHaveProperty('paymentType');
    expect(restored.statements).toEqual(encoded.statements);
  });
  it('rejects malformed new optional metadata instead of replacing existing data', () => {
    const state=demoState();state.expenses=[expense()];
    const bad=JSON.parse(JSON.stringify(state));bad.expenses[0].stayStart={invalid:true};
    expect(()=>normalizeState(bad)).toThrow('Ungültiges Datenformat');
    expect(state.expenses[0]).not.toHaveProperty('stayStart');
    bad.expenses[0].stayStart=undefined;bad.expenses[0].breakfastIncluded=['yes'];
    expect(()=>normalizeState(bad)).toThrow('Ungültiges Datenformat');
    bad.expenses[0].breakfastIncluded=undefined;bad.expenses[0].tripId={id:'invalid'};
    expect(()=>normalizeState(bad)).toThrow('Ungültiges Datenformat');
  });
});
