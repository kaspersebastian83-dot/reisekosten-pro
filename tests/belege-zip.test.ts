import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { emptyState } from '../lib/config';
import { demoState } from '../lib/demo';
import { belegeZip, belegeZipName, belegListe, belegMonate, belegPfade, dateinamenTeil } from '../lib/belege-zip';
import { receiptFileId } from '../lib/receipt-images';
import { normalizeState } from '../lib/storage';
import type { AppState, Expense, Receipt, ReceiptInboxItem } from '../lib/types';

// „Belegfotos als ZIP“: alle Belegfotos als Bilddateien plus Belegliste.csv; der Bestand bleibt unverändert.
const bild = (inhalt: string, typ = 'image/jpeg') => `data:${typ};base64,` + btoa(inhalt);
const BILD: Record<string, string> = {};
const beleg = (inhalt: string, o: Partial<Receipt> = {}, typ = 'image/jpeg'): Receipt => {
  const url = bild(inhalt, typ), fileId = receiptFileId(url)!;
  BILD[fileId] = url;
  return { id: `b-${inhalt}`, name: `${inhalt}.jpg`, type: typ, size: 100, hash: `hash-${inhalt}`, dataUrl: '', fileId, ...o };
};
let n = 0;
const kosten = (o: Partial<Expense> = {}): Expense => ({ ...demoState().expenses[0], id: `k${++n}`, date: '2026-11-10', tripId: undefined, category: 'Parken', description: 'Parkhaus Dom', gross: 12, net: 10.08, vat: 1.92, vatRate: 19,
  currency: 'EUR', exchangeRate: 1, paymentType: 'privat vorgestreckt', reimbursementStatus: 'offen', businessShare: 100, merchant: 'Parkhaus Dom', notes: '', status: 'geprüft', warnings: [], receipt: beleg(`k${n}`), ...o });
const eingang = (o: Partial<ReceiptInboxItem> = {}): ReceiptInboxItem => ({ id: `e${++n}`, capturedAt: '2026-11-12T09:30:00Z', status: 'neu', notes: '', suggestion: { confidence: 0 }, receipt: beleg(`e${n}`), ...o });
const bestand = (o: Partial<AppState> = {}): AppState => normalizeState({ ...structuredClone(emptyState), ...o });
const ausSpeicher = async (r: Receipt) => (r.fileId && BILD[r.fileId]) || '';
const lesen = async (blob: Blob) => JSZip.loadAsync(await blob.arrayBuffer());
const csv = async (zip: JSZip) => (await zip.file('Belegliste.csv')!.async('string')).replace(/^﻿/, '').trim().split(/\r?\n/);

describe('Belegliste', () => {
  it('Kosten und Beleg-Eingang, nach Datum; stornierte Kosten und Kosten ohne Foto fehlen; dasselbe Foto nur einmal (Kosten vor Eingang)', () => {
    const parken = kosten({ date: '2026-11-10' }), hotel = kosten({ date: '2026-11-03', category: 'Hotel' });
    const storniert = kosten({ status: 'storniert' }), ohneFoto = kosten({ receipt: undefined });
    const zugeordnet = eingang({ status: 'zugeordnet', expenseId: parken.id, receipt: { ...parken.receipt!, id: 'anders' } });
    const wartet = eingang({ suggestion: { confidence: 0.5, date: '2026-11-11' } }), archiviert = eingang({ status: 'archiviert', capturedAt: '2026-10-30T22:00:00Z' });
    const liste = belegListe(bestand({ expenses: [parken, hotel, storniert, ohneFoto], receiptInbox: [zugeordnet, wartet, archiviert] }));
    expect(liste.map((e) => [e.bereich, e.datum, e.expense?.id || e.inbox?.id])).toEqual([
      ['Beleg-Eingang', '2026-10-30', archiviert.id], ['Kosten', '2026-11-03', hotel.id], ['Kosten', '2026-11-10', parken.id], ['Beleg-Eingang', '2026-11-11', wartet.id]]);
  });
  it('nur ein Monat; Monate mit Fotos, neueste zuerst', () => {
    const s = bestand({ expenses: [kosten({ date: '2026-10-02' }), kosten({ date: '2026-11-10' })], receiptInbox: [eingang({ capturedAt: '2026-09-01T08:00:00Z' })] });
    expect(belegListe(s, '2026-10').map((e) => e.datum)).toEqual(['2026-10-02']);
    expect(belegMonate(s)).toEqual(['2026-11', '2026-10', '2026-09']);
    expect(belegListe(bestand())).toEqual([]);
  });
});

