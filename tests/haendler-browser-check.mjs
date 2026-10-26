// Wiederkehrende Händler im echten Browser: Auswahlliste (häufigste zuerst), Kategorie/Steuersatz aus der gelernten
// Regel, selbst gewählte Kategorie bleibt, neuer Händler wird gelernt. Rein synthetische Daten.
// npm run build && node tests/haendler-browser-check.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
const require = createRequire(import.meta.url);
const engines = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve('dist');
const server = http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (!pathname.startsWith('/reisekosten-pro/')) throw Error();
    const file = path.resolve(root, pathname.slice('/reisekosten-pro/'.length) || 'index.html');
    if (!file.startsWith(root + '/')) throw Error();
    res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' })[path.extname(file)] || 'application/octet-stream' });
    res.end(await readFile(file));
  } catch { res.writeHead(404).end('Not found'); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/reisekosten-pro/`;
const browser = await engines.chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
/** Gespeicherter Bestand (Händler und Regeln; Belegbilder spielen hier keine Rolle). */
const storedState = (page) => page.evaluate(() => new Promise((resolve, reject) => { const r = indexedDB.open('reisekosten-pro', 1); r.onsuccess = () => { const g = r.result.transaction('state').objectStore('state').get('main'); g.onsuccess = () => { r.result.close(); resolve(g.result); }; g.onerror = () => reject(g.error); }; r.onerror = () => reject(r.error); }));
const check = async (name, fn) => { await fn(); console.log('PASS', name); };
const until = async (fn, what) => { for (let i = 0; i < 100; i++) { const value = await fn(); if (value) return value; await new Promise((r) => setTimeout(r, 100)); } throw Error(`Zeitüberschreitung: ${what}`); };
const writeIdb = (page, value) => page.evaluate((value) => new Promise((resolve, reject) => { const r = indexedDB.open('reisekosten-pro', 1); r.onsuccess = () => { const tx = r.result.transaction('state', 'readwrite'); tx.objectStore('state').put(value, 'main'); tx.oncomplete = () => { r.result.close(); resolve(); }; tx.onerror = () => reject(tx.error); }; }), value);

try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport, timezoneId: 'Europe/Berlin' });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.clock.setFixedTime(new Date('2026-10-18T10:00:00Z'));
    await page.goto(url); await page.getByRole('heading', { name: 'Monatsübersicht', exact: true }).waitFor();
    const nav = async (name) => { if (await page.getByRole('button', { name: 'Menü öffnen', exact: true }).isVisible()) await page.getByRole('button', { name: 'Menü öffnen', exact: true }).click(); await page.locator('.sidebar nav').getByRole('button', { name: new RegExp('^' + name) }).click(); };
    await nav('Datensicherung'); await page.getByRole('button', { name: 'Demo-Daten laden', exact: true }).click();
    const seed = await until(async () => { const s = await storedState(page); return s?.expenses?.length ? s : null; }, 'Demo-Daten');
    const base = seed.expenses[0];
    const add = (id, merchant, category, date) => ({ ...structuredClone(base), id, merchant, category, date, tripId: undefined, noTrip: true, receipt: undefined, description: `${merchant} synthetisch`, status: 'vollständig', warnings: [] });
    seed.expenses.push(add('m1', 'Aral', 'Tanken', '2026-09-03'), add('m2', 'Aral', 'Tanken', '2026-09-10'), add('m3', 'ARAL', 'Tanken', '2026-09-17'), add('m4', 'Bäckerei Müller', 'sonstige Nebenkosten', '2026-09-20'));
    seed.merchantRules = [{ id: 'r-aral', merchantPattern: 'aral', category: 'Tanken', paymentType: 'privat vorgestreckt', vatRate: 19, uses: 3, updatedAt: '2026-09-17T10:00:00Z' },
      { id: 'r-mueller', merchantPattern: 'bäckerei müller', category: 'sonstige Nebenkosten', paymentType: 'privat vorgestreckt', vatRate: 7, uses: 1, updatedAt: '2026-09-20T10:00:00Z' }];
    await writeIdb(page, seed); await page.reload(); await page.getByRole('heading', { name: 'Monatsübersicht', exact: true }).waitFor();
    const workspace = page.getByRole('region', { name: 'Monatsarbeitsbereich', exact: true });
    const editor = page.locator('.modal');
    const openCost = async () => {
      await page.locator('input[type=month]').fill('2026-10');
      await workspace.getByRole('button', { name: 'Sonstige Kosten erfassen', exact: true }).click(); await editor.waitFor();
      await editor.locator('.expense-more summary').click();
      return editor.getByLabel('Händler / Anbieter', { exact: true });
    };

    await check(`${viewport.width}: Auswahlliste der bekannten Händler, häufigste zuerst, gleiche Namen einmal`, async () => {
      const field = await openCost();
      const listId = await field.getAttribute('list');
      assert.ok(listId, 'Feld hat eine Auswahlliste');
      const options = await page.locator(`datalist[id="${listId}"] option`).evaluateAll((all) => all.map((o) => o.value));
      assert.deepEqual(options.slice(0, 2), ['Aral', 'Bäckerei Müller']);
      assert.equal(options.filter((o) => o.toLowerCase() === 'aral').length, 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'kein Überlauf');
    });

    await check(`${viewport.width}: bekannter Händler übernimmt Kategorie und Steuersatz der Regel; Speichern lernt mit`, async () => {
      const field = editor.getByLabel('Händler / Anbieter', { exact: true });
      await field.fill('Bäckerei Müller');
      assert.equal(await editor.getByLabel('Kategorie', { exact: true }).inputValue(), 'sonstige Nebenkosten');
      assert.equal(await editor.locator('label', { hasText: 'USt.-Satz' }).locator('select').inputValue(), '7');
      await editor.getByLabel('Datum', { exact: true }).fill('2026-10-05');
      await editor.getByLabel('Beschreibung', { exact: true }).fill('Brötchen Ortstermin');
      await editor.getByLabel('Brutto (€)', { exact: true }).fill('6.40');
      await editor.getByRole('button', { name: 'Speichern & fertig', exact: true }).click(); await editor.waitFor({ state: 'detached' });
      const s = await until(async () => { const v = await storedState(page); return v.expenses.some((e) => e.description === 'Brötchen Ortstermin') ? v : null; }, 'gespeichert');
      const saved = s.expenses.find((e) => e.description === 'Brötchen Ortstermin');
      assert.equal(saved.merchant, 'Bäckerei Müller'); assert.equal(saved.vatRate, 7); assert.equal(saved.net, 5.98);
      assert.equal(s.merchantRules.find((r) => r.merchantPattern === 'bäckerei müller').uses, 2);
    });

    await check(`${viewport.width}: selbst gewählte Kategorie bleibt; neuer Händler erscheint danach in der Liste`, async () => {
      const field = await openCost();
      await editor.getByLabel('Kategorie', { exact: true }).selectOption('Parken');
      await field.fill('Aral');
      assert.equal(await editor.getByLabel('Kategorie', { exact: true }).inputValue(), 'Parken', 'selbst gewählt bleibt');
      await field.fill('Shell Würselen');
      await editor.getByLabel('Datum', { exact: true }).fill('2026-10-06');
      await editor.getByLabel('Beschreibung', { exact: true }).fill('Parken Tankstelle');
      await editor.getByLabel('Brutto (€)', { exact: true }).fill('3');
      await editor.getByRole('button', { name: 'Speichern & fertig', exact: true }).click(); await editor.waitFor({ state: 'detached' });
      await until(async () => (await storedState(page)).merchantRules.some((r) => r.merchantPattern === 'shell würselen' && r.category === 'Parken'), 'Regel gelernt');
      const again = await openCost();
      const options = await page.locator(`datalist[id="${await again.getAttribute('list')}"] option`).evaluateAll((all) => all.map((o) => o.value));
      assert.ok(options.includes('Shell Würselen'));
      await editor.getByRole('button', { name: 'Abbrechen', exact: true }).click(); await editor.waitFor({ state: 'detached' });
    });

    await check(`${viewport.width}: Belegfoto-Eingang: Liste auch dort; zweiter gewählter Händler ersetzt die Vorgaben des ersten`, async () => {
      await context.route(/https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());   // Texterkennung offline: Eingabe von Hand
      await nav('Monatsübersicht');
      await page.locator('.month-entry-workspace').getByRole('button', { name: 'Beleg fotografieren / OCR', exact: true }).click();
      const png = Buffer.from(await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 20; c.height = 40; const g = c.getContext('2d'); g.fillStyle = 'white'; g.fillRect(0, 0, 20, 40); return c.toDataURL('image/png').split(',')[1]; }), 'base64');
      const capture = page.locator('.receipt-capture');
      await capture.locator('input[type=file]').first().setInputFiles({ name: 'synthetisch.png', mimeType: 'image/png', buffer: png });
      await page.getByText('Die automatische Erkennung war nicht möglich.', { exact: false }).waitFor({ timeout: 30000 });
      const field = capture.getByLabel('Händler', { exact: true });
      assert.ok((await page.locator(`datalist[id="${await field.getAttribute('list')}"] option`).evaluateAll((all) => all.map((o) => o.value))).includes('Aral'));
      await field.fill('Bäckerei Müller');
      assert.equal(await capture.getByLabel('Kategorie', { exact: true }).inputValue(), 'sonstige Nebenkosten');
      await field.fill('Aral');
      assert.equal(await capture.getByLabel('Kategorie', { exact: true }).inputValue(), 'Tanken', 'Vorgabe des ersten Händlers gilt nicht als eigene Eingabe');
      await capture.getByLabel('Kategorie', { exact: true }).selectOption('Parken');
      await field.fill('Bäckerei Müller');
      assert.equal(await capture.getByLabel('Kategorie', { exact: true }).inputValue(), 'Parken', 'selbst gewählte Kategorie bleibt');
      await context.unroute(/https?:\/\/(?!127\.0\.0\.1)/);
    });
    // Die absichtlich blockierte Texterkennung (offline) meldet sich als Seitenfehler – nur diesen ausnehmen.
    assert.deepEqual(errors.filter((e) => !/importScripts.*tesseract/.test(e)), []);
    await context.close();
  }
} finally { await browser.close(); server.close(); }
console.log('OK Händler: Auswahlliste, Regel übernehmen, eigene Wahl bleibt, lernen');
