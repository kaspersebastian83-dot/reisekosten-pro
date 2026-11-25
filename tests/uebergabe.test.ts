import { describe, expect, it } from 'vitest';
import { buildStatement } from '../lib/calculations';
import { emptyState } from '../lib/config';
import { demoState } from '../lib/demo';
import { receiptFileId } from '../lib/receipt-images';
import { normalizeState } from '../lib/storage';
import { alsGesendetVermerken, anzahl, belegeDerAuswahl, berichtKurz, fingerabdruck, offeneEintraege, uebergabeDateiname, uebergabeLesen, uebergabeText, uebernehmen, UebergabeFehler, type Uebergabe } from '../lib/uebergabe';
import type { AppState, Expense, ReceiptInboxItem, Trip, VehicleProfile } from '../lib/types';

// Übergabe Handy → PC: Das Handy sendet Reisen, Kosten und Belege; der PC fügt hinzu und ersetzt nichts.
const bild = (inhalt: string) => 'data:image/jpeg;base64,' + btoa(inhalt);
// echte Fingerabdrücke: Die Übergabe nimmt ein Bild nur an, wenn sein Inhalt zum Verweis passt
const FOTO = receiptFileId(bild('parken'))!, FOTO2 = receiptFileId(bild('foto'))!;
let n = 0;
const reise = (o: Partial<Trip> = {}): Trip => ({ ...demoState().trips[0], id: `r${++n}`, date: '2026-11-10', endDate: '2026-11-10', startTime: '07:00', endTime: '17:00', startPlace: 'Würselen',
  destination: 'Köln', purpose: 'Ortstermin', order: '26.0123 Köln', businessKm: 140, privateKm: 0, tripType: 'dienstlich', status: 'geprüft', absenceConfirmed: true, overnight: false,
  vehicleId: 'vehicle-private-default', meals: { breakfast: false, lunch: false, dinner: false }, dailyMeals: undefined, warnings: [], manualAbsenceMinutes: undefined, tripGroup: undefined, ...o });
const kosten = (o: Partial<Expense> = {}): Expense => ({ ...demoState().expenses[0], id: `k${++n}`, date: '2026-11-10', tripId: undefined, category: 'Parken', description: 'Parkhaus Dom', gross: 12, net: 10.08, vat: 1.92, vatRate: 19,
  currency: 'EUR', exchangeRate: 1, paymentType: 'privat vorgestreckt', reimbursementStatus: 'offen', businessShare: 100, merchant: 'Parkhaus Dom', invoiceNumber: '', vehicleId: undefined, notes: '', status: 'geprüft', warnings: [],
  receipt: { id: `b${n}`, name: 'parken.jpg', type: 'image/jpeg', size: 1000, hash: `hash-${n}`, dataUrl: '', fileId: FOTO }, ...o });
const eingang = (o: Partial<ReceiptInboxItem> = {}): ReceiptInboxItem => ({ id: `e${++n}`, capturedAt: '2026-11-10T12:00:00Z', status: 'neu', notes: '', suggestion: { confidence: 0 },
  receipt: { id: `b${n}`, name: 'foto.jpg', type: 'image/jpeg', size: 2000, hash: `hash-${n}`, dataUrl: '', fileId: FOTO2 }, ...o });
const bestand = (o: Partial<AppState> = {}): AppState => normalizeState({ ...structuredClone(emptyState), ...o });
const ctx = { id: 'protokoll-1', at: '2026-11-25T12:00:00Z' };
const datei = (handy: AppState, belege: Record<string, string> = { [FOTO]: bild('parken'), [FOTO2]: bild('foto') }, auswahl = offeneEintraege(handy, {})): Uebergabe =>
  uebergabeLesen(uebergabeText(handy, auswahl, belege, { erstellt: '2026-11-25T11:00:00Z', geraet: 'handy-1', app: '1.18.0' }));

