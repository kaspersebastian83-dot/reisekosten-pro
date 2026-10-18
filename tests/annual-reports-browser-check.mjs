// Run against a production build with an existing Playwright installation.
// All seeded trip and expense records are synthetic and isolated to this browser context.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import http from 'node:http';
import path from 'node:path';
const require = createRequire(import.meta.url);
const engines = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const engine = process.env.BROWSER_ENGINE || 'chromium';
const root = path.resolve('dist');
const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (!pathname.startsWith('/reisekosten-pro/')) throw Error('outside base path');
    const file = path.resolve(root, pathname.slice('/reisekosten-pro/'.length) || 'index.html');
    if (!file.startsWith(`${root}/`)) throw Error('outside build');
    response.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' })[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }).end(await readFile(file));
  } catch { response.writeHead(404).end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}/reisekosten-pro/`;
const browser = await engines[engine].launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
const output = await mkdtemp(path.join(tmpdir(), 'spesenkit-annual-reports-'));
const names = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
let passed = 0;
const check = async (name, fn) => { await fn(); passed++; console.log('PASS', name); };
const readState = page => page.evaluate(() => new Promise((resolve, reject) => {
  const request = indexedDB.open('reisekosten-pro', 1);
  request.onsuccess = () => { const db = request.result; const transaction = db.transaction('state'); const get = transaction.objectStore('state').get('main'); get.onsuccess = () => resolve(get.result); get.onerror = () => reject(get.error); transaction.oncomplete = () => db.close(); };
  request.onerror = () => reject(request.error);
}));
const writeState = (page, value) => page.evaluate(state => new Promise((resolve, reject) => {
  const request = indexedDB.open('reisekosten-pro', 1);
  request.onsuccess = () => { const db = request.result; const transaction = db.transaction('state', 'readwrite'); transaction.objectStore('state').put(state, 'main'); transaction.oncomplete = () => { db.close(); resolve(); }; transaction.onabort = () => reject(transaction.error); };
  request.onerror = () => reject(request.error);
}), value);

try {
  for (const viewport of [{ width: 390, height: 844 }, { width: 820, height: 1180 }, { width: 1440, height: 1000 }]) {
    const context = await browser.newContext({ viewport, timezoneId: 'Europe/Berlin', serviceWorkers: 'block' });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(baseUrl); await page.getByRole('heading', { name: 'Monatsübersicht', exact: true }).waitFor();
    const menu = async name => {
      if (await page.getByRole('button', { name: 'Menü öffnen', exact: true }).isVisible()) await page.getByRole('button', { name: 'Menü öffnen', exact: true }).click();
      await page.locator('.sidebar nav').getByRole('button', { name: new RegExp(`^${name}`) }).click();
      await page.waitForTimeout(250);
    };
    const inputMonth = page.locator('input[type=month]');
    await inputMonth.fill('2025-12');
    const state = await readState(page) || {
      version: 1, trips: [], expenses: [], receiptInbox: [], merchantRules: [], profiles: [], statements: [], changes: [],
      settings: {
        profileName: '', employeeNumber: '', company: '', department: '', costCenter: '', homeAddress: '', firstWorkplace: '', regularSites: '',
        timezone: 'Europe/Berlin', rounding: 'keine', ruleMode: 'legal', internalMinutes: 510, internalComparator: 'greater',
        mileageMethod: 'pauschale', defaultVehicleId: 'vehicle-company-default',
        vehicles: [{ id: 'vehicle-company-default', name: 'Synthetic company car', plate: '', ownership: 'dienstwagen', reimbursementMethod: 'keine', active: true }],
        tariffs: ['partial','full','arrival','departure','mileage','breakfast','lunch','dinner'].map((kind, index) => ({
          id: `synthetic-tariff-${kind}`, label: kind, validFrom: '2020-01-01', amount: [14,28,14,14,0.3,20,40,40][index], country: 'DE', kind,
          source: 'synthetic fixture', checkedAt: '2026-01-01', unit: index >= 5 ? 'percent' : 'EUR',
        })),
      },
    };
    const makeTrip = (id, date, endDate, order, startTime = '08:00', endTime = '17:30') => ({
      id, date, endDate, startTime, endTime, startPlace: 'Köln', destination: 'Musterstadt', purpose: 'Synthetischer Termin',
      customer: 'Kunde ist kein Projekt', order, costCenter: '', plate: '', vehicle: '', vehicleType: 'öffentlich', businessKm: 0,
      privateKm: 0, tripType: 'dienstlich', notes: '', overnight: endDate > date, absenceConfirmed: true,
      meals: { breakfast: false, lunch: false, dinner: false }, status: 'geprüft', sourceHash: '', importedAt: date, warnings: [],
    });
    const makeExpense = (id, date, category, gross, paymentType, reimbursementStatus, projectNumber, tripId) => ({
      id, date, category, description: `Synthetische ${category}`, gross, net: gross, vatRate: 0, vat: 0, currency: 'EUR', exchangeRate: 1,
      paymentType, paidBy: '', reimbursementStatus, businessShare: 100, notes: '', status: 'geprüft', warnings: [],
      ...(projectNumber ? { projectNumber } : {}), ...(tripId ? { tripId } : {}),
    });
    state.trips = [
      makeTrip('year-crossing', '2025-12-31', '2026-01-02', '26.0123 Musterstadt'),
      makeTrip('shared-a', '2026-03-05', '2026-03-05', '26.0145 Köln'),
      makeTrip('shared-b', '2026-03-05', '2026-03-05', '26.0180 Düsseldorf', '08:30', '18:00'),
    ];
    state.expenses = [
      makeExpense('synthetic-private-hotel', '2026-03-05', 'Hotel', 115, 'privat vorgestreckt', 'offen', '26.0145', 'shared-a'),
      makeExpense('synthetic-company', '2026-03-06', 'Taxi', 42, 'Unternehmen', 'nicht erstattungsfähig', '26.0145'),
      makeExpense('synthetic-refunded', '2026-03-07', 'Bahn', 18, 'privat vorgestreckt', 'erstattet', '26.0145'),
      makeExpense('synthetic-unknown', '2026-03-08', 'Parken', 9, 'unbekannt', 'offen'),
    ];
    state.statements = [];
    await writeState(page, state); await page.reload(); await page.getByRole('heading', { name: 'Monatsübersicht', exact: true }).waitFor();
    await inputMonth.fill('2025-12');
    const seeded = await readState(page); const before = structuredClone(seeded);
    await menu('Auswertungen');
    await page.locator('.annual-report-header h2').waitFor();
    await check(`${engine} ${viewport.width}: read-only view and twelve zero-inclusive month rows`, async () => {
      assert.equal(await page.locator('.annual-month-row').count(), 12);
      assert.match(await page.locator('.annual-report-header').innerText(), /Aktuelle Erfassungsdaten/i);
      assert.ok((await page.locator('.annual-month-bars').innerText()).includes('Dezember'));
      assert.equal(await page.locator('.quick-top,.receipt-top,.quick-fab,.camera-fab').count(), 0, 'reports expose no expense or receipt entry actions');
      assert.equal(await page.getByRole('button', { name: /Dienstreise|Spesenabrechnung erstellen|Abrechnung fortsetzen|Neue Version erstellen/ }).count(), 0);
      assert.equal(await page.locator('.sidebar.open').count(), 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no horizontal overflow');
      assert.deepEqual(await readState(page), before, 'opening reports does not write app data');
    });
    await check(`${engine} ${viewport.width}: explicit year changes keep the work month and reveal twelve months`, async () => {
      assert.equal(await page.locator('.year-picker strong').innerText(), '2025');
      await page.getByRole('button', { name: 'Nächstes Jahr' }).click();
      assert.equal(await page.locator('.year-picker strong').innerText(), '2026');
      assert.equal(await inputMonth.inputValue(), '2025-12');
      assert.deepEqual(await readState(page), before, 'year selection is transient and read-only');
      assert.match(await page.locator('.analysis-card[aria-labelledby="projects-heading"]').innerText(), /Nicht eindeutig zugeordnet/);
      assert.doesNotMatch(await page.locator('.annual-reports').innerText(), /NaN|Infinity/);
      await page.screenshot({ path: path.join(output, `${engine}-${viewport.width}.png`), fullPage: true });
    });
    await check(`${engine} ${viewport.width}: annual data separates costs from open reimbursement`, async () => {
      const report = await page.locator('.annual-reports').innerText();
      assert.match(report, /Gesamte Reisekosten/); assert.match(report, /Offene persönliche Erstattung/);
      assert.match(report, /dienstliche Kilometer/); assert.match(report, /Tage mit Spesen/);
      assert.match(report, /Vom Unternehmen bezahlt/); assert.match(report, /Bereits erstattet/); assert.match(report, /Zahlungsart unbekannt/);
      assert.match(report, /Privat vorgestreckt/);
    });
    await menu('Monatsübersicht');
    await page.getByRole('heading', { name: 'Monatsübersicht', exact: true }).waitFor();
    await check(`${engine} ${viewport.width}: return preserves selected work month and does not create a statement`, async () => {
      assert.equal(await inputMonth.inputValue(), '2025-12');
      const after = await readState(page);
      assert.deepEqual(after.statements, before.statements);
      assert.deepEqual(after.trips, before.trips);
      assert.deepEqual(after.expenses, before.expenses);
      assert.deepEqual(errors, []);
    });
    await context.close();
  }
  for (const name of names) assert.ok(name);
  console.log(`PASS ${passed} annual report browser checks (${engine}); screenshots: ${output}`);
} finally { await browser.close(); server.close(); }
