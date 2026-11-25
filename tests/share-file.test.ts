import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportCsv, setExportDelivery } from '../lib/exports';
import { buildStatement } from '../lib/calculations';
import { demoState } from '../lib/demo';
import { canShareFile, shareFile, shareSupported, shareableFile } from '../lib/share-file';

// Exporte teilen statt herunterladen (Handy/Tablet). Das Teilen-Menü selbst gehört dem Gerät; geprüft wird die Entscheidung davor.
const pdf = new File(['%PDF'], 'Reisekosten_2026-07_V01.pdf', { type: 'application/pdf' });
const gerät = (teilbar: (file: File) => boolean, share: () => Promise<void> = async () => {}) => ({ canShare: (data: { files: File[] }) => data.files.every(teilbar), share: vi.fn(share) });
const fehler = (name: string) => Object.assign(new Error(name), { name });
afterEach(() => { setExportDelivery(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Teilen-Menü: was geht an das Gerät, was wird heruntergeladen', () => {
  it('ohne Teilen-Menü (PC, ältere Browser): nicht teilbar', async () => {
    expect(shareSupported(undefined)).toBe(false);
    expect(shareSupported({})).toBe(false);
    expect(shareSupported({ share: async () => {} })).toBe(false);   // share ohne canShare: Dateien nicht zugesagt
    expect(await shareFile(pdf, {})).toBe('unsupported');
  });
  it('teilbare Datei geht mit unverändertem Namen an das Teilen-Menü', async () => {
    const nav = gerät(() => true);
    expect(shareSupported(nav)).toBe(true);
    expect(await shareFile(pdf, nav)).toBe('shared');
    expect(nav.share).toHaveBeenCalledWith({ files: [pdf] });
  });
  it('Dateiart, die das Gerät nicht teilt (z. B. Excel auf manchen Handys): unsupported, share wird nicht aufgerufen', async () => {
    const nav = gerät((file) => file.name.endsWith('.pdf'));
    const xlsx = new File(['x'], 'Reisekosten_2026-07_V01.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    expect(canShareFile(xlsx, nav)).toBe(false);
    expect(await shareFile(xlsx, nav)).toBe('unsupported');
    expect(nav.share).not.toHaveBeenCalled();
  });
  it('Menü geschlossen, zweiter Tipp nötig, anderer Fehler', async () => {
    expect(await shareFile(pdf, gerät(() => true, async () => { throw fehler('AbortError'); }))).toBe('cancelled');
    expect(await shareFile(pdf, gerät(() => true, async () => { throw fehler('NotAllowedError'); }))).toBe('needs-tap');
    expect(await shareFile(pdf, gerät(() => true, async () => { throw fehler('DataError'); }))).toBe('failed');
    expect(canShareFile(pdf, { share: async () => {}, canShare: () => { throw fehler('TypeError'); } })).toBe(false);
  });
  it('Dateityp ohne Zusatz „;charset=utf-8“, Name und Inhalt unverändert', async () => {
    const file = shareableFile(new Blob(['﻿a;b'], { type: 'text/csv;charset=utf-8' }), 'Reisekosten_2026-07_V01.csv');
    expect([file.name, file.type]).toEqual(['Reisekosten_2026-07_V01.csv', 'text/csv']);
    expect([...new Uint8Array(await file.arrayBuffer())]).toEqual([0xef, 0xbb, 0xbf, 0x61, 0x3b, 0x62]);   // BOM für Excel bleibt
  });
});

describe('Exporte laufen über eine umschaltbare Übergabe', () => {
  const state = demoState(), month = '2026-07', data = buildStatement(state, month);
  it('gesetzt: Datei geht an die Übergabe statt in den Download – gleicher Name, gleicher Inhalt', () => {
    const geteilt: { name: string; blob: Blob }[] = [];
    const click = vi.fn();
    vi.stubGlobal('document', { createElement: () => ({ click }) });
    setExportDelivery((blob, name) => geteilt.push({ name, blob }));
    exportCsv(data, state, false, { version: 1, correction: false });
    expect(geteilt.map((f) => f.name)).toEqual(['Reisekosten_2026-07_V01.csv']);
    expect(geteilt[0].blob.size).toBeGreaterThan(100);
    expect(click).not.toHaveBeenCalled();
  });
  it('zurückgesetzt: wieder Download', () => {
    const namen: string[] = [];
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x'); vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.stubGlobal('document', { createElement: () => ({ href: '', download: '', click() { namen.push(this.download); } }) });
    setExportDelivery(() => { throw Error('darf nicht mehr gelten'); });
    setExportDelivery();
    exportCsv(data, state, true, { version: 1, correction: false });
    expect(namen).toEqual(['Buchungsliste_Reisekosten_2026-07_V01.csv']);
  });
});
