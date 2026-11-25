// Handy (seit 1.16.0): schlanke, deckende Kopfzeile; Arbeitsbereich im Inhalt statt in der mitlaufenden Kopfzeile;
// Formularfelder mit 16 px Schrift (darunter zoomt das iPhone beim Antippen) und 48 px Höhe. Am PC unverändert.
// npm run build && node tests/handy-kopf-browser-check.mjs
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
const kopf = (page) => page.evaluate(() => {
  const bar = document.querySelector('.topbar'), style = getComputedStyle(bar);
  const sichtbar = (el) => !!el && el.getClientRects().length > 0;
  return { hoehe: Math.round(bar.getBoundingClientRect().height), grund: style.backgroundColor, position: style.position,
    chipImKopf: sichtbar(bar.querySelector('.modus-chip')), chipImInhalt: sichtbar(document.querySelector('.content .modus-inhalt .modus-chip')),
    breite: document.documentElement.scrollWidth, titel: document.querySelector('.topbar h1').scrollWidth <= document.querySelector('.topbar h1').clientWidth };
});
try {
  for (const width of [390, 360]) {
    const context = await browser.newContext({ viewport: { width, height: 780 }, isMobile: true, hasTouch: true, timezoneId: 'Europe/Berlin' });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.clock.setFixedTime(new Date('2026-10-18T10:00:00Z'));   // Vorgabe-Monat September: der längste Monatsname
    await page.goto(url); await page.getByRole('heading', { name: 'Monatsübersicht', exact: true }).waitFor();
    await check(`${width}: Kopfzeile eine Zeile, deckend, Arbeitsbereich im Inhalt`, async () => {
      const k = await kopf(page);
      assert.ok(k.hoehe <= 64, `Kopfzeile ${k.hoehe}px`);
      assert.equal(k.grund, 'rgb(255, 255, 255)');
      assert.equal(k.position, 'sticky');
      assert.deepEqual([k.chipImKopf, k.chipImInhalt], [false, true]);
      assert.equal(k.breite, width, 'nichts ragt seitlich heraus');
      assert.equal(k.titel, true, 'Titel „Monatsübersicht“ ungekürzt');
      await page.getByLabel('Abrechnungsmonat', { exact: true }).waitFor();   // Beschriftung bleibt für Vorlesehilfen
    });
    await check(`${width}: Arbeitsbereich lässt sich im Inhalt umschalten`, async () => {
      const bereich = page.getByRole('radiogroup', { name: 'Arbeitsbereich' });
      assert.equal(await bereich.count(), 1, 'genau eine sichtbare Auswahl');
      await bereich.getByRole('radio', { name: 'Innendienst', exact: true }).click();
      assert.equal(await bereich.getByRole('radio', { name: 'Innendienst', exact: true }).getAttribute('aria-checked'), 'true');
      await bereich.getByRole('radio', { name: 'Außendienst', exact: true }).click();
    });
    await check(`${width}: Formularfelder 16 px Schrift und mindestens 48 px hoch`, async () => {
      for (const knopf of [/Dienstreise erfassen/, /Sonstige Kosten/]) {
        await page.locator('.month-entry-workspace').getByRole('button', { name: knopf }).first().click();
        const felder = await page.locator('.modal').evaluate((modal) => [...modal.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=file]), select, textarea')]
          .filter((el) => el.getClientRects().length).map((el) => ({ name: el.name || el.type || el.tagName, schrift: parseFloat(getComputedStyle(el).fontSize), hoehe: Math.round(el.getBoundingClientRect().height) })));
        assert.ok(felder.length >= 6, String(knopf));
        for (const feld of felder) { assert.ok(feld.schrift >= 16, `${knopf}: ${feld.name} ${feld.schrift}px`); assert.ok(feld.hoehe >= 48, `${knopf}: ${feld.name} ${feld.hoehe}px hoch`); }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
        // Speicherleiste (seit 1.17.1): bündig am unteren Fensterrand, kein Streifen mit durchlaufendem Inhalt darunter.
        const rand = await page.locator('.modal').evaluate((modal) => { const leiste = modal.querySelector('.modal-body > .modal-actions').getBoundingClientRect(), fenster = modal.getBoundingClientRect(); return [Math.round(leiste.bottom), Math.round(fenster.bottom), Math.round(leiste.left), Math.round(leiste.right)]; });
        assert.deepEqual(rand, [780, 780, 0, width], `${knopf}: Speicherleiste bündig`);
        const brutto = page.locator('.modal').getByLabel(/^Brutto/);
        if (await brutto.count()) {
          // Vorbelegte 0 wird beim Antippen markiert: die erste Ziffer ersetzt sie.
          assert.equal(await brutto.inputValue(), '0');
          await brutto.tap(); await page.waitForTimeout(150); await page.keyboard.type('5');
          assert.equal(await brutto.inputValue(), '5', 'Brutto: 0 ersetzt, nicht „05“ oder „50“');
          assert.equal(await brutto.getAttribute('inputmode'), 'decimal');
        }
        await page.locator('.modal').getByRole('button', { name: 'Abbrechen', exact: true }).click();
      }
    });
    assert.deepEqual(errors, []);
    await context.close();
  }
  const pc = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Europe/Berlin' });
  const page = await pc.newPage(); await page.goto(url); await page.getByRole('heading', { name: 'Monatsübersicht', exact: true }).waitFor();
  await check('PC: Kopfzeile und Arbeitsbereich unverändert', async () => {
    const k = await kopf(page);
    assert.equal(k.hoehe, 94);
    assert.deepEqual([k.chipImKopf, k.chipImInhalt], [true, false]);
    assert.equal(await page.getByRole('radiogroup', { name: 'Arbeitsbereich' }).count(), 1);
    // Fester Abstand zwischen Arbeitsbereich und Monatsfeld wie vor 1.16.0 (16 px), nicht zwei gleich große Lücken.
    const abstand = await page.evaluate(() => Math.round(document.querySelector('.topbar .top-actions').getBoundingClientRect().left - document.querySelector('.topbar .modus-chip').getBoundingClientRect().right));
    assert.equal(abstand, 16 + 16, 'Abstand Arbeitsbereich → Monatsfeld (16 px Rand + 16 px Lücke der Kopfzeile)');
  });
} finally { await browser.close(); server.close(); }
