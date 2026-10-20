import { jsPDF, GState } from 'jspdf';
import companyLogo from './assets/firmenlogo.png?inline';
import autoTable, { type CellInput } from 'jspdf-autotable';
import type { PDFDocument, PDFPage } from 'pdf-lib';
import type { AppState, StatementData, Trip } from './types';
import { receiptIndex, type ReceiptEntry } from './receipt-index';
import { correctionExportNotice, statementAmountLabel, type StatementExportContext } from './export-context';

const M = 17, W = 176, TOP = 34, BOTTOM = 274;
// Spektron-Palette aus app/globals.css; Firmenlogo wie in PlanKit.
export const pdfCompanyName = 'Dr. Schiffers & Partner';
const navy: [number, number, number] = [33, 48, 62];
const brand: [number, number, number] = [53, 109, 168];
const muted: [number, number, number] = [98, 120, 143];
const clean = (value: unknown) => String(value ?? '').replace(/[\u00a0\u202f]/g, ' ').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
const euro = (n: number) => clean(n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }));
const date = (s: string) => s ? s.slice(0, 10).split('-').reverse().join('.') : '–';
const day = (s: string) => s ? date(s).slice(0, 6) : '–';
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
const duration = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')} Std.`;
const shortTime = (s: string) => s || '–';
const fileMime = (entry: ReceiptEntry) => (/^data:([^;,]+)/i.exec(entry.expense.receipt?.dataUrl || '')?.[1] || entry.expense.receipt?.type || '').toLowerCase();
const pdfBytes = (url: string) => Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), c => c.charCodeAt(0));
interface NativePdf { source: PDFDocument; pages: PDFPage[] }
interface Placement { page: number; sourcePage: number; entry: string; y: number; height: number }
interface ImagePlan { type: 'image'; data: string; format: string; width: number; height: number; parts: number }
interface TextPlan { type: 'text'; message: string }
type Plan = ImagePlan | TextPlan | { type: 'pdf'; pages: number };

function attachmentPlan(doc: jsPDF, entry: ReceiptEntry, native: Map<string, NativePdf>, failed: Set<string>): Plan {
  const receipt = entry.expense.receipt;
  if (!receipt) return { type: 'text', message: entry.historicalDetailsMissing ? 'Die Belegdatei fehlt im gespeicherten historischen Stand.' : 'Es wurde keine Belegdatei gespeichert. Bitte den Beleg nachreichen.' };
  if (native.has(entry.number)) return { type: 'pdf', pages: native.get(entry.number)!.pages.length };
  const mime = fileMime(entry);
  if (/^image\/(png|jpe?g)$/.test(mime)) {
    try {
      const image = doc.getImageProperties(receipt.dataUrl);
      if (!(image.width > 0 && image.height > 0)) throw Error('Leeres Bild');
      // Normale Scans passen auf eine Seite. Lange Kassenbons bleiben breit und werden mit Überlappung geteilt.
      const scale = Math.min(W / image.width, image.height / image.width > 2.2 ? Infinity : 210 / image.height);
      const width = image.width * scale, height = image.height * scale;
      return { type: 'image', data: receipt.dataUrl, format: image.fileType, width, height, parts: Math.max(1, Math.ceil((height - 8) / (210 - 8))) };
    } catch { return { type: 'text', message: 'Die Bilddatei ist nicht lesbar und konnte nicht eingebettet werden. Bitte die Originaldatei separat beifügen.' }; }
  }
  return { type: 'text', message: mime === 'application/pdf'
    ? failed.has(entry.number) ? 'Die PDF-Datei ist geschützt, nicht vollständig lesbar oder enthält Anmerkungen bzw. Formularfelder. Bitte die Originaldatei separat beifügen.' : 'Die Original-PDF wird im vollständigen PDF-Export eingebettet.'
    : 'Dieses Belegformat kann nicht in die PDF eingebettet werden. Bitte die Originaldatei separat beifügen.' };
}

