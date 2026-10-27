import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { datumDe, euroAusCent, monatName, monatsblatt, type KasseRecord } from './buerokasse';
import { pdfCompanyName } from './pdf-statement';

/*
 * Kassenbuch eines Monats als PDF: Übersicht, alle Buchungen mit laufendem Bestand, Zählungen, Abschluss –
 * danach je Ausgabe das Belegbild (Belegnummer oben). Nur aus den gespeicherten Datensätzen; nichts wird neu berechnet
 * außer Summen und Bestand aus den Buchungen.
 */
const M = 15, W = 180;
const navy: [number, number, number] = [33, 48, 62];
const brand: [number, number, number] = [53, 109, 168];
const muted: [number, number, number] = [98, 120, 143];
const clean = (value: unknown) => String(value ?? '').replace(/[  ]/g, ' ').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
const euro = (cent: number) => clean(euroAusCent(cent));

export async function kassenbuchPdf(records: KasseRecord[], monat: string, beleg: (fileId: string) => Promise<string>, app = ''): Promise<Blob> {
  const blatt = monatsblatt(records, monat);
  const byId = new Map(records.map((r) => [r.id, r]));
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  doc.setProperties({ title: `Kassenbuch Bürokasse ${monat}`, author: pdfCompanyName, creator: 'SpesenKit' });
  let y = 20;
  doc.setTextColor(...navy); doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.text('Kassenbuch Bürokasse', M, y); y += 8;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(12); doc.text(clean(`${pdfCompanyName} · ${monatName(monat)}`), M, y); y += 6;
  doc.setFontSize(9); doc.setTextColor(...muted);
  doc.text(clean(blatt.abschluss ? `Monat abgeschlossen am ${datumDe(blatt.abschluss.datum)}` : 'Monat noch nicht abgeschlossen – Zwischenstand'), M, y); y += 8;
  autoTable(doc, {
    startY: y, theme: 'plain', margin: { left: M, right: M },
    styles: { font: 'helvetica', fontSize: 10, textColor: navy, cellPadding: 1.6 },
    columnStyles: { 0: { cellWidth: 70 }, 1: { cellWidth: 40, halign: 'right' } },
    body: [['Anfangsbestand', euro(blatt.anfangsbestand)], ['+ Einnahmen', euro(blatt.einnahmen)], ['- Ausgaben', euro(blatt.ausgaben)],
      [{ content: 'Endbestand', styles: { fontStyle: 'bold' } }, { content: euro(blatt.endbestand), styles: { fontStyle: 'bold' } }]],
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
  const anhang: KasseRecord[] = [];
  autoTable(doc, {
    startY: y, theme: 'striped', showHead: 'everyPage', rowPageBreak: 'avoid', margin: { left: M, right: M, bottom: 18 },
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 1.8, overflow: 'linebreak', valign: 'top', textColor: navy, lineColor: [225, 230, 235] },
    headStyles: { fillColor: brand, textColor: [255, 255, 255] },
    alternateRowStyles: { fillColor: [244, 249, 254] },
    columnStyles: { 0: { cellWidth: 19 }, 1: { cellWidth: 20 }, 2: { cellWidth: 64 }, 3: { cellWidth: 11, halign: 'right' }, 4: { cellWidth: 21, halign: 'right' }, 5: { cellWidth: 21, halign: 'right' }, 6: { cellWidth: 24, halign: 'right' } },
    head: [['Nr', 'Datum', 'Kategorie / Text / Beleg', 'MwSt', 'Einnahme', 'Ausgabe', 'Bestand']],
    body: blatt.zeilen.map(({ record: r, wirkung, bestand, storniert }) => {
      if (r.beleg) anhang.push(r);
      const teile = [r.art === 'anfangsbestand' ? 'Anfangsbestand' : r.kategorie, r.text, r.haendler, r.rechnungsnr && `Rechnung ${r.rechnungsnr}`,
        r.beleg ? 'Beleg: Bild im Anhang' : r.eigenbeleg ? 'Eigenbeleg (kein Originalbeleg)' : '',
        r.art === 'storno' ? `Storno von ${byId.get(r.bezug!)?.nr || '?'} – Grund: ${r.grund}` : '', storniert ? 'STORNIERT (siehe Gegenbuchung)' : ''];
      return [r.nr || '', datumDe(r.datum), clean(teile.filter(Boolean).join('\n')), r.art === 'ausgabe' ? `${r.mwst ?? ''} %` : '',
        wirkung > 0 && r.art !== 'anfangsbestand' ? euro(wirkung) : '', wirkung < 0 ? euro(-wirkung) : '', euro(bestand)];
    }),
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
  if (!blatt.zeilen.length) { doc.setFontSize(9); doc.setTextColor(...muted); doc.text('Keine Buchungen in diesem Monat.', M, y); y += 6; }
  doc.setFontSize(9); doc.setTextColor(...navy);
  for (const z of blatt.zaehlungen) {
    if (y > 270) { doc.addPage(); y = 20; }
    doc.text(clean(`Kassensturz ${datumDe(z.datum)}: gezählt ${euro(z.ist!)}, laut Kassenbuch ${euro(z.soll!)}${z.ist !== z.soll ? ` – Differenz ${euro(z.ist! - z.soll!)}` : ' – stimmt'}`), M, y); y += 5;
  }
  if (y > 255) { doc.addPage(); y = 20; }
  y += 8; doc.setTextColor(...muted); doc.setFontSize(8.5);
  doc.text('Kassenführung: ______________________     Geprüft: ______________________', M, y);

  // Anhang: Belegbilder (JPEG/PNG); andere Formate werden nur genannt.
  for (const r of anhang) {
    doc.addPage();
    doc.setTextColor(...navy); doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
    doc.text(clean(`Beleg ${r.nr} · ${datumDe(r.datum)} · ${euro(r.cent || 0)}`), M, 18);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...muted);
    doc.text(clean([r.kategorie, r.text, r.haendler].filter(Boolean).join(' · ')).slice(0, 120), M, 24);
    const dataUrl = await beleg(r.beleg!.fileId).catch(() => '');
    const format = /^data:image\/png/i.test(dataUrl) ? 'PNG' : /^data:image\/jpe?g/i.test(dataUrl) ? 'JPEG' : '';
    if (!format) { doc.text(dataUrl ? 'Dieses Belegformat kann nicht eingebettet werden – Originaldatei im Ordner „Belege“.' : 'Belegbild auf diesem Gerät nicht vorhanden – Originaldatei im Ordner „Belege“.', M, 34); continue; }
    try {
      const image = doc.getImageProperties(dataUrl);
      const scale = Math.min(W / image.width, 250 / image.height);
      doc.addImage(dataUrl, format, M + (W - image.width * scale) / 2, 30, image.width * scale, image.height * scale, undefined, 'FAST');
    } catch { doc.text('Das Belegbild ist nicht lesbar.', M, 34); }
  }
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page); doc.setFontSize(7.5); doc.setTextColor(...muted);
    doc.text(clean(`Kassenbuch ${monatName(monat)} · Seite ${page} von ${pages}${app ? ` · SpesenKit ${app}` : ''}`), M, 290);
  }
  return doc.output('blob');
}
