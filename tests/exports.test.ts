import { afterEach, describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';
import Papa from 'papaparse';
import JSZip from 'jszip';
import { buildStatement } from '../lib/calculations';
import { demoState } from '../lib/demo';
import { stateForStatementVersion } from '../lib/statement-comparison';
import { buildPdfDocument, correctionExportNotice, exportCsv, exportExcel, exportZip, statementAmountLabel, statementExportFilename } from '../lib/exports';
import type { StatementSnapshot } from '../lib/types';

const month = '2026-06';
const columns = ['Name','Abrechnungsmonat','Fahrzeug','Fahrzeugart','Kennzeichen','Datum','Beginn','Ende','Abwesenheitsminuten','Reiseziel','Reisezweck','Kunde','Kilometer','SpesenVorKürzung','Frühstückskürzung','Mittagessenkürzung','Abendessenkürzung','SpesenNachKürzung','Kilometererstattung','Tankkosten','Übernachtung','SonstigeKosten','OffenerBetrag','Berechnung'];
const datevColumns = ['Belegdatum','Buchungstext','Betrag','Währung','Kostenstelle'];
const context = (version: number) => ({ version, correction: version > 1 });
function fixture() {
  const state = demoState(); state.statements = []; state.settings.profileName = 'Synthetisches Altprofil';
  state.trips = [{ ...state.trips[0], id: 'export-trip', date: '2026-06-10', endDate: '2026-06-10', startTime: '08:00', endTime: '17:00', absenceConfirmed: true, manualAbsenceMinutes: undefined, overnight: false, businessKm: 0, privateKm: 0, meals: { breakfast: false, lunch: false, dinner: false }, dailyMeals: {}, warnings: [] }];
  state.expenses = [{ ...state.expenses[0], id: 'old-hotel', date: '2026-06-10', category: 'Hotel', gross: 100, net: 100, vat: 0, vatRate: 0, exchangeRate: 1, businessShare: 100, paymentType: 'privat vorgestreckt', reimbursementStatus: 'offen', status: 'geprüft', tripId: 'export-trip', warnings: [], receipt: { id: 'old-file', name: 'synthetic-old.pdf', type: 'application/pdf', size: 20, hash: 'old', dataUrl: 'data:application/pdf;base64,' + btoa('%PDF synthetic OLD') } }];
  const capture = (version: number): StatementSnapshot => ({ id: `export-v${version}`, month, number: 'RK-UNCHANGED-001', version, status: version === 1 ? 'ausgezahlt' : 'freigegeben', locked: true, createdAt: '2026-10-18T12:00:00Z', data: structuredClone(buildStatement(state, month)), settingsSnapshot: structuredClone(state.settings), expensesSnapshot: structuredClone(state.expenses), relatedTripsSnapshot: [] });
  const first = capture(1); state.statements.push(first);
  state.expenses.push({ ...structuredClone(state.expenses[0]), id: 'late-hotel', date: '2026-06-15', gross: 120, net: 120, receipt: undefined });
  const second = capture(2); state.statements.push(second);
  state.expenses[0].gross = 999; state.expenses[0].receipt!.dataUrl = 'data:application/pdf;base64,' + btoa('%PDF synthetic NEW'); state.settings.profileName = 'Synthetisches Neuprofil';
  return { state, first, second };
}
function downloads() {
  const files: { name: string; blob: Blob }[] = []; const blobs = new Map<string, Blob>();
  vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { const key = `blob:synthetic-${blobs.size}`; blobs.set(key, blob as Blob); return key; });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.stubGlobal('document', { createElement: () => ({ href: '', download: '', click() { files.push({ name: this.download, blob: blobs.get(this.href)! }); } }) });
  return files;
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Versionssichere und zahlungsneutrale Exporte', () => {
  it.each(['pdf','xlsx','csv','zip'])('unterscheidet Versionen im %s-Dateinamen', extension => {
    expect(statementExportFilename(month, extension, context(1))).toBe(`Reisekosten_2026-06_V01.${extension}`);
    expect(statementExportFilename(month, extension, context(2))).toBe(`Reisekosten_2026-06_V02.${extension}`);
    expect(statementExportFilename(month, extension, context(103))).toContain('_V103.');
  });
  it('unterscheidet DATEV-Versionen und kennzeichnet ungespeicherte Vorschauen ohne erfundene Versionsnummer', () => {
    expect(statementExportFilename(month, 'csv', context(2), true)).toBe('DATEV_Reisekosten_2026-06_V02.csv');
    expect(statementExportFilename(month, 'pdf')).toBe('Reisekosten_2026-06_Entwurf.pdf');
  });
  it('zeigt Version und ursprüngliche Abrechnungsnummer in PDF, ohne offene Auszahlung zu behaupten', () => {
    const { state, first, second } = fixture(); const before = structuredClone(state);
    for (const snapshot of [first, second]) {
      const pdf = buildPdfDocument(snapshot.data, stateForStatementVersion(state, snapshot), snapshot.number, context(snapshot.version)).output().replace(/\) Tj\s*T\* \(/g, ' ');
      expect(pdf).toContain(`Abrechnungsversion: Version ${snapshot.version}`); expect(pdf).toContain(snapshot.number);
      expect(pdf).toContain(statementAmountLabel); expect(pdf).not.toContain('Offener Auszahlungsbetrag'); expect(pdf).not.toContain('(Offen)');
      if (snapshot.version === 2) { expect(pdf).toContain('keine automatisch offenen Restzahlungen'); expect(pdf).toContain('Zahlungsbedarf'); expect(pdf).toContain('gesondert abgestimmt werden'); }
    }
    expect(state).toEqual(before); expect(first.status).toBe('ausgezahlt'); expect(second.status).toBe('freigegeben');
  });
  it('bewahrt XLSX-Datenspalten und historische Beträge; Hinweise stehen nur im menschlich lesbaren Übersichtsblatt', async () => {
    const files = downloads(); const { state, first, second } = fixture();
    for (const snapshot of [first, second]) await exportExcel(snapshot.data, stateForStatementVersion(state, snapshot), context(snapshot.version));
    expect(files.map(file => file.name)).toEqual(['Reisekosten_2026-06_V01.xlsx','Reisekosten_2026-06_V02.xlsx']);
    for (let i = 0; i < files.length; i++) {
      const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(Buffer.from(await files[i].blob.arrayBuffer()) as unknown as Parameters<typeof workbook.xlsx.load>[0]);
      const rows = workbook.getWorksheet('Reisekosten')!; expect((rows.getRow(1).values as ExcelJS.CellValue[]).slice(1)).toEqual(columns);
      let total = 0; rows.eachRow((row, index) => { if (index > 1) total += Number(row.getCell(columns.indexOf('OffenerBetrag') + 1).value); });
      expect(total).toBe(i === 0 ? 114 : 234); expect(workbook.getWorksheet('Übersicht')!.getCell('B2').value).toBe('Synthetisches Altprofil');
      const overview: string[] = []; workbook.getWorksheet('Übersicht')!.eachRow(row => overview.push(JSON.stringify(row.values)));
      expect(overview.join(' ')).toContain(`Version ${i + 1}`); if (i === 1) expect(overview.join(' ')).toContain(correctionExportNotice);
    }
  });
  it.each([false, true])('bewahrt CSV/DATEV-Schema und vollständige historische Beträge (DATEV=%s)', async datev => {
    const files = downloads(); const { state, first, second } = fixture();
    for (const snapshot of [first, second]) exportCsv(snapshot.data, stateForStatementVersion(state, snapshot), datev, context(snapshot.version));
    expect(files.map(file => file.name)).toEqual([1, 2].map(version => `${datev ? 'DATEV_' : ''}Reisekosten_2026-06_V0${version}.csv`));
    for (let i = 0; i < files.length; i++) {
      const csv = Papa.parse<Record<string, string>>(await files[i].blob.text(), { delimiter: ';', header: true });
      expect(csv.meta.fields).toEqual(datev ? datevColumns : columns); expect(csv.errors).toEqual([]);
      const total = csv.data.reduce((sum, row) => sum + Number((datev ? row.Betrag : row.OffenerBetrag).replace(',', '.')), 0);
      expect(total).toBe(i === 0 ? 114 : 234); // Full version, never a computed +120 payment/difference booking.
    }
  });
  it('bewahrt gewählte ZIP-Beträge und Originalbelegbytes einschließlich versionssicherer innerer Dateinamen', async () => {
    const files = downloads(); const { state, first, second } = fixture(); const before = structuredClone(state);
    for (const snapshot of [first, second]) await exportZip(snapshot.data, stateForStatementVersion(state, snapshot), snapshot.number, context(snapshot.version));
    for (let i = 0; i < files.length; i++) {
      const suffix = `V0${i + 1}`; expect(files[i].name).toBe(`Reisekosten_2026-06_${suffix}.zip`);
      const zip = await JSZip.loadAsync(await files[i].blob.arrayBuffer()); const pdf = await zip.file(`Reisekosten_2026-06_${suffix}.pdf`)!.async('string');
      expect(pdf).toContain(`Abrechnungsversion: Version ${i + 1}`);
      const stored = JSON.parse(await zip.file(`Abrechnung_2026-06_${suffix}.json`)!.async('string'));
      expect(stored.number).toBe(first.number); expect(stored.data).toEqual(JSON.parse(JSON.stringify((i === 0 ? first : second).data)));
      expect(await zip.file('Belege/old-hotel_synthetic-old.pdf')!.async('string')).toBe('%PDF synthetic OLD');
    }
    expect(state).toEqual(before);
  });
});

