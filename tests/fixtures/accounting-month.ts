import { jsPDF } from 'jspdf';
import { emptyState } from '../../lib/config';
import { buildStatement } from '../../lib/calculations';
import type { AppState, Expense, Receipt, StatementSnapshot, Trip } from '../../lib/types';
import { sampleReceiptImages } from './pdf-receipts';

export function accountingMonth() {
  const state: AppState = structuredClone(emptyState);
  Object.assign(state.settings, { profileName: 'Mara Beispiel', employeeNumber: 'MA-017', company: 'Nordlicht Bauanalyse GmbH (Muster)', department: 'Sachverständigenwesen', costCenter: 'SV-02' });
  const trip = (id: string, date: string, start: string, end: string, destination: string, km: number, extra: Partial<Trip> = {}): Trip => ({
    id, date, endDate: date, startTime: start, endTime: end, startPlace: 'Beispielstadt', destination,
    purpose: 'Ortstermin und Dokumentation', customer: 'Musterauftrag', order: '26.0901 Musterobjekt', costCenter: 'SV-02',
    plate: 'MS-MB 123', vehicle: 'Privatwagen Beispiel', vehicleId: 'vehicle-private-default', vehicleType: 'privatfahrzeug',
    businessKm: km, privateKm: 0, tripType: 'dienstlich', notes: '', overnight: false, absenceConfirmed: true,
    meals: { breakfast: false, lunch: false, dinner: false }, dailyMeals: {}, status: 'geprüft', sourceHash: id,
    importedAt: '2026-09-30T12:00:00Z', warnings: [], ...extra,
  });
  state.trips = [
    trip('reise-01', '2026-09-02', '08:00', '17:00', 'Bonn', 120),
    trip('reise-02', '2026-09-04', '08:00', '16:00', 'Köln', 64),
    trip('reise-03', '2026-09-09', '08:00', '17:00', 'Hannover', 420, { endDate: '2026-09-11', overnight: true,
      purpose: 'Mehrtageseinsatz: Aufnahme, Probenahme und Abstimmung', dailyMeals: {
        '2026-09-10': { breakfast: true, lunch: false, dinner: false }, '2026-09-11': { breakfast: true, lunch: false, dinner: false },
      } }),
    trip('reise-04', '2026-09-16', '07:30', '16:30', 'Aachen', 88, { meals: { breakfast: false, lunch: true, dinner: false } }),
    trip('reise-05', '2026-09-23', '07:00', '18:00', 'Essen', 184, { vehicleId: 'vehicle-company-default', vehicleType: 'firmenfahrzeug', vehicle: 'Dienstwagen Beispiel', plate: 'MS-NB 456' }),
    trip('reise-06', '2026-09-28', '08:00', '17:00', 'Düsseldorf', 96),
  ];
  const receipt = (id: string, name: string, type: string, dataUrl: string): Receipt => ({ id, name, type, dataUrl, size: Math.floor(dataUrl.split(',')[1].length * .75), hash: `synthetic-${id}` });
  const hotel = new jsPDF(); hotel.setFontSize(20); hotel.text('MUSTERRECHNUNG · Hotel Am Beispielpark', 18, 25);
  hotel.setFontSize(11); hotel.text(['An: Mara Beispiel / Nordlicht Bauanalyse GmbH', 'Aufenthalt: 09.09.2026 bis 11.09.2026', 'Rechnung: HOTEL-MUSTER-0909', '',
    '2 Übernachtungen inkl. Service: 264,00 EUR', '2 Frühstücke: 24,00 EUR', 'Tagungsraum / Service: 24,00 EUR', '', 'Rechnungsbetrag: 312,00 EUR', 'Bezahlt mit Firmenkarte.', '', 'Erfundene Daten. Keine echte Rechnung.'], 18, 45);
  hotel.addPage(); hotel.setFontSize(19); hotel.text('Leistungsnachweis · Originalseite 2', 18, 25);
  hotel.setFontSize(11); hotel.text(['HOTEL-MUSTER-0909 · Anlage zur Musterrechnung', '', '09.09.2026: Anreise und Übernachtung.', '10.09.2026: Frühstück, Besprechung, Übernachtung.', '11.09.2026: Frühstück und Abreise.', '', 'Diese Anlage erläutert die Rechnung; kein zusätzlicher Betrag.', 'Gesamtbetrag der Rechnung unverändert: 312,00 EUR.', '', 'Ausschließlich erfundene Daten.'], 18, 45);
  const ticket = new jsPDF({ orientation: 'landscape', format: [210, 99] });
  ticket.setFontSize(19); ticket.text('MUSTER · Tageskarte Stadtverkehr', 12, 18); ticket.setFontSize(12);
  ticket.text(['23.09.2026 · Beispiel-Verkehrsbetriebe', 'Mara Beispiel · Tarifgebiet Musterstadt', 'Preis: 19,90 EUR · Privat bezahlt', 'Fiktiver Fahrschein. Nicht zur Fahrt verwendbar.'], 12, 34);
  const expense = (id: string, date: string, category: string, gross: number, tripId: string, rec: Receipt, extra: Partial<Expense> = {}): Expense => ({
    id, date, category, description: category, gross, net: gross, vatRate: 0, vat: 0, currency: 'EUR', exchangeRate: 1,
    paymentType: 'privat vorgestreckt', paidBy: 'Reisender', reimbursementStatus: 'offen', businessShare: 100,
    projectNumber: '26.0901', tripId, notes: 'Erfundener Geschäftsvorfall für die Musterabrechnung.', receipt: rec,
    status: 'geprüft', warnings: [], ...extra,
  });
  state.expenses = [
    expense('kosten-01', '2026-09-02', 'Parken', 12.5, 'reise-01', receipt('beleg-01', 'Parkhaus_02-09.png', 'image/png', sampleReceiptImages.parking), { description: 'Parkhaus Am Stadtgarten', merchant: 'Parkhaus Am Stadtgarten' }),
    expense('kosten-02', '2026-09-09', 'Hotel', 312, 'reise-03', receipt('beleg-02', 'Hotelrechnung_09-11-09.pdf', 'application/pdf', hotel.output('datauristring')), { description: 'Zwei Übernachtungen mit Frühstück', merchant: 'Hotel Am Beispielpark', invoiceNumber: 'HOTEL-MUSTER-0909', paymentType: 'Firmenkarte', paidBy: 'Unternehmen', stayStart: '2026-09-09', stayEnd: '2026-09-11', breakfastIncluded: 'yes' }),
    expense('kosten-03', '2026-09-10', 'sonstige Nebenkosten', 46.8, 'reise-03', receipt('beleg-03', 'Kopien_Kassenbon.png', 'image/png', sampleReceiptImages.copies), { description: 'Plan- und Dokumentenkopien', merchant: 'Bürobedarf Beispiel' }),
    expense('kosten-04', '2026-09-16', 'Taxi', 24.6, 'reise-04', receipt('beleg-04', 'Taxibeleg_16-09.jpg', 'image/jpeg', sampleReceiptImages.taxi), { description: 'Fahrt zum Einsatzort', merchant: 'Taxi Beispielstadt', reimbursementStatus: 'erstattet' }),
    expense('kosten-05', '2026-09-23', 'sonstige Nebenkosten', 19.9, 'reise-05', receipt('beleg-05', 'Tageskarte_Stadtverkehr.pdf', 'application/pdf', ticket.output('datauristring')), { description: 'ÖPNV-Tageskarte vor Ort', merchant: 'Beispiel-Verkehrsbetriebe' }),
    expense('kosten-06', '2026-09-28', 'Parken', 8, 'reise-06', receipt('beleg-06', 'Parkhaus_28-09.png', 'image/png', sampleReceiptImages.parking2), { description: 'Tageskarte Parkhaus West', merchant: 'Parkhaus West' }),
  ];
  const data = buildStatement(state, '2026-09');
  const snapshot: StatementSnapshot = { id: 'muster-september-v1', month: data.month, number: 'RK-202609-MUSTER-017', version: 1, locked: true, status: 'freigegeben', createdAt: '2026-10-01T08:00:00Z',
    data: structuredClone(data), settingsSnapshot: structuredClone(state.settings), expensesSnapshot: structuredClone(state.expenses), relatedTripsSnapshot: [] };
  state.statements = [snapshot];
  return { state, data, snapshot };
}
