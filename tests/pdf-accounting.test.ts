import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, degrees } from 'pdf-lib';
import JSZip from 'jszip';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildPdfDocument, pdfFile, zipFile } from '../lib/exports';
import { receiptIndex } from '../lib/receipt-index';
import { stateForStatementVersion } from '../lib/statement-comparison';
import { accountingMonth } from './fixtures/accounting-month';
import { buildStatement } from '../lib/calculations';
import { statementPdfBytes } from '../lib/pdf-statement';
const context = { version: 1, correction: false };
const text = async (blob: Blob) => Buffer.from(await blob.arrayBuffer()).toString('latin1');

describe('Buchhaltung: PDF und eindeutige Belegzuordnung', () => {
  it('erzeugt die vollständige Musterabrechnung aus dem eingefrorenen Monatsstand', async () => {
    const { state, data, snapshot } = accountingMonth(); const before = structuredClone(state);
    expect(data.totals.allowance).toBe(89.6);
    expect(data.totals.mileage).toBe(236.4);
    expect(data.totals.companyPaid).toBe(312);
    expect(data.totals.reimbursed).toBe(24.6);
    expect(data.totals.openAmount).toBe(413.2);
    const entries = receiptIndex(data, state);
    expect(entries.map(entry => entry.personalAmount)).toEqual([12.5, 0, 46.8, 0, 19.9, 8]);
    expect(entries.map(entry => entry.number)).toEqual([1, 2, 3, 4, 5, 6].map(i => `B-202609-00${i}`));
    const file = await pdfFile(data, stateForStatementVersion(state, snapshot), snapshot.number, context);
    const bytes = await file.blob.arrayBuffer(); const document = await PDFDocument.load(bytes);
    expect(document.getPageCount()).toBe(buildPdfDocument(data, state, snapshot.number, context).getNumberOfPages() + 1); // zweiseitiges Original statt einer Platzhalterseite
    for (const page of document.getPages()) {
      expect(page.getWidth()).toBeCloseTo(595.28, 1); expect(page.getHeight()).toBeCloseTo(841.89, 1);
    }
    const content = await text(file.blob);
    expect(content).toContain('413,20'); expect(content).toContain('Originalseite 2'); expect(content).toContain('Fiktiver Fahrschein');
    // Ein bereits gestrichener Rechteckpfad würde Bilder unsichtbar abschneiden (leere Anlagen).
    expect(content).toMatch(/re\s+W\s+n/); expect(content).not.toMatch(/re\s+S\s+W\s+n/);
    expect(state).toEqual(before);
    if (process.env.PDF_SAMPLE_DIR) {
      await mkdir(process.env.PDF_SAMPLE_DIR, { recursive: true });
      await writeFile(path.join(process.env.PDF_SAMPLE_DIR, 'Spesenabrechnung_Muster_2026-09.pdf'), Buffer.from(bytes));
      const zip = await zipFile(data, stateForStatementVersion(state, snapshot), snapshot.number, context);
      await writeFile(path.join(process.env.PDF_SAMPLE_DIR, 'Spesenabrechnung_Muster_2026-09.zip'), Buffer.from(await zip.blob.arrayBuffer()));
      await writeFile(path.join(process.env.PDF_SAMPLE_DIR, 'Pruefdaten.json'), JSON.stringify({ totals: data.totals, days: data.rows.map(row => ({ date: row.date, before: row.allowanceBefore, cuts: row.breakfastCut + row.lunchCut + row.dinnerCut, allowance: row.allowanceAfter, mileage: row.mileage, personal: row.openAmount })), receipts: entries.map(entry => ({ number: entry.number, date: entry.expense.date, file: entry.expense.receipt?.name, gross: entry.expense.gross, personal: entry.personalAmount, archivePath: entry.archivePath })) }, null, 2));
    }
  });
  it('nummeriert stabil, schließt stornierte Positionen aus und bewahrt gleichnamige Originale im ZIP', async () => {
    const { state, data, snapshot } = accountingMonth();
    state.expenses[1].receipt!.name = state.expenses[0].receipt!.name;
    state.expenses.push({ ...state.expenses[0], id: 'cancelled', status: 'storniert', description: 'DARF NICHT ERSCHEINEN' });
    const originalOrder = receiptIndex(data, state).map(entry => entry.expense.id);
    state.expenses.reverse(); expect(receiptIndex(data, state).map(entry => entry.expense.id)).toEqual(originalOrder);
    const file = await zipFile(data, state, snapshot.number, context);
    const zip = await JSZip.loadAsync(await file.blob.arrayBuffer());
    const manifest = await zip.file('Belegverzeichnis.csv')!.async('string');
    expect(manifest).not.toContain('DARF NICHT ERSCHEINEN');
    for (const entry of receiptIndex(data, state)) {
      expect(manifest).toContain(entry.number); expect(manifest).toContain(entry.archivePath);
      expect(await zip.file(entry.archivePath!)!.async('base64')).toBe(entry.expense.receipt!.dataUrl.split(',')[1]);
    }
  });
  it.each(['missing', 'heic', 'broken-image', 'broken-pdf'] as const)('kennzeichnet %s ohne stilles Auslassen oder erfundene Ersatzdatei', async kind => {
    const { state, data, snapshot } = accountingMonth();
    if (kind === 'missing') state.expenses[0].receipt = undefined;
    if (kind === 'heic') state.expenses[0].receipt = { ...state.expenses[0].receipt!, type: 'image/heic', dataUrl: 'data:image/heic;base64,SGVpYw==', name: 'Muster.heic' };
    if (kind === 'broken-image') state.expenses[0].receipt!.dataUrl = 'data:image/png;base64,a2FwdXR0';
    if (kind === 'broken-pdf') state.expenses[1].receipt!.dataUrl = 'data:application/pdf;base64,a2FwdXR0';
    const file = await pdfFile(data, state, snapshot.number, context); const content = await text(file.blob);
    expect(content).toContain('413,20'); expect(content).toContain(kind === 'missing' ? 'Beleg fehlt' : 'Original separat');
    if (kind !== 'missing') expect(content).toContain('nicht Bestandteil dieser PDF');
  });
  it('bettet gedrehte und beschnittene Original-PDF-Seiten ein', async () => {
    const { state, data, snapshot } = accountingMonth(); const rec = state.expenses[1].receipt!;
    const source = await PDFDocument.load(Uint8Array.from(atob(rec.dataUrl.split(',')[1]), c => c.charCodeAt(0)));
    source.getPage(0).setRotation(degrees(90)); source.getPage(1).setRotation(degrees(270));
    source.getPage(1).setCropBox(10, 10, 570, 810);
    rec.dataUrl = 'data:application/pdf;base64,' + Buffer.from(await source.save()).toString('base64');
    const file = await pdfFile(data, state, snapshot.number, context);
    expect(await text(file.blob)).toContain('Originalseite 2');
    if (process.env.PDF_SAMPLE_DIR) await writeFile(path.join(process.env.PDF_SAMPLE_DIR, 'Drehung_Pruefung.pdf'), Buffer.from(await file.blob.arrayBuffer()));
  });
  it('exportiert bei nachträglichen Änderungen weiterhin alte Beträge, Profil und Originalbelege', async () => {
    const { state, data, snapshot } = accountingMonth();
    state.settings.profileName = 'NEUES PROFIL NICHT EXPORTIEREN'; state.expenses[0].gross = 999;
    state.expenses[0].receipt!.dataUrl = 'data:image/png;base64,SGVpYw==';
    const frozen = stateForStatementVersion(state, snapshot); const before = structuredClone(state);
    const file = await pdfFile(snapshot.data, frozen, snapshot.number, context);
    expect(await text(file.blob)).not.toContain('NEUES PROFIL'); expect(await text(file.blob)).toContain('413,20');
    expect(receiptIndex(data, frozen)[0].expense.gross).toBe(12.5); expect(state).toEqual(before);
  });
  it('erfindet bei älteren Abschlüssen keine aktuellen Belege und dokumentiert vorhandene Einzelbeträge', async () => {
    const { state, data, snapshot } = accountingMonth(); delete snapshot.expensesSnapshot;
    const file = await pdfFile(data, stateForStatementVersion(state, snapshot), snapshot.number, context);
    expect(await text(file.blob)).toContain('historisch nicht gespeichert');
    expect(await text(file.blob)).not.toContain('Fiktiver Fahrschein');
    expect(receiptIndex(data, stateForStatementVersion(state, snapshot))).toHaveLength(6);
  });
  it('zeigt historische Tageskosten auch ohne Einzelpositionen oder Beleg-Snapshot', async () => {
    const { state, data, snapshot } = accountingMonth(); delete snapshot.expensesSnapshot;
    for (const row of data.rows) delete row.contributions;
    const file = await pdfFile(data, stateForStatementVersion(state, snapshot), snapshot.number, context);
    const content = await text(file.blob);
    expect(content).toContain('Historische Tageskosten'); expect(content).toContain('312,00');
    expect(content).toContain('413,20'); expect(content).not.toContain('Fiktiver Fahrschein');
  });
  it('wiederholt Tabellenköpfe und nummeriert auch lange Abrechnungen vollständig', async () => {
    const { state, snapshot } = accountingMonth();
    const base = state.expenses[0];
    state.expenses = Array.from({ length: 50 }, (_, i) => ({ ...base, id: `position-${String(i).padStart(3, '0')}`, description: `Position ${i + 1} mit ausführlicher Projektbeschreibung und längerer Rechnungszuordnung`, receipt: undefined }));
    const data = buildStatement(state, '2026-09');
    const file = await pdfFile(data, state, snapshot.number, context); const content = await text(file.blob);
    const doc = await PDFDocument.load(await file.blob.arrayBuffer());
    expect(content.match(/Erstattung EUR/g)!.length).toBeGreaterThan(1);
    expect(content.match(/Seite \d+ \/ \d+/g)).toHaveLength(doc.getPageCount());
    expect(content).toContain('B-202609-050');
    if (process.env.PDF_SAMPLE_DIR) await writeFile(path.join(process.env.PDF_SAMPLE_DIR, 'Seitenumbrueche_Pruefung.pdf'), Buffer.from(await file.blob.arrayBuffer()));
  });
  it('weist PDF-Formularfelder als separat beizufügend aus statt sichtbare Werte zu verlieren', async () => {
    const { state, data, snapshot } = accountingMonth(); const rec = state.expenses[1].receipt!;
    const source = await PDFDocument.load(Uint8Array.from(atob(rec.dataUrl.split(',')[1]), c => c.charCodeAt(0)));
    const field = source.getForm().createTextField('rechnung'); field.setText('312,00 EUR'); field.addToPage(source.getPage(0));
    rec.dataUrl = 'data:application/pdf;base64,' + Buffer.from(await source.save()).toString('base64');
    const file = await pdfFile(data, state, snapshot.number, context);
    expect(await text(file.blob)).toContain('Formularfelder'); expect(await text(file.blob)).toContain('Original separat');
  });
  it('bewahrt die Druckaktion auch beim Ergänzen von PDF-Belegen', async () => {
    const { state, data, snapshot } = accountingMonth();
    const doc = await PDFDocument.load(await statementPdfBytes(data, state, snapshot.number, context, true));
    expect(doc.catalog.get(PDFName.of('OpenAction'))).toBeDefined();
  });
});