describe('Restpunkte der Durchsicht (1.8.6)', () => {
  it('Summen nach Kostenart in Euro – Fremdwährung mit dem gespeicherten Kurs', () => {
    const { state } = fixture();
    state.expenses = [{ ...state.expenses[0], id: 'chf-hotel', date: '2026-06-10', category: 'Hotel', gross: 100, net: 100, currency: 'CHF', exchangeRate: 0.95, receipt: undefined },
      { ...state.expenses[0], id: 'chf-park', date: '2026-06-10', category: 'Parken', gross: 20, net: 20, currency: 'CHF', exchangeRate: 0.95, paymentType: 'Firmenkarte', reimbursementStatus: 'nicht erstattungsfähig', receipt: undefined }];
    const data = buildStatement(state, month);
    expect(data.totals.accommodation).toBe(95);
    expect(data.totals.other).toBe(19);
    expect(data.totals.companyPaid).toBe(19);
    expect(data.totals.grandTotal).toBe(Math.round((data.totals.allowance + data.totals.mileage + 95 + 19) * 100) / 100);
  });
  it('DATEV ohne 0,00-Zeilen; Buchungstext ohne leere Teile', async () => {
    const files = downloads(); const { state } = fixture();
    state.trips = [];
    state.expenses = [{ ...state.expenses[0], id: 'park', date: '2026-06-10', category: 'Parken', gross: 6, net: 6, paymentType: 'privat vorgestreckt', reimbursementStatus: 'offen', receipt: undefined },
      { ...state.expenses[0], id: 'firma', date: '2026-06-11', category: 'Bahn', gross: 50, net: 50, paymentType: 'Firmenkarte', reimbursementStatus: 'nicht erstattungsfähig', receipt: undefined }];
    exportCsv(buildStatement(state, month), state, true);
    const csv = Papa.parse<Record<string, string>>((await files[0].blob.text()).replace(/^﻿/, ''), { header: true, delimiter: ';', skipEmptyLines: true });
    expect(csv.data.map(row => [row.Belegdatum, row.Buchungstext, row.Betrag])).toEqual([['20260610', 'Auslagen Parken', '6,00']]);
  });
  it('Excel: Summen im Übersichtsblatt, Beträge mit Euro-Format', async () => {
    const files = downloads(); const { state, first } = fixture();
    await exportExcel(first.data, stateForStatementVersion(state, first), context(1));
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(Buffer.from(await files[0].blob.arrayBuffer()) as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const overview: (string | number)[][] = []; workbook.getWorksheet('Übersicht')!.eachRow(row => overview.push((row.values as (string | number)[]).slice(1)));
    expect(overview).toContainEqual(['Persönliche Erstattung (offener Betrag)', first.data.totals.openAmount]);
    expect(overview).toContainEqual(['Übernachtung', first.data.totals.accommodation]);
    const sheet = workbook.getWorksheet('Reisekosten')!;
    const col = (sheet.getRow(1).values as string[]).indexOf('OffenerBetrag');
    expect(sheet.getColumn(col).numFmt).toBe('#,##0.00 "€"');
    expect(sheet.rowCount).toBe(first.data.rows.length + 1);
  });
});
