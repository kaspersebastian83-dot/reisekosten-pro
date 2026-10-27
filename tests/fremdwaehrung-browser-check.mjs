// Optional browser checks: existing Playwright installation, no project dependency. Vorher `npm run build`.
// PLAYWRIGHT_MODULE=/absolute/path/to/playwright node tests/fremdwaehrung-browser-check.mjs
// SpesenKit 1.12.0: Kosten in Fremdwährung – EZB-Kurs zum Belegdatum (Antwort der EZB hier nachgebildet), Kurs aus der
// Kartenabrechnung, gespeicherte Quelle, Erstattung in Euro. Synthetische Daten.
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
    res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream' }).end(await readFile(file));
  } catch { res.writeHead(404).end('Not found'); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/reisekosten-pro/`;
const browser = await engines[process.env.BROWSER_ENGINE || 'chromium'].launch({ headless: true });
const state = (page) => page.evaluate(() => new Promise((resolve, reject) => { const r = indexedDB.open('reisekosten-pro', 1); r.onsuccess = () => { const db = r.result; const g = db.transaction('state').objectStore('state').get('main'); g.onsuccess = () => { resolve(g.result); db.close(); }; g.onerror = () => reject(g.error); }; r.onerror = () => reject(r.error); }));
const waitState = async (page, fn) => { for (let i = 0; i < 60; i++) { const s = await state(page); if (s && fn(s)) return s; await page.waitForTimeout(100); } throw Error('Saved state condition timed out'); };
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport });
    await context.route(/https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    const abfragen = [];
    await context.route(/data-api\.ecb\.europa\.eu/, (r) => { abfragen.push(r.request().url()); r.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'text/csv' }, body: 'KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE\nEXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2026-03-06,1.0800\n' }); });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(url); await page.getByRole('heading', { name: 'Monatsübersicht', exact: true }).waitFor();
    await page.locator('input[type=month]').fill('2026-03');
    const editor = page.locator('.modal');
    await page.locator('.month-entry-workspace').getByRole('button', { name: 'Sonstige Kosten erfassen', exact: true }).click(); await editor.waitFor();
    await editor.getByLabel('Datum', { exact: true }).fill('2026-03-08');
    await editor.getByLabel('Brutto (€)', { exact: true }).fill('54');
    await editor.getByLabel('Währung', { exact: true }).selectOption('USD');
    await editor.getByText('EZB-Referenzkurs 06.03.2026').waitFor();
    assert.match(await editor.getByLabel('Euro je 1 USD').inputValue(), /^0,925926$/);
    await editor.getByText('= 50,00 €').waitFor();
    assert.match(abfragen[0], /D\.USD\.EUR\.SP00\.A\?startPeriod=2026-02-26&endPeriod=2026-03-08&format=csvdata/);
    assert.equal(await editor.getByLabel('Brutto (USD)', { exact: true }).count(), 1, 'Betragsfeld zeigt die Währung');
    await editor.getByLabel('Gehört zu keiner Reise und keinem Projekt (z. B. Büromaterial)', { exact: true }).check();
    await editor.getByRole('button', { name: 'Speichern & fertig', exact: true }).click(); await editor.waitFor({ state: 'detached' });
    let s = await waitState(page, (x) => x.expenses.length === 1);
    assert.deepEqual([s.expenses[0].currency, s.expenses[0].exchangeRate, s.expenses[0].exchangeRateSource], ['USD', 0.925926, 'EZB-Referenzkurs 06.03.2026']);
    await page.locator('.month-entry-workspace').getByText('50,00 €').first().waitFor();
    console.log(`PASS ${viewport.width}: Dollar-Beleg mit EZB-Kurs zum Belegdatum, Quelle gespeichert, Erstattung in Euro`);

    // Kartenabrechnung überschreibt den Kurs; beim Öffnen wird nichts neu geladen
    await page.getByRole('region', { name: 'Monat im Überblick', exact: true }).getByText(/sonstige Nebenkosten|Parken/).first().click();
    await editor.waitFor();
    const vorher = abfragen.length;
    await editor.getByLabel('Euro-Betrag laut Kartenabrechnung').fill('51,30');
    await editor.getByText('Kartenabrechnung', { exact: false }).first().waitFor();
    await editor.getByRole('button', { name: 'Speichern & fertig', exact: true }).click(); await editor.waitFor({ state: 'detached' });
    s = await waitState(page, (x) => x.expenses[0].exchangeRateSource === 'Kartenabrechnung');
    assert.equal(s.expenses[0].exchangeRate, 0.95);
    assert.equal(abfragen.length, vorher, 'gespeicherter Kurs wird beim Öffnen nicht neu geladen');
    // ohne Kurs kein Speichern
    await page.locator('.month-entry-workspace').getByRole('button', { name: 'Sonstige Kosten erfassen', exact: true }).click(); await editor.waitFor();
    await editor.getByLabel('Datum', { exact: true }).fill('2026-03-09');
    await editor.getByLabel('Brutto (€)', { exact: true }).fill('10');
    await context.unroute(/data-api\.ecb\.europa\.eu/);
    await editor.getByLabel('Währung', { exact: true }).selectOption('CHF');
    await editor.getByText('Kurs konnte nicht geladen werden', { exact: false }).waitFor({ timeout: 25000 });
    await editor.getByRole('button', { name: 'Speichern & fertig', exact: true }).click();
    await page.locator('.toast', { hasText: 'Bitte den Kurs für CHF angeben' }).waitFor();
    assert.deepEqual(errors, []);
    console.log(`PASS ${viewport.width}: Kurs aus der Kartenabrechnung, ohne Kurs kein Speichern, offline verständliche Meldung`);
    await context.close();
  }
} finally { await browser.close(); server.close(); }