describe('Handy: offen, gesendet, geändert', () => {
  it('ohne Vermerk ist alles offen; nach dem Senden nichts; eine Änderung macht genau diesen Eintrag wieder offen', () => {
    const handy = bestand({ trips: [reise(), reise({ date: '2026-11-11', endDate: '2026-11-11' })], expenses: [kosten()], receiptInbox: [eingang()] });
    const offen = offeneEintraege(handy, {});
    expect(anzahl(offen)).toBe(4);
    const gesendet = alsGesendetVermerken(handy, {}, offen);
    expect(anzahl(offeneEintraege(handy, gesendet))).toBe(0);
    const geaendert = { ...handy, trips: [handy.trips[0], { ...handy.trips[1], businessKm: 150 }] };
    expect(offeneEintraege(geaendert, gesendet)).toEqual({ trips: [geaendert.trips[1]], expenses: [], receiptInbox: [] });
  });
  it('gelöschte Einträge verschwinden aus dem Vermerk; Fingerabdruck hängt nicht von der Feldreihenfolge ab', () => {
    const handy = bestand({ trips: [reise(), reise()] });
    const gesendet = alsGesendetVermerken(handy, {}, offeneEintraege(handy, {}));
    const danach = { ...handy, trips: [handy.trips[0]] };
    expect(Object.keys(alsGesendetVermerken(danach, gesendet, { trips: [], expenses: [], receiptInbox: [] }))).toEqual([handy.trips[0].id]);
    expect(fingerabdruck({ a: 1, b: [1, 2] })).toBe(fingerabdruck({ b: [1, 2], a: 1 }));
    expect(fingerabdruck({ a: 1 })).not.toBe(fingerabdruck({ a: 2 }));
  });
  it('Dateiname in Ortszeit, Belegbilder der Auswahl ohne Doppelte', () => {
    expect(uebergabeDateiname(new Date(2026, 10, 5, 9, 7))).toBe('SpesenKit-Uebergabe_2026-11-05_0907.txt');
    expect(belegeDerAuswahl({ trips: [], expenses: [kosten(), kosten()], receiptInbox: [eingang()] }).sort()).toEqual([FOTO, FOTO2].sort());
  });
});

describe('Datei schreiben und lesen', () => {
  it('Hin und zurück: Einträge unverändert, nur genutzte Fahrzeuge, Bilder nach Fingerabdruck, keine Einstellungen', () => {
    const handy = bestand({ trips: [reise()], expenses: [kosten()], receiptInbox: [eingang()] });
    handy.settings.profileName = 'Max Mustermann';
    const text = uebergabeText(handy, offeneEintraege(handy, {}), { [FOTO]: bild('parken'), 'kein-fingerabdruck': bild('x'), [FOTO2]: 'kein-bild' }, { erstellt: '2026-11-25T11:00:00Z', geraet: 'handy-1' });
    expect(text).not.toMatch(/Max Mustermann|tariffs|profileName/);
    const gelesen = uebergabeLesen('﻿' + text);
    expect(gelesen.trips).toEqual(handy.trips);
    expect(gelesen.expenses).toEqual(handy.expenses);
    expect(gelesen.receiptInbox).toEqual(handy.receiptInbox);
    expect(gelesen.vehicles.map((v) => v.id)).toEqual(['vehicle-private-default']);
    expect(gelesen.belege).toEqual({ [FOTO]: bild('parken') });
    expect([gelesen.geraet, gelesen.erstellt]).toEqual(['handy-1', '2026-11-25T11:00:00Z']);
  });
  it('lehnt Fremdes, Neueres und Kaputtes mit verständlicher Meldung ab', () => {
    const handy = bestand({ trips: [reise()] });
    const gut = JSON.parse(uebergabeText(handy, offeneEintraege(handy, {}), {}, { erstellt: '', geraet: 'g' }));
    const lesen = (value: unknown) => () => uebergabeLesen(typeof value === 'string' ? value : JSON.stringify(value));
    expect(lesen('kein json')).toThrow(/kein lesbarer Inhalt/);
    expect(lesen({ format: 'spesenkit-buerokasse-sicherung', version: 1, records: [] })).toThrow(/Bürokasse/);
    expect(lesen(structuredClone(emptyState))).toThrow(/vollständige JSON-Sicherung.*ersetzt den Bestand/);
    expect(lesen({ ...gut, version: 2 })).toThrow(/neueren SpesenKit-Version/);
    expect(lesen({ ...gut, expenses: undefined })).toThrow(/unvollständig/);
    expect(lesen({ ...gut, trips: [{ ...gut.trips[0], businessKm: 'viel' }] })).toThrow(/ungültigen Eintrag/);
    expect(lesen({ ...gut, trips: [{ ...gut.trips[0], date: '10.11.2026' }] })).toThrow(/ungültigen Eintrag/);
    expect(lesen({ ...gut, trips: [gut.trips[0], gut.trips[0]] })).toThrow(/ungültigen Eintrag/);   // Kennung doppelt
    expect(lesen([])).toThrow(UebergabeFehler);
  });
});

