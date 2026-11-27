// „Belegfotos als ZIP“ unter Datensicherung (seit 1.20.0) im echten Browser: alle Belegfotos als Bilddateien in einer ZIP.
// Geprüft: Zähler und Zeitraum, PC lädt herunter, ZIP enthält die Bilder unverändert und die Belegliste, Bestand bleibt gleich;
// Handy: ZIP geht an das Teilen-Menü – teilt das Gerät keine ZIP (wie Chrome auf Android), wird sie heruntergeladen.
// npm run build && node tests/belege-zip-browser-check.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
const require = createRequire(import.meta.url);
const engines = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const JSZip = require('jszip');
const root = path.resolve('dist');
const server = http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (!pathname.startsWith('/reisekosten-pro/')) throw Error();
    if (pathname.includes('/tesseract/')) throw Error();   // Belegerkennung hier nicht nötig
    const file = path.resolve(root, pathname.slice('/reisekosten-pro/'.length) || 'index.html');
    if (!file.startsWith(root + '/')) throw Error();
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' })[path.extname(file)] || 'application/octet-stream' }).end(body);
  } catch { if (!res.headersSent) res.writeHead(404); res.end('Not found'); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/reisekosten-pro/`;
const browser = await engines.chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
const check = async (name, fn) => { await fn(); console.log('PASS', name); };
const until = async (fn, what) => { for (let i = 0; i < 100; i++) { const value = await fn(); if (value) return value; await new Promise((r) => setTimeout(r, 100)); } throw Error(`Zeitüberschreitung: ${what}`); };
const stored = (page) => page.evaluate(() => new Promise((resolve, reject) => { const r = indexedDB.open('reisekosten-pro', 1); r.onsuccess = () => { const g = r.result.transaction('state').objectStore('state').get('main'); g.onsuccess = () => { r.result.close(); resolve(g.result); }; g.onerror = () => reject(g.error); }; r.onerror = () => reject(r.error); }));
// Nachgebildetes Teilen-Menü; __zipTeilbar = false wie Chrome auf Android (ZIP steht dort nicht auf der Liste teilbarer Dateien).
const teilenMenue = () => {
  window.__geteilt = []; window.__zipTeilbar = true;
  Object.defineProperty(navigator, 'canShare', { configurable: true, value: (data) => !!data?.files?.length && data.files.every((f) => !f.name.endsWith('.zip') || window.__zipTeilbar) });
  Object.defineProperty(navigator, 'share', { configurable: true, value: async (data) => { window.__geteilt.push({ name: data.files[0].name, type: data.files[0].type, size: data.files[0].size }); } });
};
// Erfundene Belegfotos (beliebige Bytes reichen: SpesenKit legt sie unverändert ab)
const foto = (text, typ = 'image/jpeg') => `data:${typ};base64,${Buffer.from(text).toString('base64')}`;
const offen = async (context) => {
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const downloads = []; page.on('download', (d) => downloads.push(d));
  page.on('dialog', (d) => void d.accept());
  await page.clock.setFixedTime(new Date('2026-11-27T09:00:00Z'));
  await page.goto(url + '?demo=1'); await page.getByRole('heading', { name: 'Monatsübersicht', exact: true }).waitFor();
  const nav = async (name) => { if (await page.getByRole('button', { name: 'Menü öffnen', exact: true }).isVisible()) await page.getByRole('button', { name: 'Menü öffnen', exact: true }).click(); await page.locator('.sidebar nav').getByRole('button', { name: new RegExp('^' + name) }).click(); };
  // Demo-Daten laden, dann als Sicherung mit Belegfotos wieder einspielen (so kommen Fotos an Kosten und in den Eingang)
  await nav('Datensicherung'); await page.getByRole('button', { name: 'Demo-Daten laden', exact: true }).click();
  const demo = await until(async () => { const s = await stored(page); return s?.expenses?.length >= 3 ? s : null; }, 'Demo-Daten');
  const mitFoto = (e, inhalt, name) => ({ ...e, receipt: { id: `b-${e.id}`, name, type: 'image/jpeg', size: inhalt.length, hash: `h-${e.id}`, dataUrl: foto(inhalt) } });
  const sicherung = { ...demo,
    expenses: demo.expenses.map((e, i) => i === 0 ? mitFoto(e, 'PARKEN-FOTO', 'parken.jpg') : i === 1 ? mitFoto(e, 'HOTEL-FOTO', 'hotel.jpg') : { ...e, receipt: undefined }),
    receiptInbox: [{ id: 'eingang-1', capturedAt: '2026-11-20T08:00:00Z', status: 'neu', notes: '', suggestion: { confidence: 0.3, gross: 7.5, merchant: 'Bäckerei' },
      receipt: { id: 'b-eingang', name: 'IMG_2045.png', type: 'image/png', size: 9, hash: 'h-eingang', dataUrl: foto('BON-FOTO', 'image/png') } }] };
  await page.locator('.backup-grid input[type=file][accept=".json"]').setInputFiles({ name: 'sicherung.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(sicherung)) });
  await page.getByText('Datensicherung wiederhergestellt', { exact: true }).waitFor();
  const bestand = await until(async () => { const s = await stored(page); return s?.receiptInbox?.length === 1 ? s : null; }, 'Sicherung eingespielt');
  return { page, errors, downloads, nav, bestand };
};
const zipLesen = async (download) => JSZip.loadAsync(await readFile(await download.path()));

try {
  /* ---------- PC ---------- */
  const pc = await offen(await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Europe/Berlin', acceptDownloads: true }));
  const pp = pc.page;
  const karte = pp.getByRole('region', { name: 'Belegfotos als ZIP' });
  const parken = pc.bestand.expenses[0], hotel = pc.bestand.expenses[1];

  await check('PC: Karte zählt die Fotos samt Beleg-Eingang, Zeitraum nennt die Monate mit Fotos', async () => {
    await karte.waitFor();
    assert.match(await karte.innerText(), /3 Belegfotos, davon 1 im Beleg-Eingang\./);
    const monate = await karte.getByLabel('Zeitraum').locator('option').allInnerTexts();
    assert.equal(monate[0], 'Alle Monate');
    assert.ok(monate.includes('November 2026') && monate.includes('Juli 2026'), monate.join(', '));
    assert.equal(await karte.getByRole('group', { name: 'Exporte auf diesem Gerät' }).count(), 0, 'am PC keine Wahl Teilen/Herunterladen');
  });
  await check('PC: „Belege als ZIP herunterladen“ → Bilder unverändert, nach Monat geordnet, Belegliste; Bestand bleibt gleich', async () => {
    const vorher = await stored(pp);
    await karte.getByRole('button', { name: 'Belege als ZIP herunterladen', exact: true }).click();
    await until(() => pc.downloads.length === 1, 'Download');
    assert.equal(pc.downloads[0].suggestedFilename(), 'SpesenKit-Belege_alle_2026-11-27.zip');
    const zip = await zipLesen(pc.downloads[0]);
    const dateien = Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort();
    assert.equal(dateien.length, 4, dateien.join(', '));
    assert.ok(dateien.includes('Belegliste.csv'));
    assert.ok(dateien.includes('Beleg-Eingang/2026-11-20_IMG_2045.png'), dateien.join(', '));
    const parkenDatei = dateien.find((n) => n.startsWith(`Kosten/${parken.date.slice(0, 7)}/${parken.date}_`));
    assert.ok(parkenDatei, dateien.join(', '));
    const inhalte = await Promise.all(dateien.filter((n) => n !== 'Belegliste.csv').map((n) => zip.file(n).async('string')));
    assert.deepEqual(inhalte.sort(), ['BON-FOTO', 'HOTEL-FOTO', 'PARKEN-FOTO']);
    const liste = (await zip.file('Belegliste.csv').async('string')).replace(/^﻿/, '').trim().split(/\r?\n/);
    assert.equal(liste.length, 4);
    assert.match(liste[0], /^Datei;Bereich;Datum;Kostenart;/);
    assert.ok(liste.some((z) => z.includes(';Beleg-Eingang;20.11.2026;') && z.includes('Bäckerei;7,50;EUR') && z.includes('noch nicht zugeordnet')));
    await pp.locator('.toast').getByText('3 Belegfotos in der ZIP-Datei.', { exact: false }).waitFor();
    assert.deepEqual(await stored(pp), vorher, 'nichts geändert');
    assert.ok(hotel.receipt?.fileId);
  });
  await check('PC: Zeitraum November → nur das Foto aus dem Eingang', async () => {
    await karte.getByLabel('Zeitraum').selectOption('2026-11');
    assert.match(await karte.innerText(), /1 Belegfoto, davon 1 im Beleg-Eingang\./);
    await karte.getByRole('button', { name: 'Belege als ZIP herunterladen', exact: true }).click();
    await until(() => pc.downloads.length === 2, 'zweiter Download');
    assert.equal(pc.downloads[1].suggestedFilename(), 'SpesenKit-Belege_2026-11_2026-11-27.zip');
    const zip = await zipLesen(pc.downloads[1]);
    assert.deepEqual(Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort(), ['Beleg-Eingang/2026-11-20_IMG_2045.png', 'Belegliste.csv']);
  });
  assert.deepEqual(pc.errors, []);

  /* ---------- Handy ---------- */
  const handyContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, timezoneId: 'Europe/Berlin', acceptDownloads: true });
  await handyContext.addInitScript(teilenMenue);
  const handy = await offen(handyContext);
  const hp = handy.page;
  const hKarte = hp.getByRole('region', { name: 'Belegfotos als ZIP' });
  await check('Handy: ZIP geht an das Teilen-Menü', async () => {
    await hKarte.waitFor();
    assert.match(await hKarte.innerText(), /Kann das Handy ZIP-Dateien nicht teilen/);
    await hKarte.getByRole('button', { name: 'Belege als ZIP teilen', exact: true }).click();
    const geteilt = await until(async () => { const g = await hp.evaluate(() => window.__geteilt); return g.length ? g : null; }, 'geteilt');
    assert.deepEqual([geteilt[0].name, geteilt[0].type], ['SpesenKit-Belege_alle_2026-11-27.zip', 'application/zip']);
    assert.ok(geteilt[0].size > 300);
    assert.deepEqual(handy.downloads, []);
  });
  await check('Handy: teilt das Gerät keine ZIP (Android), wird sie heruntergeladen', async () => {
    await hp.evaluate(() => { window.__zipTeilbar = false; });
    await hKarte.getByRole('button', { name: 'Belege als ZIP teilen', exact: true }).click();
    await until(() => handy.downloads.length === 1, 'Download statt Teilen');
    assert.equal(handy.downloads[0].suggestedFilename(), 'SpesenKit-Belege_alle_2026-11-27.zip');
    const zip = await zipLesen(handy.downloads[0]);
    assert.equal(Object.keys(zip.files).filter((n) => !zip.files[n].dir && n !== 'Belegliste.csv').length, 3);
    assert.equal(await hp.evaluate(() => document.documentElement.scrollWidth), 390, 'nichts ragt seitlich heraus');
  });
  assert.deepEqual(handy.errors, []);
} finally { await browser.close(); server.close(); }
