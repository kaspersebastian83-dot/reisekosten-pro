import { describe, it, expect } from 'vitest';
import { demoState } from '../lib/demo';
import { defaultSettings } from '../lib/config';
import { calculateDay, groupTripsByDay } from '../lib/calculations';
import { manualTripErrors, manualTripInterval, manualTripReviewNotes, projectPlace, projectSuggestions } from '../lib/manual-trip';
const trip = () => ({ ...demoState().trips[0], date: '2026-10-20', endDate: '2026-10-20', startTime: '08:00', endTime: '17:00', order: '26.0123 Musterstadt', destination: 'Musterstadt', purpose: 'Ortstermin', overnight: false, manualAbsenceMinutes: undefined, dailyMeals: {}, meals: { breakfast: false, lunch: false, dinner: false } });
describe('Vereinfachte manuelle Reisenerfassung', () => {
  it('validates projects while retaining legacy references', () => {
    expect(projectPlace('26.0123 Musterstadt')).toBe('Musterstadt');
    expect(projectPlace('26.123 Stadt')).toBe('');
    const t = trip();
    expect(projectSuggestions([t,t,{...t,order:'Altauftrag'}])).toEqual([t.order]);
    expect(manualTripErrors({...t, order:''}).length).toBe(1);
    expect(manualTripErrors({...t, order:'Altauftrag'}, 'Altauftrag')).toEqual([]);
    expect(manualTripErrors({...t, order:''}, t.order).length).toBe(1);
    expect(manualTripErrors({...t, order:'Neu ohne Format'}, 'Altauftrag').length).toBe(1);
  });
  it.each(['07:59','08:00','08:01'])('keeps existing same-day threshold at %s', endTime => {
    const t = {...trip(), startTime:'00:00',endTime};
    const day = calculateDay(t.date,[t],defaultSettings);
    expect(day.allowanceAfter).toBe(endTime === '08:01' ? 14 : 0);
  });
  it('splits multiday meals and clamps deductions using existing calculation', () => {
    const t = {...trip(),endDate:'2026-10-22',overnight:true,dailyMeals:{'2026-10-21':{breakfast:true,lunch:false,dinner:false},'2026-10-22':{breakfast:true,lunch:true,dinner:true}}};
    const days = [...groupTripsByDay([t])].map(([date,trips])=>calculateDay(date,trips,defaultSettings));
    expect(days.map(d=>d.allowanceAfter)).toEqual([14,22.4,0]);
    expect(manualTripInterval(t)).toEqual({minutes:3420,nights:2});
  });
  it('requires explicit next date across midnight and warns about missing actual nights', () => {
    const t={...trip(),startTime:'23:00',endTime:'02:00'};
    expect(manualTripInterval(t)).toBeNull();
    const overnight={...t,endDate:'2026-10-21'};
    expect(manualTripInterval(overnight)).toEqual({minutes:180,nights:1});
    expect(manualTripReviewNotes(overnight).join()).toContain('ohne bestätigte');
  });
  it.each([{endTime:'08:00'}, {endDate:'2026-10-19'}, {date:'2026-02-30'}, {startTime:''}, {endTime:'25:00'}, {endDate:'2027-01-01'}, {overnight:true}])('rejects implausible intervals %j', extra => {
    expect(manualTripErrors({...trip(),...extra}).length).toBeGreaterThan(0);
  });
  it('does not equate presence confirmation with tax approval', () => {
    expect(manualTripReviewNotes(trip()).join()).toMatch(/Ausland.*Dreimonatsfrist/);
  });
});