describe('PC: übernehmen', () => {
  it('neue Einträge kommen dazu und als „ungeprüft“ an; der Bestand am PC bleibt sonst unverändert', () => {
    const vorhanden = reise({ date: '2026-11-03', endDate: '2026-11-03', destination: 'Aachen' });
    const pc = bestand({ trips: [vorhanden], merchantRules: [{ id: 'm1', merchantPattern: 'aral', category: 'Tanken', paymentType: 'Firmenkarte', vatRate: 19, uses: 3, updatedAt: '2026-11-01' }] });
    pc.settings.profileName = 'Dr. Muster';
    const fahrt = reise(), parken = kosten({ tripId: fahrt.id }), foto = eingang();
    const handy = bestand({ trips: [fahrt], expenses: [parken], receiptInbox: [foto] });
    const vorher = structuredClone(pc);
    const { state, bericht, geaendert } = uebernehmen(pc, datei(handy), ctx);
    expect(pc).toEqual(vorher);   // reine Funktion
    expect(geaendert).toBe(true);
    expect(bericht.neu).toEqual({ trips: 1, expenses: 1, receiptInbox: 1 });
    expect([bericht.vorhanden, bericht.abweichungen, bericht.doppelt, bericht.fahrzeugeNeu, bericht.hinweise, bericht.geschlosseneMonate]).toEqual([0, [], [], [], [], []]);
    expect(state.trips).toEqual([vorhanden, { ...handy.trips[0], status: 'ungeprüft' }]);
    expect(state.expenses).toEqual([{ ...handy.expenses[0], status: 'ungeprüft' }]);
    expect(state.receiptInbox).toEqual(handy.receiptInbox);
    expect([state.settings, state.merchantRules, state.statements]).toEqual([pc.settings, pc.merchantRules, pc.statements]);
    expect(bericht.belege).toEqual({ [FOTO]: bild('parken'), [FOTO2]: bild('foto') });
    expect(state.changes[0]).toMatchObject({ id: 'protokoll-1', field: 'Vom Handy übernommen', changedAt: ctx.at, user: 'Dr. Muster', reason: 'Vom Handy übernommen: 1 Reise, 1 Kostenposition, 1 Beleg im Eingang.' });
    expect(JSON.stringify(state.changes[0])).not.toMatch(/base64/);
  });
  it('dieselbe Datei ein zweites Mal: nichts ändert sich, auch nachdem am PC geprüft wurde', () => {
    const handy = bestand({ trips: [reise()], expenses: [kosten()], receiptInbox: [eingang()] });
    const einmal = uebernehmen(bestand(), datei(handy), ctx).state;
    const geprueft = { ...einmal, trips: einmal.trips.map((t) => ({ ...t, status: 'geprüft' as const, warnings: ['Hinweis vom PC'] })), receiptInbox: einmal.receiptInbox.map((i) => ({ ...i, status: 'zugeordnet' as const, notes: 'am PC bearbeitet' })) };
    const zweimal = uebernehmen(geprueft, datei(handy), { ...ctx, id: 'protokoll-2' });
    expect(zweimal.geaendert).toBe(false);
    expect(zweimal.state).toBe(geprueft);
    expect(zweimal.bericht).toMatchObject({ neu: { trips: 0, expenses: 0, receiptInbox: 0 }, vorhanden: 3, abweichungen: [], belege: {} });
    expect(berichtKurz(zweimal.bericht)).toBe('Nichts Neues – alle Einträge sind schon am PC. 3 Einträge waren schon vorhanden.');
  });
  it('auf dem Handy nach dem Senden geändert: der Eintrag am PC bleibt, die Abweichung nennt die Felder', () => {
    const fahrt = reise(), parken = kosten();
    const handy = bestand({ trips: [fahrt], expenses: [parken] });
    const pc = uebernehmen(bestand(), datei(handy), ctx).state;
    const spaeter = { ...handy, trips: [{ ...handy.trips[0], businessKm: 155, destination: 'Köln-Deutz' }], expenses: [{ ...handy.expenses[0], gross: 14 }] };
    const { state, bericht, geaendert } = uebernehmen(pc, datei(spaeter), ctx);
    expect(geaendert).toBe(false);
    expect(state.trips[0].businessKm).toBe(140);
    expect(bericht.abweichungen).toEqual([
      'Reise 10.11.2026 · Köln: weicht ab (Dienstliche Kilometer, Reiseziel) – der vorhandene Eintrag bleibt.',
      'Kosten 10.11.2026 · Parkhaus Dom: weicht ab (Brutto) – der vorhandene Eintrag bleibt.',
    ]);
    expect(berichtKurz(bericht)).toMatch(/2 Abweichungen – der Stand am PC bleibt\./);
  });
  it('andere Kennung, sieht gleich aus: kommt dazu und wird als möglicher doppelter Eintrag gemeldet', () => {
    const amPc = reise(), belegAmPc = kosten({ invoiceNumber: 'R-77', merchant: 'Hotel Dom' });
    const pc = bestand({ trips: [amPc], expenses: [belegAmPc] });
    const handy = bestand({ trips: [reise()], expenses: [kosten({ invoiceNumber: 'r-77', merchant: 'hotel dom', receipt: undefined })] });
    const { state, bericht } = uebernehmen(pc, datei(handy), ctx);
    expect([state.trips.length, state.expenses.length]).toEqual([2, 2]);
    expect(bericht.doppelt).toEqual(['Reise 10.11.2026 · Köln: sieht aus wie eine vorhandene Reise – bitte prüfen.', 'Kosten 10.11.2026 · Parkhaus Dom: sieht aus wie ein vorhandener Beleg – bitte prüfen.']);
  });
  it('Beleg-Eingang: dasselbe Foto ist schon da (im Eingang oder an einer Kostenposition) → übersprungen', () => {
    const imEingang = eingang(), anKosten = kosten();
    const pc = bestand({ receiptInbox: [imEingang], expenses: [anKosten] });
    const handy = bestand({ receiptInbox: [eingang({ receipt: { ...imEingang.receipt } }), eingang({ receipt: { ...anKosten.receipt! } }), eingang()] });
    const { state, bericht } = uebernehmen(pc, datei(handy), ctx);
    expect(bericht).toMatchObject({ neu: { receiptInbox: 1 }, vorhanden: 2 });
    expect(state.receiptInbox).toHaveLength(2);
  });
  it('Kosten mit Reise, die es am PC nicht gibt: Zuordnung gelöst und gemeldet; mit Reise in derselben Datei bleibt sie', () => {
    const fahrt = reise();
    const ohne = uebernehmen(bestand(), datei(bestand({ expenses: [kosten({ tripId: 'gibt-es-nicht' })] })), ctx);
    expect(ohne.state.expenses[0].tripId).toBeUndefined();
    expect(ohne.bericht.hinweise).toEqual(['Kosten 10.11.2026 · Parkhaus Dom: Die zugeordnete Reise ist am PC nicht vorhanden – die Zuordnung wurde gelöst.']);
    const mit = uebernehmen(bestand(), datei(bestand({ trips: [fahrt], expenses: [kosten({ tripId: fahrt.id })] })), ctx);
    expect([mit.state.expenses[0].tripId, mit.bericht.hinweise]).toEqual([fahrt.id, []]);
  });
  it('fehlt ein Belegbild in der Datei, kommt der Eintrag trotzdem an und der Bericht sagt es', () => {
    const { state, bericht } = uebernehmen(bestand(), datei(bestand({ expenses: [kosten()] }), {}), ctx);
    expect(state.expenses).toHaveLength(1);
    expect(bericht.belege).toEqual({});
    expect(bericht.hinweise[0]).toBe(`Ein Belegbild fehlt in der Übergabe (${FOTO.slice(0, 8)}…). Bitte auf dem Handy „Alles erneut senden“.`);
  });
});

