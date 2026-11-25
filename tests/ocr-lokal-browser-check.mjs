// Belegerkennung ohne fremden Server (seit 1.14.0): Arbeitsskript, Rechenkern und Sprachdateien kommen aus ./tesseract/ der App.
// Fremde Adressen sind gesperrt; ein synthetischer Bon wird trotzdem gelesen (Betrag, Datum). Rein synthetische Daten.
// npm run build && node tests/ocr-lokal-browser-check.mjs
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
    res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.gz': 'application/gzip' })[path.extname(file)] || 'application/octet-stream' });
    res.end(await readFile(file));
  } catch { res.writeHead(404).end('Not found'); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/reisekosten-pro/`;
const browser = await engines.chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Europe/Berlin' });
  const fremd = [], eigen = [];
  context.on('request', (request) => { const u = new URL(request.url()); if (!/^https?:$/.test(u.protocol)) return; (u.hostname === '127.0.0.1' ? eigen : fremd).push(u.hostname === '127.0.0.1' ? u.pathname : request.url()); });
  await context.route(/https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url); await page.getByRole('heading', { name: 'Monatsübersicht', exact: true }).waitFor();
  await page.locator('.month-entry-workspace').getByRole('button', { name: 'Beleg fotografieren / OCR', exact: true }).click();
  const png = Buffer.from(await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 900; c.height = 1100; const g = c.getContext('2d');
    g.fillStyle = 'white'; g.fillRect(0, 0, c.width, c.height); g.fillStyle = 'black'; g.font = '44px Arial, Helvetica, sans-serif';
    ['Tankstelle Muster GmbH', 'Musterweg 1, 12345 Musterstadt', 'Datum: 14.10.2026', 'Diesel 30,00 l', 'Netto 45,00 EUR', 'MwSt 19 % 8,55 EUR', 'Gesamtbetrag 53,55 EUR'].forEach((line, i) => g.fillText(line, 60, 140 + i * 120));
    return c.toDataURL('image/png').split(',')[1];
  }), 'base64');
  const capture = page.locator('.receipt-capture');
  await capture.locator('input[type=file]').first().setInputFiles({ name: 'synthetischer-bon.png', mimeType: 'image/png', buffer: png });
  const betrag = capture.getByLabel(/^Betrag/);
  for (let i = 0; i < 900 && !(await betrag.inputValue()); i++) {
    assert.equal(await page.getByText('Die automatische Erkennung war nicht möglich.', { exact: false }).count(), 0, 'Belegerkennung läuft ohne fremden Server');
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(await betrag.inputValue(), '53.55', 'Bruttobetrag gelesen');
  assert.equal(await capture.getByLabel('Datum', { exact: true }).inputValue(), '2026-10-14', 'Belegdatum gelesen');
  assert.deepEqual(fremd, [], 'keine Anfrage an einen fremden Server');
  assert.ok(eigen.includes('/reisekosten-pro/tesseract/worker.min.js'), 'Arbeitsskript aus der App selbst');
  assert.deepEqual(errors, []);
  console.log('PASS Belegerkennung liest einen Bon nur mit Dateien aus ./tesseract/ – keine Anfrage an fremde Server');
  console.log('     geladen:', [...new Set(eigen.filter((p) => p.includes('/tesseract/')))].map((p) => p.split('/').pop()).join(', '));
} finally { await browser.close(); server.close(); }