describe('Dateinamen', () => {
  it('lesbar: Ordner je Monat, Datum, Kostenart, Betrag, Händler; Eingang mit Originalname; Endung aus dem Fingerabdruck', () => {
    const s = bestand({ expenses: [kosten({ category: 'Tanken', gross: 82.6, merchant: 'Aral Köln-Süd' }), kosten({ gross: 49, currency: 'USD', merchant: '', description: 'Taxi JFK' })],
      receiptInbox: [eingang({ receipt: beleg('scan', { name: 'IMG_2045.PNG' }, 'image/png') })] });
    expect(belegPfade(belegListe(s))).toEqual(['Kosten/2026-11/2026-11-10_Tanken_82,60EUR_Aral-Köln-Süd.jpg', 'Kosten/2026-11/2026-11-10_Parken_49,00USD_Taxi-JFK.jpg', 'Beleg-Eingang/2026-11-12_IMG_2045.png']);
  });
  it('gleiche Namen bekommen _2, _3; Sonderzeichen und Pfadangaben verschwinden', () => {
    const s = bestand({ expenses: [kosten(), kosten(), kosten({ merchant: 'A/B: "C"*?<>|' })] });
    expect(belegPfade(belegListe(s))).toEqual(['Kosten/2026-11/2026-11-10_Parken_12,00EUR_Parkhaus-Dom.jpg', 'Kosten/2026-11/2026-11-10_Parken_12,00EUR_Parkhaus-Dom_2.jpg', 'Kosten/2026-11/2026-11-10_Parken_12,00EUR_AB-C.jpg']);
    expect(dateinamenTeil('../../etc/passwd')).toBe('etcpasswd');
    expect(dateinamenTeil('x'.repeat(80))).toHaveLength(40);
    expect(belegeZipName('2026-11-27')).toBe('SpesenKit-Belege_alle_2026-11-27.zip');
    expect(belegeZipName('2026-11-27', '2026-10')).toBe('SpesenKit-Belege_2026-10_2026-11-27.zip');
  });
});

describe('ZIP', () => {
  it('enthält die Bilder unverändert und die Belegliste; fehlendes Bild steht nur in der Liste', async () => {
    const mitBild = kosten({ projectNumber: '26.0604', merchant: 'Parkhaus Dom' });
    const ohneBild = kosten({ date: '2026-11-11', receipt: { id: 'x', name: 'weg.jpg', type: 'image/jpeg', size: 1, hash: 'h-weg', dataUrl: '', fileId: 'a'.repeat(64) + '.jpg' } });
    const wartet = eingang({ suggestion: { confidence: 0.4, gross: 7.5, merchant: 'Bäckerei' } });
    const s = bestand({ expenses: [mitBild, ohneBild], receiptInbox: [wartet] });
    const vorher = structuredClone(s);
    const { blob, fotos, fehlen } = await belegeZip(belegListe(s), ausSpeicher);
    expect([fotos, fehlen, blob.type]).toEqual([2, 1, 'application/zip']);
    expect(s).toEqual(vorher);
    const zip = await lesen(blob);
    expect(Object.keys(zip.files).filter((name) => !zip.files[name].dir).sort()).toEqual(['Beleg-Eingang/2026-11-12_' + wartet.receipt.name, 'Belegliste.csv', 'Kosten/2026-11/2026-11-10_Parken_12,00EUR_Parkhaus-Dom.jpg'].sort());
    expect(await zip.file('Kosten/2026-11/2026-11-10_Parken_12,00EUR_Parkhaus-Dom.jpg')!.async('string')).toBe(`k${mitBild.id.slice(1)}`);
    const zeilen = await csv(zip);
    expect(zeilen[0]).toBe('Datei;Bereich;Datum;Kostenart;Beschreibung;Händler;Betrag;Währung;Zahlungsart;Projekt;Status;Originaldatei;Hinweis');
    expect(zeilen[1]).toBe(`Kosten/2026-11/2026-11-10_Parken_12,00EUR_Parkhaus-Dom.jpg;Kosten;10.11.2026;Parken;Parkhaus Dom;Parkhaus Dom;12,00;EUR;privat vorgestreckt;26.0604;geprüft;${mitBild.receipt!.name};`);
    expect(zeilen[2]).toBe(';Kosten;11.11.2026;Parken;Parkhaus Dom;Parkhaus Dom;12,00;EUR;privat vorgestreckt;;geprüft;weg.jpg;Bild auf diesem Gerät nicht vorhanden');
    expect(zeilen[3]).toBe(`Beleg-Eingang/2026-11-12_${wartet.receipt.name};Beleg-Eingang;12.11.2026;;;Bäckerei;7,50;EUR;;;noch nicht zugeordnet;${wartet.receipt.name};`);
  });
  it('ohne Fotos: nur die Liste mit Hinweis; ein Fehler beim Lesen eines Bildes bricht nicht ab', async () => {
    const leer = await lesen((await belegeZip([])).blob);
    expect(Object.keys(leer.files)).toEqual(['Belegliste.csv']);
    expect((await csv(leer))[1]).toMatch(/Keine Belegfotos/);
    const s = bestand({ expenses: [kosten(), kosten({ date: '2026-11-11' })] });
    let aufruf = 0;
    const ergebnis = await belegeZip(belegListe(s), async (r) => { if (aufruf++ === 0) throw new Error('Ordner weg'); return ausSpeicher(r); });
    expect([ergebnis.fotos, ergebnis.fehlen]).toEqual([1, 1]);
  });
});