/** Rendern nutzt ausschließlich übergebene Monatsbeträge; es berechnet keine Ansprüche neu. */
function render(data: StatementData, state: AppState, number: string, context: StatementExportContext | undefined, native = new Map<string, NativePdf>(), failed = new Set<string>()) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  doc.setProperties({ title: `Spesenabrechnung ${data.month} · ${state.settings.profileName}`, author: state.settings.profileName || 'SpesenKit', subject: number, creator: 'SpesenKit' });
  const month = new Date(`${data.month}-01T12:00:00`).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
  const entries = receiptIndex(data, state);
  const plans = new Map(entries.map(entry => [entry.number, attachmentPlan(doc, entry, native, failed)]));
  const trips = new Map(data.rows.flatMap(row => row.trips.map(trip => [trip.id, trip] as const)));
  for (const entry of entries) {
    const related = state.trips.find(trip => trip.id === entry.expense.tripId);
    if (related && !trips.has(related.id)) trips.set(related.id, related);
  }
  const orderedTrips = [...trips.values()].sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime) || a.id.localeCompare(b.id));
  const refs = new Map(orderedTrips.map((trip, i) => [trip.id, `R${String(i + 1).padStart(2, '0')}`]));
  const sections = new Map<number, string>([[1, 'Übersicht']]);
  const placements: Placement[] = [];
  let section = 'Übersicht', y = 26;
  const mark = () => { sections.set(doc.getCurrentPageInfo().pageNumber, section); };
  const newPage = (title: string) => {
    doc.addPage(); section = title; mark();
    doc.setTextColor(...navy); doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.text(clean(title), M, 27); y = 36;
  };
  const room = (height: number) => { if (y + height > BOTTOM) newPage(section); };
  const paragraph = (value: string, size = 9, color = muted) => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(size); doc.setTextColor(...color);
    const lines = doc.splitTextToSize(clean(value), W) as string[];
    for (const line of lines) { room(size * .43 + 1); doc.text(line, M, y); y += size * .43 + 1; }
    y += 3;
  };
  const table = (head: string[], body: CellInput[][], widths: number[], money: number[] = [], foot?: CellInput[][], capture?: (row: number, x: number, cellY: number, page: number) => void) => {
    autoTable(doc, {
      startY: y, head: head.length ? [head] : undefined, body, foot, showFoot: 'lastPage',
      theme: head.length ? 'striped' : 'plain', showHead: 'everyPage', rowPageBreak: 'avoid',
      margin: { left: M, right: M, top: TOP, bottom: 23 },
      styles: { font: 'helvetica', fontSize: 8.3, cellPadding: 2.4, overflow: 'linebreak', valign: 'top', textColor: navy, lineColor: [225, 230, 235] },
      headStyles: { fillColor: brand, textColor: [255, 255, 255], fontSize: 8.1 },
      footStyles: { fillColor: [230, 240, 251], textColor: navy, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [244, 249, 254] },
      columnStyles: Object.fromEntries(widths.map((width, i) => [i, { cellWidth: width, halign: money.includes(i) ? 'right' : 'left' }])),
      willDrawPage: mark,
      didDrawCell: capture ? hook => { if (hook.section === 'body' && hook.column.index === 3) capture(hook.row.index, hook.cell.x, hook.cell.y, doc.getCurrentPageInfo().pageNumber); } : undefined,
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 7;
  };
  const refsForDay = (items: Trip[]) => [...new Set(items.map(trip => refs.get(trip.id)).filter(Boolean))].join(', ') || '–';
  const status = (entry: ReceiptEntry) => {
    if (!entry.expense.receipt) return entry.historicalDetailsMissing ? 'Beleg historisch nicht gespeichert' : 'Beleg fehlt – nachreichen';
    const plan = plans.get(entry.number)!;
    return plan.type === 'pdf' ? `PDF beigefügt · ${plan.pages} Originalseite(n)` : plan.type === 'image' ? `Bild beigefügt · ${plan.parts} Anlagenseite(n)` : 'Original separat beifügen';
  };

  doc.setTextColor(...navy); doc.setFont('helvetica', 'bold'); doc.setFontSize(22); doc.text('Spesenabrechnung', M, y); y += 7;
  paragraph(`Reisekostenabrechnung · ${month}`, 12, navy);
  paragraph(context ? `Abrechnungsversion: Version ${context.version}` : 'Nicht gespeicherter Entwurf', 9);
  paragraph(state.settings.profileName || 'Name nicht hinterlegt', 15, navy);
  const metadata = [['Firma', state.settings.company || 'Nicht hinterlegt'],
    ...(state.settings.employeeNumber ? [['Personalnummer', state.settings.employeeNumber]] : []),
    ...(state.settings.department ? [['Abteilung', state.settings.department]] : []),
    ...(state.settings.costCenter ? [['Kostenstelle', state.settings.costCenter]] : [])];
  table([], metadata.map(row => row.map(clean)), [36, 140]);
  room(41); doc.setFillColor(230, 240, 251); doc.roundedRect(M, y, W, 34, 2, 2, 'F');
  doc.setTextColor(...navy); doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.text(statementAmountLabel, M + 5, y + 9);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(25); doc.text(euro(data.totals.openAmount), M + 5, y + 25); y += 43;
  table(['Zusammensetzung', 'EUR'], [
    ['Verpflegungspauschalen nach Kürzungen', euro(data.totals.allowance)],
    ['Kilometererstattung', euro(data.totals.mileage)],
    ['Persönlich erstattungsfähige Auslagen', euro(data.totals.openAmount - data.totals.allowance - data.totals.mileage)],
  ], [130, 46], [1], [['Erstattungsbetrag laut Abrechnungsstand', euro(data.totals.openAmount)]]);
  paragraph('Der ausgewiesene Betrag dokumentiert diesen Abrechnungsstand. Er ist keine Bestätigung einer Auszahlung oder noch ausstehenden Restzahlung.', 8.5);
  if (context?.correction) paragraph(correctionExportNotice, 9, navy);
  const missing = entries.filter(entry => !entry.expense.receipt).length;
  const separate = entries.filter(entry => entry.expense.receipt && plans.get(entry.number)?.type === 'text').length;
  paragraph(`${orderedTrips.length} Reisen · ${entries.length} Kostenpositionen · ${entries.length - missing} Belegdateien. Reisen, Tagespauschalen, Ausgaben und Belegverzeichnis folgen auf eigenen Seiten.`);
  if (missing || separate) paragraph(`Für die vollständige Abgabe ergänzen: ${missing} fehlende Belegdatei(en), ${separate} separat beizufügende Originaldatei(en). Die betroffenen Belegnummern stehen im Verzeichnis.`, 9, [143, 70, 24]);
  if (!entries.length && data.rows.some(row => row.fuel || row.accommodation || row.other)) paragraph('Historische Einzelangaben und Belege fehlen im gespeicherten Stand. Die gespeicherten Tagesbeträge sind weiterhin aufgeführt; aktuelle Dateien wurden nicht ergänzt.', 9, [143, 70, 24]);
  room(25); y += 6; paragraph('Ort / Datum: ____________________     Reisende Person: ____________________', 8);
  paragraph('Sachlich geprüft: __________________     Buchhaltung: ____________________', 8);

  newPage('1 · Reisen');
  paragraph('Jede Reise besitzt eine Referenz. Mehrtägige Reisen erscheinen einmal; die Tagespauschalen folgen getrennt.');
  table(['Reise', 'Abfahrt / Rückkehr', 'Strecke, Zweck und Projekt', 'Fahrzeug / Kilometer'], orderedTrips.map(trip => {
    const vehicle = state.settings.vehicles.find(item => item.id === trip.vehicleId);
    return [refs.get(trip.id)!, `${date(trip.date)} · ${shortTime(trip.startTime)}\n${date(trip.endDate || trip.date)} · ${shortTime(trip.endTime)}`,
      clean([`${trip.startPlace || 'Startort nicht hinterlegt'} – ${trip.destination || 'Ziel nicht hinterlegt'}`, trip.purpose, trip.order && `Projekt ${trip.order}`, trip.customer && `Kunde: ${trip.customer}`, !trip.date.startsWith(data.month) && !(trip.endDate || '').startsWith(data.month) && 'Zugeordnete Reise außerhalb dieses Monats'].filter(Boolean).join('\n')),
      clean([vehicle?.name || trip.vehicle || 'Fahrzeug nicht hinterlegt', vehicle?.ownership === 'privatwagen' ? 'Privatwagen' : vehicle?.ownership === 'dienstwagen' ? 'Dienstwagen' : trip.vehicleType,
        trip.plate || vehicle?.plate, `${trip.businessKm.toLocaleString('de-DE')} km dienstlich`].filter(Boolean).join('\n'))];
  }), [14, 43, 75, 44]);
  if (!orderedTrips.length) paragraph('In diesem Abrechnungsstand sind keine Dienstreisen gespeichert.');

  newPage('2 · Verpflegung und Kilometer');
  paragraph('Gespeicherte Tageswerte in EUR. Frühstück, Mittag- und Abendessen werden nur mit den bereits berechneten Kürzungen aufgeführt.');
  table(['Tag / Reise', 'Abwesenheit', 'Pauschale vor', 'Mahlzeitenkürzung', 'Pauschale nach', 'Kilometer EUR'], data.rows.map(row => [
    `${date(row.date)}\n${refsForDay(row.trips)}`, row.trips.length ? duration(row.absenceMinutes) : 'Nur Ausgaben', euro(row.allowanceBefore),
    [row.breakfastCut && `Frühstück ${euro(row.breakfastCut)}`, row.lunchCut && `Mittag ${euro(row.lunchCut)}`, row.dinnerCut && `Abend ${euro(row.dinnerCut)}`].filter(Boolean).join('\n') || 'Keine', euro(row.allowanceAfter), euro(row.mileage),
  ]), [27, 24, 27, 44, 27, 27], [2, 4, 5], [['Summe', '', euro(sum(data.rows.map(row => row.allowanceBefore))), euro(sum(data.rows.map(row => row.breakfastCut + row.lunchCut + row.dinnerCut))), euro(data.totals.allowance), euro(data.totals.mileage)]]);
  paragraph('Mehrere Reisen eines Tages teilen sich eine Tagespauschale. Bei mehrtägigen Reisen werden Kilometer gemäß dem gespeicherten Rechenstand angesetzt. Die Beträge stammen aus dem ausgewählten Rechenstand; gespeicherte Versionen werden nicht neu berechnet.');

  newPage('3 · Ausgaben und Belegzuordnung');
  paragraph('Jede Kostenposition verweist auf eine eindeutige Belegnummer. Brutto ist der Originalbetrag; Erstattung ist der gespeicherte persönliche Anteil in EUR. Firmenzahlungen sind keine persönliche Erstattung.');
  table(['Beleg', 'Datum', 'Kosten / Zuordnung', 'Zahlung / Anteil', 'Brutto', 'Erstattung EUR'], entries.map(entry => {
    const expense = entry.expense;
    const payment = ['Unternehmen', 'Firmenkarte'].includes(expense.paymentType) ? `${expense.paymentType}\nUnternehmen bezahlt` : expense.reimbursementStatus === 'erstattet' || expense.paymentType === 'bereits erstattet' ? 'Bereits erstattet' : `${expense.paymentType || 'Zahlungsart unbekannt'}\n${expense.reimbursementStatus}`;
    return [`${entry.number}${!expense.receipt ? '\nBeleg fehlt' : ''}`, day(expense.date), clean([...new Set([expense.category, expense.description, expense.merchant].filter(Boolean)),
      expense.invoiceNumber && `Rechnung ${expense.invoiceNumber}`, expense.tripId ? `Reise ${refs.get(expense.tripId) || 'historisch nicht gespeichert'}` : 'Keine Reise zugeordnet', expense.projectNumber && `Projekt ${expense.projectNumber}`, entry.excluded && 'Durch Kilometerpauschale abgegolten'].filter(Boolean).join('\n')),
      clean(`${payment}\n${expense.businessShare} % dienstlich`), clean(`${expense.gross.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${expense.currency}`), entry.personalAmount === null ? 'Nicht einzeln gespeichert' : euro(entry.personalAmount)];
  }), [28, 18, 46, 35, 23, 26], [4, 5]);
  if (!entries.length) paragraph('Keine gespeicherten Einzelkosten. Historische Belege werden nicht aus dem aktuellen Arbeitsstand ergänzt.');
  const legacyRows = data.rows.filter(row => !row.contributions?.expenses?.length && (row.fuel || row.accommodation || row.other));
  if (legacyRows.length) {
    paragraph('Historische Tageskosten: Für diese gespeicherten Summen fehlen vollständige Einzelangaben. Eine Belegzuordnung ist nicht rekonstruierbar; aktuelle Dateien wurden nicht ergänzt. Die Beträge werden nicht zusätzlich zur Erstattung addiert.', 9, navy);
    table(['Tag', 'Kraftstoff EUR', 'Übernachtung EUR', 'Sonstige EUR'], legacyRows.map(row => [date(row.date), euro(row.fuel), euro(row.accommodation), euro(row.other)]), [30, 48, 49, 49], [1, 2, 3]);
  }
  if (entries.every(entry => entry.expense.currency === 'EUR')) paragraph(`Zur Information: vom Unternehmen bezahlt ${euro(data.totals.companyPaid)} · privat vorgestreckt ${euro(data.totals.privatelyAdvanced)} · als erstattet erfasste Kosten ${euro(data.totals.reimbursed)}. Diese Angaben werden nicht nochmals zum Erstattungsbetrag addiert.`, 8.5);
  else paragraph('Fremdwährungen sind als Originalbeträge ausgewiesen. Die persönliche Erstattung stammt unverändert aus dem gespeicherten EUR-Rechenstand. Originalbeträge unterschiedlicher Währungen werden hier nicht zu einer gemeinsamen Bruttosumme addiert.', 8.5);

  newPage('4 · Belegverzeichnis');
  paragraph('Die Anlagen folgen in genau dieser Reihenfolge. Fehlende Dateien sind sichtbar gekennzeichnet; es werden keine Ersatzbelege erzeugt.');
  const pageCells: { entry: string; page: number; x: number; y: number }[] = [];
  table(['Beleg', 'Datum', 'Datei / Ablagehinweis', 'Anlage (Seite)'], entries.map(entry => [entry.number, day(entry.expense.date), clean([entry.expense.receipt?.name || 'Keine Datei gespeichert', status(entry), entry.expense.receipt && plans.get(entry.number)?.type === 'text' && `Original im separaten ZIP-Export: ${entry.archivePath}`].filter(Boolean).join('\n')), '']), [28, 18, 97, 33], [], undefined,
    (row, x, cellY, page) => pageCells.push({ entry: entries[row].number, page, x, y: cellY }));
  if (!entries.length) paragraph('Keine Belegdateien in diesem Stand gespeichert.');
  const ranges = new Map<string, { first: number; last: number }>();
  for (const entry of entries) {
    if (!entry.expense.receipt) continue;
    const plan = plans.get(entry.number)!;
    const parts = plan.type === 'pdf' ? plan.pages : plan.type === 'image' ? plan.parts : 1;
    const first = doc.getNumberOfPages() + 1;
    for (let part = 0; part < parts; part++) {
      newPage(`Beleg ${entry.number}${parts > 1 ? ` · Teil ${part + 1} / ${parts}` : ''}`);
      paragraph(`${date(entry.expense.date)} · ${entry.expense.category} · ${entry.expense.gross.toLocaleString('de-DE', { minimumFractionDigits: 2 })} ${entry.expense.currency}`, 9, navy);
      const filename = entry.expense.receipt.name.replace(/\s+/g, " ");
      paragraph(filename.length > 130 ? filename.slice(0, 127) + "..." : filename, 8);
      const bodyY = Math.max(y + 2, 49), height = BOTTOM - bodyY;
      if (plan.type === 'image') {
        const viewport = 210;
        doc.saveGraphicsState(); doc.rect(M, bodyY, W, viewport, null).clip().discardPath();
        doc.addImage(plan.data, plan.format, M + (W - plan.width) / 2, bodyY - part * (viewport - 8), plan.width, plan.height, entry.number, 'FAST');
        doc.restoreGraphicsState();
      } else if (plan.type === 'pdf') placements.push({ page: doc.getCurrentPageInfo().pageNumber, sourcePage: part, entry: entry.number, y: bodyY, height });
      else { y = bodyY + 8; paragraph(plan.message, 11, navy); paragraph(`Belegnummer: ${entry.number}. Die Originaldatei ist nicht Bestandteil dieser PDF. Im ZIP-Export liegt sie unter ${entry.archivePath}. Bitte bei der Abgabe ergänzen.`, 9); }
    }
    ranges.set(entry.number, { first, last: doc.getNumberOfPages() });
  }
  for (const cell of pageCells) {
    doc.setPage(cell.page); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.3); doc.setTextColor(...navy);
    const range = ranges.get(cell.entry); const text = range ? range.first === range.last ? `Seite ${range.first}` : `Seiten ${range.first}–${range.last}` : 'Fehlt';
    doc.text(text, cell.x + 2.4, cell.y + 5.3);
    if (range) doc.link(cell.x, cell.y, 33, 8, { pageNumber: range.first });
  }
  const total = doc.getNumberOfPages();
  for (let page = 1; page <= total; page++) {
    doc.setPage(page); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...muted);
    doc.text(doc.splitTextToSize(clean(number), 85)[0], M, 12); doc.text(clean(`${month} · ${sections.get(page) || 'Abrechnung'}`), 193, 12, { align: 'right' });
    doc.setDrawColor(220, 232, 245); doc.line(M, 17, 193, 17); doc.line(M, 281, 193, 281);
    doc.text(doc.splitTextToSize(clean(`${state.settings.profileName || 'Name nicht hinterlegt'} · ${data.month}`), 138)[0], M, 287);
    doc.text(`Seite ${page} / ${total}`, 193, 287, { align: 'right' });
    doc.setFontSize(7); doc.setTextColor(...brand); doc.text(pdfCompanyName, M, 292);
    doc.setFontSize(6.5); doc.text('Spektron · SpesenKit', 193, 292, { align: 'right' });
  }
  return { doc, placements };
}

