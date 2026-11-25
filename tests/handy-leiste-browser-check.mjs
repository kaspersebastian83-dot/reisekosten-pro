// Handy (seit 1.17.0): Schnellleiste unten (Belegfoto, Neue Reise) und Sicherungshinweis in einer Zeile statt des großen
// Ordner-Hinweises. Am PC unverändert. Rein synthetische Daten.
// npm run build && node tests/handy-leiste-browser-check.mjs
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
const stored = (page) => page.evaluate(() => new Promise((resolve, reject) => { const r = indexedDB.open('reisekosten-pro', 1); r.onsuccess = () => { const g = r.result.transaction('state').objectStore('state').get('main'); g.onsuccess = () => { r.result.close(); resolve(g.result); }; g.onerror = () => reject(g.error); }; r.onerror = () => reject(r.error); }));
const until = async (fn, what) => { for (let i = 0; i < 100; i++) { const value = await fn(); if (value) return value; await new Promise((r) => setTimeout(r, 100)); } throw Error(`Zeitüberschreitung: ${what}`); };
const offen = async (context) => {
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.clock.setFixedTime(new Date('2026-10-18T10:00:00Z'));
  await page.goto(url + '?demo=1'); await page.getByRole('heading', { name: 'Monatsübersicht', exact: true }).waitFor();
  const nav = async (name) => { if (await page.getByRole('button', { name: 'Menü öffnen', exact: true }).isVisible()) await page.getByRole('button', { name: 'Menü öffnen', exact: true }).click(); await page.locator('.sidebar nav').getByRole('button', { name: new RegExp('^' + name) }).click(); };
  return { page, errors, nav };
};
try {
  const handy = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, timezoneId: 'Europe/Berlin' });
  const { page, errors, nav } = await offen(handy);
  const leiste = page.getByRole('navigation', { name: 'Schnell erfassen' });
  const hinweis = page.locator('.folder-banner');

  await check('Handy ohne Daten: kein Hinweis, Schnellleiste am unteren Rand', async () => {
    assert.equal(await hinweis.count(), 0);
    await leiste.waitFor();
    const box = await leiste.boundingBox();
    assert.ok(Math.abs(box.y + box.height - 780) <= 1 && box.width === 390, 'Leiste unten über die ganze Breite');
    for (const name of ['Belegfoto', 'Neue Reise']) assert.ok((await leiste.getByRole('button', { name, exact: true }).boundingBox()).height >= 48, name);
  });
  await check('Handy: „Neue Reise“ öffnet das Reisefenster; die Leiste weicht dem Fenster', async () => {
    await leiste.getByRole('button', { name: 'Neue Reise', exact: true }).click();
    await page.getByRole('heading', { name: 'Neue Dienstreise', exact: true }).waitFor();
    assert.equal(await leiste.count(), 0);
    await page.locator('.modal').getByRole('button', { name: 'Abbrechen', exact: true }).click();
    await leiste.waitFor();
  });
  await check('Handy: „Belegfoto“ öffnet den Beleg-Eingang', async () => {
    await leiste.getByRole('button', { name: 'Belegfoto', exact: true }).click();
    await page.locator('.receipt-capture').getByText('Beleg fotografieren', { exact: true }).waitFor();
    assert.equal(await leiste.count(), 0);
    await page.locator('.receipt-capture').getByRole('button', { name: 'Schließen' }).click();
    await leiste.waitFor();
  });
  await check('Handy mit Daten: eine Zeile „nur auf diesem Gerät“ statt des großen Ordner-Hinweises; „Sichern“ führt zur Datensicherung', async () => {
    await nav('Datensicherung'); await page.getByRole('button', { name: 'Demo-Daten laden', exact: true }).click();
    await until(async () => (await stored(page))?.trips?.length, 'Demo-Daten');
    await hinweis.waitFor();
    assert.match(await hinweis.innerText(), /Ihre Spesen liegen nur auf diesem Gerät\.\s*Noch keine Sicherung erstellt\./);
    assert.doesNotMatch(await hinweis.innerText(), /Terminalserver|Ordner einrichten/);
    assert.ok((await hinweis.boundingBox()).height <= 90, 'eine kompakte Zeile');
    assert.equal(await leiste.count(), 0, 'Leiste nur in der Monatsübersicht');
    await nav('Monatsübersicht'); await hinweis.getByRole('button', { name: 'Sichern', exact: true }).click();
    await page.getByRole('heading', { name: 'Datensicherung', exact: true }).waitFor();
  });
  await check('Handy: nach „Sicherung herunterladen“ nennt der Hinweis den Tag', async () => {
    await page.locator('.backup-card').first().getByRole('button', { name: 'Sicherung herunterladen', exact: true }).click();
    await until(async () => page.evaluate(() => localStorage.getItem('spesenkit-letzte-sicherung')), 'Sicherung gemerkt');
    await nav('Monatsübersicht');
    assert.match(await hinweis.innerText(), /Letzte Sicherung: 18\.10\.2026/);
  });
  await check('Handy: bleiben nur gespeicherte Abrechnungen (Reisen und Kosten gelöscht), bleibt der Hinweis', async () => {
    const schreiben = (value) => page.evaluate((value) => new Promise((resolve, reject) => { const r = indexedDB.open('reisekosten-pro', 1); r.onsuccess = () => { const tx = r.result.transaction('state', 'readwrite'); tx.objectStore('state').put(value, 'main'); tx.oncomplete = () => { r.result.close(); resolve(); }; tx.onerror = () => reject(tx.error); }; }), value);
    await page.getByRole('button', { name: /^Jul/ }).click();
    await page.getByRole('button', { name: 'Spesenabrechnung erstellen', exact: true }).click();
    const state = await until(async () => { const s = await stored(page); return s?.statements?.length === 1 ? s : null; }, 'Entwurf');
    await schreiben({ ...state, trips: [], expenses: [], receiptInbox: [] });
    await page.reload(); await page.getByRole('heading', { name: 'Monatsübersicht', exact: true }).waitFor();
    assert.equal((await stored(page)).trips.length, 0);
    await hinweis.waitFor();
    assert.match(await hinweis.innerText(), /nur auf diesem Gerät/);
    await schreiben(state);
    await page.reload(); await page.getByRole('heading', { name: 'Monatsübersicht', exact: true }).waitFor(); await hinweis.waitFor();
  });
  await check('Handy: Inhalt endet über der Leiste, nichts ragt seitlich heraus', async () => {
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    const { ende, leisteOben, breite } = await page.evaluate(() => { const karten = [...document.querySelectorAll('.content > *, .content section')].filter((el) => el.getClientRects().length); return { ende: Math.max(...karten.map((el) => el.getBoundingClientRect().bottom)), leisteOben: document.querySelector('.quick-bar').getBoundingClientRect().top, breite: document.documentElement.scrollWidth }; });
    assert.ok(ende <= leisteOben, `letzter Inhalt ${Math.round(ende)} über der Leiste ${Math.round(leisteOben)}`);
    assert.equal(breite, 390);
  });
  assert.deepEqual(errors, []);
  await handy.close();

  const pc = await offen(await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Europe/Berlin' }));
  await check('PC: keine Schnellleiste, Ordner-Hinweis wie bisher', async () => {
    assert.equal(await pc.page.getByRole('navigation', { name: 'Schnell erfassen' }).count(), 0);
    assert.match(await pc.page.locator('.folder-banner').innerText(), /Ihre Spesen liegen bisher nur in diesem Browser[\s\S]*Ordner einrichten/);
  });
  assert.deepEqual(pc.errors, []);
} finally { await browser.close(); server.close(); }
