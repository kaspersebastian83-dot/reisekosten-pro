// Optional browser checks: existing Playwright installation, no project dependency. Vorher `npm run build`.
// PLAYWRIGHT_MODULE=/absolute/path/to/playwright BROWSER_EXECUTABLE=/path/to/browser node tests/buerokasse-browser-check.mjs
// SpesenKit 1.11.0: Auswahl „Außendienst · Innendienst · Bürokasse“ oben, Bürokasse auf dem Handy (Anfangsbestand, Ausgabe
// mit Foto, Einnahme, Storno, Zählung mit Differenz, Sicherung) und am PC (Vom Handy übernehmen → Bürokasse-Ordner).
// Synthetische Daten. Texterkennung offline (Netz außer localhost gesperrt): Betrag wird eingetippt.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
const require = createRequire(import.meta.url);
const engines = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const engine = process.env.BROWSER_ENGINE || 'chromium';
const root = path.resolve('dist');
const server = http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (!pathname.startsWith('/reisekosten-pro/')) throw Error();
    const file = path.resolve(root, pathname.slice('/reisekosten-pro/'.length) || 'index.html');
    if (!file.startsWith(root + '/')) throw Error();
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' })[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }).end(body);
  } catch { res.writeHead(404).end('Not found'); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/reisekosten-pro/`;
const browser = await engines[engine].launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
// Nur für Testumgebungen, deren Browser OPFS-Ordner nicht in IndexedDB speichern kann (TEST_SHIM=Pfad).
const shim = process.env.TEST_SHIM ? await readFile(process.env.TEST_SHIM, 'utf8') : '';
const neu = async (viewport) => {
  const context = await browser.newContext({ viewport, acceptDownloads: true });
  await context.route(/https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  if (shim) await context.addInitScript(shim);
  const page = await context.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.goto(url); await page.getByRole('heading', { name: 'Monatsübersicht', exact: true }).waitFor();
  return { context, page, errors };
};
const toast = (page, text) => page.locator('.toast', { hasText: text }).waitFor();
const stand = async (page) => (await page.getByTestId('kassenstand').innerText()).replace(/\s/g, ' ');
const chip = (page) => page.getByRole('radiogroup', { name: 'Arbeitsbereich' });
const nav = async (page, name) => { if (await page.getByRole('button', { name: 'Menü öffnen', exact: true }).isVisible()) await page.getByRole('button', { name: 'Menü öffnen', exact: true }).click(); await page.locator('.sidebar nav').getByRole('button', { name: new RegExp('^' + name) }).click(); };
const kasseEinschalten = async (page) => {
  await nav(page, 'Einstellungen');
  await page.getByLabel('Ich führe die Bürokasse', { exact: false }).check();
  await chip(page).getByRole('radio', { name: 'Bürokasse' }).click();
  await page.getByRole('heading', { name: 'Bürokasse', exact: true }).waitFor();
};
let sicherung = '';
try {
  // ---------- Handy ----------
  {
    const { page, errors } = await neu({ width: 390, height: 844 });
    assert.deepEqual(await chip(page).getByRole('radio').allInnerTexts(), ['Außendienst', 'Innendienst']);
    await chip(page).getByRole('radio', { name: 'Innendienst' }).click();
    await page.getByRole('button', { name: 'Kosten erfassen', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Dienstreise erfassen', exact: true }).count(), 0);
    await chip(page).getByRole('radio', { name: 'Außendienst' }).click();
    await page.getByRole('button', { name: 'Dienstreise erfassen', exact: true }).waitFor();
    console.log('PASS 390: Außendienst/Innendienst oben umschaltbar');

    await kasseEinschalten(page);
    assert.equal(await chip(page).getByRole('radio', { name: 'Bürokasse' }).getAttribute('aria-checked'), 'true');
    await page.getByLabel('Geld in der Kasse (gezählt)').fill('200');
    await page.getByRole('button', { name: 'Kassenbuch beginnen' }).click();
    await page.getByTestId('kassenstand').waitFor();
    assert.equal(await stand(page), '200,00 €');

    const jpg = Buffer.from((await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 300; c.height = 400; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 300, 400); g.fillStyle = '#000'; g.font = '20px sans-serif'; g.fillText('POST 12,50', 40, 80); return c.toDataURL('image/jpeg', .8); })).split(',')[1], 'base64');
    await page.getByRole('button', { name: 'Ausgabe mit Beleg' }).click();
    const fenster = page.getByRole('dialog', { name: 'Ausgabe buchen' });
    await fenster.locator('.kasse-kamera input').setInputFiles({ name: 'beleg.jpg', mimeType: 'image/jpeg', buffer: jpg });
    await fenster.locator('.kasse-foto img').waitFor();
    await fenster.getByText('Automatisches Lesen nicht möglich', { exact: false }).waitFor({ timeout: 30000 });
    await fenster.getByLabel('Betrag').fill('12,50');
    await fenster.getByLabel('Wofür?').selectOption('Porto / Versand');
    await fenster.getByRole('button', { name: 'Ausgabe buchen' }).click();
    await toast(page, 'Ausgabe 2026-0002 gebucht'.replace('2026', String(new Date().getFullYear())));
    assert.equal(await stand(page), '187,50 €');

    await page.getByRole('button', { name: 'Einnahme', exact: true }).click();
    const ein = page.getByRole('dialog', { name: 'Einnahme buchen' });
    await ein.getByLabel('Betrag').fill('100');
    await ein.getByRole('button', { name: 'Einnahme buchen' }).click();
    await ein.waitFor({ state: 'detached' });
    assert.equal(await stand(page), '287,50 €');

    // zu viel: wird abgelehnt, nichts gebucht
    await page.getByRole('button', { name: 'Ausgabe mit Beleg' }).click();
    await fenster.getByLabel('Kein Beleg vorhanden (Eigenbeleg)').check();
    await fenster.getByLabel('Betrag').fill('500');
    await fenster.getByLabel('Wofür?').selectOption('Sonstiges');
    await fenster.getByLabel('Wofür genau? (Pflicht ohne Beleg)').fill('Test');
    await fenster.getByRole('button', { name: 'Ausgabe buchen' }).click();
    await toast(page, 'nicht in der Kasse');
    await fenster.getByRole('button', { name: 'Abbrechen' }).click();
    assert.equal(await stand(page), '287,50 €');
    console.log('PASS 390: Anfangsbestand, Ausgabe mit Foto, Einnahme, Bestand nie negativ');

    await page.locator('.kasse-zeile', { hasText: 'Porto / Versand' }).click();
    const detail = page.getByRole('dialog', { name: /^Ausgabe / });
    await detail.locator('img.kasse-beleg').waitFor();
    await detail.getByRole('button', { name: 'Falsch gebucht? Stornieren …' }).click();
    await detail.getByLabel('Grund').fill('Betrag falsch');
    await detail.getByRole('button', { name: 'Stornieren', exact: true }).click();
    await detail.waitFor({ state: 'detached' });
    assert.equal(await stand(page), '300,00 €');
    assert.equal(await page.locator('.kasse-zeile.storniert').count(), 1, 'stornierte Buchung bleibt sichtbar');

    await page.getByRole('button', { name: 'Kasse zählen' }).click();
    const zaehlen = page.getByRole('dialog', { name: 'Kasse zählen' });
    await zaehlen.locator('summary').click();
    await zaehlen.getByLabel('Anzahl 100 Euro').fill('2');
    await zaehlen.getByLabel('Anzahl 50 Euro').fill('1');
    await zaehlen.getByLabel('Anzahl 20 Euro').fill('2');
    await zaehlen.getByLabel('Anzahl 5 Euro').fill('1');
    await zaehlen.getByLabel('Anzahl 2 Euro').fill('2');
    await zaehlen.getByLabel('Anzahl 50 Cent').fill('1');
    assert.equal(await zaehlen.getByLabel('Gezählt').inputValue(), '299,50');
    await zaehlen.getByText('Differenz − 0,50 €').waitFor();
    await zaehlen.getByRole('button', { name: 'Speichern und Differenz buchen' }).click();
    await zaehlen.waitFor({ state: 'detached' });
    assert.equal(await stand(page), '299,50 €');
    await page.locator('.kasse-zeile', { hasText: 'Kassendifferenz' }).waitFor();
    console.log('PASS 390: Storno bleibt sichtbar, Zählhilfe, Differenz als Kassendifferenz');

    await page.locator('.kasse-sicherung.warn').waitFor();
    await page.evaluate(() => { navigator.canShare = () => false; });
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Sicherung senden' }).click();
    const datei = await download;
    assert.match(datei.suggestedFilename(), /^Buerokasse-Sicherung_\d{4}-\d\d-\d\d_\d{4}\.txt$/);
    sicherung = await readFile(await datei.path(), 'utf8');
    const inhalt = JSON.parse(sicherung);
    assert.equal(inhalt.records.length, 7, 'Anfangsbestand + Zählung, 2 Ausgaben, Einnahme, Storno, Differenz (+ Zählung)');
    assert.equal(Object.keys(inhalt.belege).length, 1);
    await page.locator('.kasse-sicherung.ok').waitFor();

    await page.reload(); await page.getByTestId('kassenstand').waitFor();
    assert.equal(await stand(page), '299,50 €', 'Modus und Kassenbuch bleiben nach dem Neuladen');
    console.log('PASS 390: Sicherung als Datei (ohne Teilen-Menü), Modus bleibt nach dem Neuladen');

    // Haken „Ich führe die Bürokasse“ wieder wegnehmen – bleibt weg, auch nach dem Neuladen (Rückmeldung 27.10.)
    await nav(page, 'Einstellungen');
    await page.getByLabel('Ich führe die Bürokasse', { exact: false }).uncheck();
    assert.deepEqual(await chip(page).getByRole('radio').allInnerTexts(), ['Außendienst', 'Innendienst']);
    await page.waitForTimeout(500);
    assert.equal(await page.getByLabel('Ich führe die Bürokasse', { exact: false }).isChecked(), false);
    await page.reload(); await page.getByRole('heading', { name: 'Monatsübersicht', exact: true }).waitFor(); await page.waitForTimeout(500);
    assert.deepEqual(await chip(page).getByRole('radio').allInnerTexts(), ['Außendienst', 'Innendienst']);
    await kasseEinschalten(page);
    assert.equal(await stand(page), '299,50 €', 'Kassenbuch bleibt beim Ausblenden erhalten');
    assert.deepEqual(errors.filter((e) => !/importScripts|tesseract/i.test(e)), []);
    console.log('PASS 390: Haken „Ich führe die Bürokasse“ lässt sich wieder entfernen, Kassenbuch bleibt');
  }
  // ---------- PC ----------
  {
    const { page, errors } = await neu({ width: 1440, height: 1000 });
    await kasseEinschalten(page);
    await page.evaluate(async () => { const r = await navigator.storage.getDirectory(); const d = await r.getDirectoryHandle('Terminal', { create: true }); window.showDirectoryPicker = async () => d; });
    await page.getByRole('button', { name: 'Bürokasse-Ordner auf dem Laufwerk öffnen' }).click();
    await toast(page, 'verbunden');
    await page.locator('.kasse-start input[type=file]').setInputFiles({ name: 'Buerokasse-Sicherung.txt', mimeType: 'text/plain', buffer: Buffer.from(sicherung) });
    await toast(page, '7 neue Einträge übernommen');
    await page.getByTestId('kassenstand').waitFor();
    assert.equal(await stand(page), '299,50 €');
    await page.getByText('Nur Ansicht und Ablage').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Ausgabe mit Beleg' }).count(), 0, 'am PC wird nicht gebucht');
    const dateien = async () => page.evaluate(async () => {
      const r = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('Terminal')).getDirectoryHandle('Bürokasse');
      const list = async (d) => { const out = []; for await (const [n, h] of d.entries()) out.push(h.kind === 'file' ? n : [n, await list(h)]); return out.sort(); };
      return list(r);
    });
    let liste;
    for (let i = 0; i < 40; i++) { liste = await dateien(); if (JSON.stringify(liste).split('.json').length - 1 === 7) break; await page.waitForTimeout(150); }
    const flach = JSON.stringify(liste);
    assert.equal(flach.split('.json').length - 1, 7, flach);
    assert.match(flach, /"Belege",\["[0-9a-f]{64}\.jpg"\]/);
    // nochmal übernehmen: nichts doppelt
    await page.locator('.kasse-sichern input[type=file]').setInputFiles({ name: 'Buerokasse-Sicherung.txt', mimeType: 'text/plain', buffer: Buffer.from(sicherung) });
    await toast(page, '0 neue Einträge übernommen, 7 waren schon da');
    assert.equal(JSON.stringify(await dateien()).split('.json').length - 1, 7);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Kassenbuch als PDF' }).click();
    assert.match((await download).suggestedFilename(), /^Kassenbuch_\d{4}-\d\d\.pdf$/);
    assert.deepEqual(errors, []);
    console.log('PASS 1440: Vom Handy übernehmen → Bürokasse-Ordner, doppelt übernehmen harmlos, PDF');
  }
} finally { await browser.close(); server.close(); }