describe('PC: Fälle aus der Durchsicht', () => {
  it('Bild, dessen Inhalt nicht zum Fingerabdruck passt, wird nicht angenommen – der Beleg bekommt kein fremdes Bild', () => {
    const handy = bestand({ expenses: [kosten()] });
    const gelesen = datei(handy, { [FOTO]: bild('ein ganz anderes Bild') });
    expect(gelesen.belege).toEqual({});
    const { bericht } = uebernehmen(bestand(), gelesen, ctx);
    expect([bericht.belege, bericht.hinweise.length]).toEqual([{}, 1]);
  });
  it('Beleg erst als Foto gesendet, dann auf dem Handy zu Kosten gemacht: am PC ist der Eingang danach erledigt', () => {
    const foto = eingang();
    const pc = uebernehmen(bestand(), datei(bestand({ receiptInbox: [foto] })), ctx).state;
    expect(pc.receiptInbox[0].status).toBe('neu');
    const ausFoto = kosten({ receipt: { ...foto.receipt } });
    const handy = bestand({ expenses: [ausFoto], receiptInbox: [{ ...foto, status: 'zugeordnet', expenseId: ausFoto.id }] });
    const { state, bericht, geaendert } = uebernehmen(pc, datei(handy), { ...ctx, id: 'protokoll-2' });
    expect(geaendert).toBe(true);
    expect(state.expenses.map((e) => e.id)).toEqual([ausFoto.id]);
    expect(state.receiptInbox).toEqual([{ ...pc.receiptInbox[0], status: 'zugeordnet', expenseId: ausFoto.id }]);
    expect([bericht.eingangErledigt, bericht.abweichungen, bericht.doppelt]).toEqual([1, [], []]);
    expect(berichtKurz(bericht)).toBe('Vom Handy übernommen: 1 Kostenposition. 1 Eintrag war schon vorhanden. 1 Beleg im Eingang als erledigt vermerkt.');
  });
  it('derselbe Beleg am PC schon anders verarbeitet: Stand am PC bleibt, Abweichung und möglicher Doppelter werden gemeldet', () => {
    const foto = eingang();
    const amPc = kosten({ receipt: { ...foto.receipt } });
    const pc = bestand({ expenses: [amPc], receiptInbox: [{ ...foto, status: 'zugeordnet', expenseId: amPc.id }] });
    const vomHandy = kosten({ receipt: { ...foto.receipt } });
    const handy = bestand({ expenses: [vomHandy], receiptInbox: [{ ...foto, status: 'zugeordnet', expenseId: vomHandy.id }] });
    const { state, bericht } = uebernehmen(pc, datei(handy), ctx);
    expect(state.receiptInbox).toEqual(pc.receiptInbox);
    expect(bericht.eingangErledigt).toBe(0);
    expect(bericht.abweichungen).toEqual(['Beleg im Eingang „foto.jpg“: auf dem Handy und am PC unterschiedlich verarbeitet – der Stand am PC bleibt. Bitte auf doppelte Kosten prüfen.']);
    expect(bericht.doppelt).toHaveLength(1);
  });
  it('zwei gleiche Einträge in derselben Datei werden auch ohne Bestand am PC als mögliche Doppelte gemeldet', () => {
    const handy = bestand({ trips: [reise(), reise()], expenses: [kosten({ invoiceNumber: 'R-9', merchant: 'Hotel' }), kosten({ invoiceNumber: 'R-9', merchant: 'Hotel', receipt: undefined })] });
    const { state, bericht } = uebernehmen(bestand(), datei(handy), ctx);
    expect([state.trips.length, state.expenses.length, bericht.doppelt.length]).toEqual([2, 2, 2]);
  });
  it('Reise über drei Monate: auch der abgeschlossene Monat dazwischen wird genannt', () => {
    const pc = bestand();
    pc.statements = [{ id: 's11', month: '2026-11', number: 'RK-2026-11', createdAt: '2026-12-02T08:00:00Z', status: 'freigegeben', version: 1, locked: true, data: buildStatement(pc, '2026-11') }];
    const lang = reise({ date: '2026-10-28', endDate: '2026-12-03', overnight: true });
    expect(uebernehmen(pc, datei(bestand({ trips: [lang] })), ctx).bericht.geschlosseneMonate).toEqual(['2026-11']);
    const jahreswechsel = reise({ date: '2026-12-30', endDate: '2027-01-02', overnight: true });
    expect(uebernehmen(pc, datei(bestand({ trips: [jahreswechsel] })), ctx).bericht.geschlosseneMonate).toEqual([]);
  });
});