/** Synchroner Dokumentaufbau für bestehende Aufrufer; die Datei-Exporte ergänzen Original-PDF-Seiten. */
export function buildStatementPdf(data: StatementData, state: AppState, number: string, context?: StatementExportContext) {
  const doc = render(data, state, number, context).doc;
  for (let page = 1; page <= doc.getNumberOfPages(); page++) {
    doc.setPage(page); doc.saveGraphicsState();
    doc.setGState(new GState({ opacity: .045 }));
    doc.addImage(companyLogo, 'PNG', 35, 86, 140, 140 * 462 / 517, 'Firmenlogo', 'FAST');
    doc.restoreGraphicsState();
  }
  return doc;
}

/** Original-PDFs werden als Seiteninhalt eingebettet; Berechnung und Zustände werden nie verändert. */
export async function statementPdfBytes(data: StatementData, state: AppState, number: string, context?: StatementExportContext, print = false): Promise<Uint8Array> {
  const { PDFDocument, degrees } = await import('pdf-lib');
  const native = new Map<string, NativePdf>(), failed = new Set<string>();
  for (const entry of receiptIndex(data, state)) if (entry.expense.receipt && fileMime(entry) === 'application/pdf') {
    try {
      const source = await PDFDocument.load(pdfBytes(entry.expense.receipt.dataUrl), { updateMetadata: false });
      const pages = source.getPages(); if (!pages.length) throw Error('Keine PDF-Seiten');
      // Seiteninhalt allein enthält keine Widget-/Kommentar-Erscheinungsbilder. Keine unvollständige Kopie ausgeben.
      if (pages.some(page => (page.node.Annots()?.size() || 0) > 0)) throw Error('PDF mit Anmerkungen oder Formularfeldern');
      native.set(entry.number, { source, pages });
    } catch { failed.add(entry.number); }
  }
  // Falls eine gültig geladene PDF nicht eingebettet werden kann, neu setzen: Verzeichnis und Seitenzahlen bleiben wahr.
  for (;;) {
    const { doc, placements } = render(data, state, number, context, native, failed);
    if (print) doc.autoPrint();
    const target = await PDFDocument.load(doc.output('arraybuffer'));
    let retry = false;
    for (const placement of placements) {
      try {
        const sourcePage = native.get(placement.entry)!.pages[placement.sourcePage];
        const box = sourcePage.getCropBox();
        const embedded = await target.embedPage(sourcePage, { left: box.x, bottom: box.y, right: box.x + box.width, top: box.y + box.height });
        await embedded.embed();
        const rotation = ((sourcePage.getRotation().angle % 360) + 360) % 360;
        if (![0, 90, 180, 270].includes(rotation)) throw Error('Unbekannte Seitendrehung');
        const rotated = rotation === 90 || rotation === 270;
        const factor = 72 / 25.4, width = rotated ? embedded.height : embedded.width, height = rotated ? embedded.width : embedded.height;
        const scale = Math.min(W * factor / width, placement.height * factor / height);
        const dw = width * scale, dh = height * scale;
        const left = M * factor + (W * factor - dw) / 2;
        const bottom = (297 - placement.y - placement.height) * factor + (placement.height * factor - dh) / 2;
        target.getPage(placement.page - 1).drawPage(embedded, { x: left + (rotation === 180 || rotation === 270 ? dw : 0), y: bottom + (rotation === 90 || rotation === 180 ? dh : 0), width: embedded.width * scale, height: embedded.height * scale, rotate: degrees(-rotation) });
      } catch {
        native.delete(placement.entry); failed.add(placement.entry); retry = true; break;
      }
    }
    if (!retry) {
      // Nach dem Einbetten auch auf Originalanlagen sichtbar, ohne deren Text zu verdecken.
      // Das transparente Original wird einmal eingebettet und auf allen Seiten wiederverwendet.
      const watermark = await target.embedPng(pdfBytes(companyLogo));
      const width = 140 * 72 / 25.4, height = width * watermark.height / watermark.width;
      for (const page of target.getPages()) page.drawImage(watermark, {
        x: (page.getWidth() - width) / 2, y: page.getHeight() - 86 * 72 / 25.4 - height,
        width, height, opacity: .045,
      });
      return target.save({ useObjectStreams: false });
    }
  }
}
