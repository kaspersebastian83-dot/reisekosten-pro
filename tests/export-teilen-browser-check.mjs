// Exporte teilen statt herunterladen (Handy/Tablet, seit 1.15.0). Das Teilen-Menü gehört dem Gerät und fehlt im Prüf-Browser;
// es wird hier nachgebildet: PDF und CSV teilbar, Excel nicht (wie auf manchen Handys), erste PDF verlangt einen zweiten Tipp.
// Geprüft: Wahl nur auf Geräten mit Fingerbedienung, Datei geht mit unverändertem Namen an das Menü, Rückfall auf Download,
// „Datei ist fertig“, gemerkte Wahl, abgeschlossene Abrechnung zeigt „Abrechnung weitergeben“ vor der Tagesberechnung.
// npm run build && node tests/export-teilen-browser-check.mjs
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
const check = async (name, fn) => { await fn(); console.log('PASS', name); };
// Nachgebildetes Teilen-Menü: merkt sich, was es bekommen hat.
const teilenMenue = () => {
  window.__geteilt = []; window.__zweiterTipp = true;
  const teilbar = (file) => /\.(pdf|csv)$/.test(file.name);
  Object.defineProperty(navigator, 'canShare', { configurable: true, value: (data) => !!data?.files?.length && data.files.every(teilbar) });
  Object.defineProperty(navigator, 'share', { configurable: true, value: async (data) => {
    const file = data.files[0];
    if (file.name.endsWith('.pdf') && window.__zweiterTipp) { window.__zweiterTipp = false; throw new DOMException('Must be handling a user gesture', 'NotAllowedError'); }
    window.__geteilt.push({ name: file.name, type: file.type, size: file.size, keys: Object.keys(data).join(',') });
  } });
};
const offen = async (context) => {
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const downloads = []; page.on('download', (d) => downloads.push(d.suggestedFilename()));
  await page.clock.setFixedTime(new Date('2026-10-18T10:00:00Z'));
  await page.goto(url + '?demo=1'); await page.getByRole('heading', { name: 'Monatsübersicht', exact: true }).waitFor();
  const nav = async (name) => { if (await page.getByRole('button', { name: 'Menü öffnen', exact: true }).isVisible()) await page.getByRole('button', { name: 'Menü öffnen', exact: true }).click(); await page.locator('.sidebar nav').getByRole('button', { name: new RegExp('^' + name) }).click(); };
  return { page, errors, downloads, nav };
};
const stored = (page) => page.evaluate(() => new Promise((resolve, reject) => { const r = indexedDB.open('reisekosten-pro', 1); r.onsuccess = () => { const g = r.result.transaction('state').objectStore('state').get('main'); g.onsuccess = () => { r.result.close(); resolve(g.result); }; g.onerror = () => reject(g.error); }; r.onerror = () => reject(r.error); }));
const write = (page, value) => page.evaluate((value) => new Promise((resolve, reject) => { const r = indexedDB.open('reisekosten-pro', 1); r.onsuccess = () => { const tx = r.result.transaction('state', 'readwrite'); tx.objectStore('state').put(value, 'main'); tx.oncomplete = () => { r.result.close(); resolve(); }; tx.onerror = () => reject(tx.error); }; }), value);
const until = async (fn, what) => { for (let i = 0; i < 100; i++) { const value = await fn(); if (value) return value; await new Promise((r) => setTimeout(r, 100)); } throw Error(`Zeitüberschreitung: ${what}`); };
const juliEntwurf = async ({ page, nav }) => {
  await nav('Datensicherung'); await page.getByRole('button', { name: 'Demo-Daten laden', exact: true }).click();
  await until(async () => (await stored(page))?.trips?.length, 'Demo-Daten');
  await nav('Monatsübersicht'); await page.getByRole('button', { name: /^Jul/ }).click();
  await page.getByRole('button', { name: 'Spesenabrechnung erstellen', exact: true }).click();
  await until(async () => (await stored(page))?.statements?.length === 1, 'Entwurf');
  return page.locator('.export-card');
};