describe('PC: Fahrzeuge zuordnen – die Kilometererstattung darf sich nicht still ändern', () => {
  const eigenes = (o: Partial<VehicleProfile> = {}): VehicleProfile => ({ id: 'handy-golf', name: 'Golf', plate: 'AC-XY 123', ownership: 'privatwagen', reimbursementMethod: 'pauschale', active: true, ...o });
  const handyMit = (vehicle: VehicleProfile) => { const s = bestand({ trips: [reise({ vehicleId: vehicle.id })] }); s.settings.vehicles = [...s.settings.vehicles, vehicle]; return s; };
  const erstattung = (state: AppState) => buildStatement(state, '2026-11').totals.mileage;

  it('gleiche Kennung: unverändert', () => {
    const { state, bericht } = uebernehmen(bestand(), datei(bestand({ trips: [reise()] })), ctx);
    expect([state.trips[0].vehicleId, bericht.fahrzeugeNeu, erstattung(state)]).toEqual(['vehicle-private-default', [], 42]);
  });
  it('gleiches Kennzeichen (andere Schreibweise): auf das Fahrzeug am PC umgehängt', () => {
    const pc = bestand(); pc.settings.vehicles = [...pc.settings.vehicles, eigenes({ id: 'pc-golf', name: 'VW Golf', plate: 'ac xy-123' })];
    const { state, bericht } = uebernehmen(pc, datei(handyMit(eigenes())), ctx);
    expect([state.trips[0].vehicleId, bericht.fahrzeugeNeu, state.settings.vehicles.length, erstattung(state)]).toEqual(['pc-golf', [], 3, 42]);
  });
  it('gleicher Name und gleiche Art, ohne Kennzeichen: umgehängt', () => {
    const pc = bestand(); pc.settings.vehicles = [...pc.settings.vehicles, eigenes({ id: 'pc-golf', plate: '', name: 'golf' })];
    const { state } = uebernehmen(pc, datei(handyMit(eigenes({ plate: '' }))), ctx);
    expect(state.trips[0].vehicleId).toBe('pc-golf');
  });
  it('am PC unbekannt: Fahrzeug wird angelegt – die Erstattung ist dieselbe wie auf dem Handy', () => {
    const handy = handyMit(eigenes());
    const { state, bericht, geaendert } = uebernehmen(bestand(), datei(handy), ctx);
    expect(geaendert).toBe(true);
    expect(bericht.fahrzeugeNeu.map((v) => v.name)).toEqual(['Golf']);
    expect(state.settings.vehicles.map((v) => v.id)).toEqual(['vehicle-company-default', 'vehicle-private-default', 'handy-golf']);
    expect([state.trips[0].vehicleId, erstattung(state), erstattung(handy)]).toEqual(['handy-golf', 42, 42]);
  });
  it('am PC anders eingestellt: Einstellung am PC gilt, der Bericht warnt', () => {
    const pc = bestand(); pc.settings.vehicles = pc.settings.vehicles.map((v) => v.id === 'vehicle-private-default' ? { ...v, reimbursementMethod: 'tatsächliche Kosten' as const } : v);
    const { state, bericht } = uebernehmen(pc, datei(bestand({ trips: [reise()] })), ctx);
    expect(erstattung(state)).toBe(0);
    expect(bericht.hinweise[0]).toMatch(/^Fahrzeug „Mein Privatwagen“ ist am PC anders eingestellt \(Privatwagen, Erstattung: tatsächliche Kosten\) als auf dem Handy \(Privatwagen, pauschale\)\. Es gilt die Einstellung am PC/);
  });
});

describe('PC: abgeschlossene Monate bleiben eingefroren', () => {
  it('neuer Eintrag in einem abgeschlossenen Monat: übernommen, Abrechnung unverändert, Monat im Bericht genannt', () => {
    const pc = bestand({ trips: [reise({ date: '2026-10-06', endDate: '2026-10-06' })] });
    pc.statements = [{ id: 's1', month: '2026-10', number: 'RK-2026-10', createdAt: '2026-11-02T08:00:00Z', status: 'freigegeben', version: 1, locked: true, data: buildStatement(pc, '2026-10') }];
    const snapshot = structuredClone(pc.statements[0]);
    const handy = bestand({ trips: [reise({ date: '2026-10-20', endDate: '2026-10-20' }), reise()], expenses: [kosten({ date: '2026-10-21' })] });
    const { state, bericht } = uebernehmen(pc, datei(handy), ctx);
    expect(bericht.geschlosseneMonate).toEqual(['2026-10']);
    expect(state.statements).toEqual([snapshot]);
    expect(state.trips).toHaveLength(3);
  });
});