try {
  // Handy: Fingerbedienung + Teilen-Menü
  const handy = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, timezoneId: 'Europe/Berlin' });
  await handy.addInitScript(teilenMenue);
  const h = await offen(handy); const { page } = h;
  const card = await juliEntwurf(h);
  const geteilt = () => page.evaluate(() => window.__geteilt);
  const wahl = card.getByRole('group', { name: 'Exporte auf diesem Gerät' });

  await check('Handy: Wahl „Teilen / Herunterladen“ sichtbar, Vorgabe Teilen', async () => {
    await wahl.waitFor();
    assert.equal(await wahl.getByRole('button', { name: 'Teilen', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.match(await wahl.innerText(), /Teilen-Menü dieses Geräts/);
  });
  await check('Handy: Abrechnung zeigt erst die Summen; Einzelaufstellung und Rechenweg sind zugeklappt (seit 1.18.2)', async () => {
    const fold = page.locator('details.statement-fold');
    await fold.waitFor();
    assert.equal(await fold.evaluate((el) => el.open), false);
    assert.equal(await page.locator('.statement-table').count(), 0, 'breite Tabelle erst nach dem Aufklappen');
    assert.equal(await page.evaluate(() => !!(document.querySelector('.summary-grid').compareDocumentPosition(document.querySelector('.statement-fold')) & Node.DOCUMENT_POSITION_FOLLOWING)), true, 'Summen vor der Einzelaufstellung');
    const zu = await page.evaluate(() => document.documentElement.scrollHeight);
    await fold.locator(':scope > summary').click();
    await page.locator('.statement-table').waitFor();
    await page.locator('.statement-day-details').waitFor();
    assert.match(await fold.locator(':scope > summary').innerText(), /zuklappen/);
    const auf = await page.evaluate(() => document.documentElement.scrollHeight);
    assert.ok(auf > zu + 1500, `aufgeklappt deutlich länger (${zu} → ${auf})`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390, 'Tabelle scrollt in sich, die Seite nicht');
    await fold.locator(':scope > summary').click();
    await page.locator('.statement-table').waitFor({ state: 'detached' });
  });
  await check('Handy: CSV geht mit unverändertem Namen an das Teilen-Menü, kein Download', async () => {
    await card.getByRole('button', { name: 'CSV', exact: true }).click();
    await until(async () => (await geteilt()).length === 1, 'CSV geteilt');
    assert.deepEqual(await geteilt(), [{ name: 'Reisekosten_2026-07_V01.csv', type: 'text/csv', size: (await geteilt())[0].size, keys: 'files' }]);
    assert.ok((await geteilt())[0].size > 200);
    await card.getByRole('button', { name: 'Buchungsliste (CSV)', exact: true }).click();
    await until(async () => (await geteilt()).length === 2, 'Buchungsliste geteilt');
    assert.equal((await geteilt())[1].name, 'Buchungsliste_Reisekosten_2026-07_V01.csv');
    assert.deepEqual(h.downloads, []);
  });
  await check('Handy: Excel teilt dieses Gerät nicht → Download wie bisher, mit Hinweis', async () => {
    await card.getByRole('button', { name: 'Excel', exact: true }).click();
    await until(async () => h.downloads.length === 1, 'Excel-Download');
    assert.deepEqual(h.downloads, ['Reisekosten_2026-07_V01.xlsx']);
    await page.getByText('lässt sich auf diesem Gerät nicht teilen – stattdessen heruntergeladen', { exact: false }).waitFor();
    assert.equal((await geteilt()).length, 2);
  });
  await check('Handy: PDF braucht einen zweiten Tipp → „Datei ist fertig“ → Teilen', async () => {
    await card.getByRole('button', { name: 'PDF', exact: true }).click();
    const fertig = page.getByRole('dialog', { name: 'Datei ist fertig' });
    await fertig.waitFor({ timeout: 30000 });
    assert.match(await fertig.innerText(), /Reisekosten_2026-07_V01\.pdf/);
    assert.equal((await geteilt()).length, 2);
    await fertig.getByRole('button', { name: 'Teilen', exact: true }).click();
    await fertig.waitFor({ state: 'hidden' });
    const pdf = (await geteilt())[2];
    assert.deepEqual([pdf.name, pdf.type], ['Reisekosten_2026-07_V01.pdf', 'application/pdf']);
    assert.ok(pdf.size > 5000);
    assert.equal(h.downloads.length, 1);
  });
  await check('Handy: „Datei ist fertig“ lässt sich auch herunterladen', async () => {
    await page.evaluate(() => { window.__zweiterTipp = true; });
    await card.getByRole('button', { name: 'PDF', exact: true }).click();
    const fertig = page.getByRole('dialog', { name: 'Datei ist fertig' });
    await fertig.waitFor({ timeout: 30000 });
    await fertig.getByRole('button', { name: 'Herunterladen', exact: true }).click();
    await until(async () => h.downloads.length === 2, 'PDF-Download');
    assert.equal(h.downloads[1], 'Reisekosten_2026-07_V01.pdf');
    assert.equal(await fertig.count(), 0);
  });
  await check('Handy: „Herunterladen“ gewählt → Download; die Wahl bleibt nach dem Neuladen', async () => {
    await wahl.getByRole('button', { name: 'Herunterladen', exact: true }).click();
    await card.getByRole('button', { name: 'CSV', exact: true }).click();
    await until(async () => h.downloads.length === 3, 'CSV-Download');
    assert.equal((await geteilt()).length, 3);
    await page.reload(); await page.getByRole('heading', { name: 'Monatsübersicht', exact: true }).waitFor();
    await h.nav('Datensicherung');
    const sicherung = page.locator('.backup-card').first();
    assert.equal(await sicherung.getByRole('button', { name: 'Herunterladen', exact: true }).getAttribute('aria-pressed'), 'true');
    await sicherung.getByRole('button', { name: 'Sicherung herunterladen', exact: true }).waitFor();
    await sicherung.getByRole('button', { name: 'Teilen', exact: true }).click();
    await sicherung.getByRole('button', { name: 'Sicherung teilen', exact: true }).waitFor();
  });
  await check('Abgeschlossene Abrechnung: „Abrechnung weitergeben“ steht vor der Tagesberechnung, Entwurf wie bisher danach', async () => {
    const vor = async () => page.evaluate(() => { const karte = document.querySelector('.export-card'), tage = document.querySelector('.statement-day-details') || document.querySelector('.statement-fold'); return !!(karte.compareDocumentPosition(tage) & Node.DOCUMENT_POSITION_FOLLOWING); });
    await h.nav('Monatsübersicht'); await page.getByRole('button', { name: /^Jul/ }).click();
    await page.getByRole('button', { name: 'Abrechnung fortsetzen', exact: true }).click(); await page.locator('.export-card').waitFor();
    assert.equal(await vor(), false, 'Entwurf: Export am Ende');
    const state = await stored(page); state.statements[0] = { ...state.statements[0], locked: true, status: 'freigegeben' };
    await write(page, state); await page.reload(); await page.getByRole('heading', { name: 'Monatsübersicht', exact: true }).waitFor();
    await page.getByRole('button', { name: /^Jul/ }).click();
    const weiter = page.getByRole('button', { name: /Abrechnung (ansehen|fortsetzen|öffnen)/ }).first();
    await weiter.click(); await page.locator('.export-card').waitFor();
    assert.equal(await vor(), true, 'abgeschlossen: Export direkt unter dem Kopf');
  });
  assert.deepEqual(h.errors, []);
  await handy.close();

  // PC: Maus – auch mit Teilen-Menü (Windows) bleibt alles ein Download
  const pc = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Europe/Berlin' });
  await pc.addInitScript(teilenMenue);
  const p = await offen(pc);
  const pcCard = await juliEntwurf(p);
  await check('PC: keine Wahl, CSV wird heruntergeladen, nichts geht an ein Teilen-Menü', async () => {
    assert.equal(await p.page.getByRole('group', { name: 'Exporte auf diesem Gerät' }).count(), 0);
    assert.equal(await p.page.locator('.statement-fold').count(), 0, 'PC: kein Aufklappen');
    assert.equal(await p.page.evaluate(() => !!(document.querySelector('.statement-table').compareDocumentPosition(document.querySelector('.summary-grid')) & Node.DOCUMENT_POSITION_FOLLOWING)), true, 'PC: Summen nach der Einzelaufstellung wie bisher');
    await pcCard.getByRole('button', { name: 'CSV', exact: true }).click();
    await until(async () => p.downloads.length === 1, 'CSV-Download am PC');
    assert.deepEqual(p.downloads, ['Reisekosten_2026-07_V01.csv']);
    assert.deepEqual(await p.page.evaluate(() => window.__geteilt), []);
  });
  assert.deepEqual(p.errors, []);
} finally { await browser.close(); server.close(); }
