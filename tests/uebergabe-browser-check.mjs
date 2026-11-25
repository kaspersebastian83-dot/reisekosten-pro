// Übergabe Handy → PC im echten Browser (seit 1.18.0): Das Handy sendet seine Einträge als Datei („An den PC senden“), der PC
// fügt sie hinzu („Vom Handy übernehmen“) und ersetzt nichts. Das Teilen-Menü ist nachgebildet und fängt die Datei ab.
// Geprüft: Zähler, Vermerk und Marken an den Zeilen auf dem Handy, abgebrochenes Teilen vermerkt nichts, Vorschau und Übernahme am PC samt
// Belegbild, zweite Übernahme ändert nichts, geänderter Eintrag meldet die Abweichung, fremde Dateien werden abgelehnt.
// npm run build && node tests/uebergabe-browser-check.mjs
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
    if (pathname.includes('/tesseract/')) throw Error();   // Belegerkennung hier nicht nötig
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
const bilder = (page) => page.evaluate(() => new Promise((resolve) => { const r = indexedDB.open('spesenkit-belege'); r.onsuccess = () => { if (!r.result.objectStoreNames.contains('belege')) { r.result.close(); resolve([]); return; } const g = r.result.transaction('belege').objectStore('belege').getAllKeys(); g.onsuccess = () => { r.result.close(); resolve(g.result.map(String)); }; }; r.onerror = () => resolve([]); }));
const until = async (fn, what) => { for (let i = 0; i < 100; i++) { const value = await fn(); if (value) return value; await new Promise((r) => setTimeout(r, 100)); } throw Error(`Zeitüberschreitung: ${what}`); };
// Nachgebildetes Teilen-Menü: nimmt Textdateien an und merkt sich ihren Inhalt; __abbrechen schließt es ohne Auswahl.
const teilenMenue = () => {
  window.__geteilt = []; window.__abbrechen = false;
  Object.defineProperty(navigator, 'canShare', { configurable: true, value: (data) => !!data?.files?.length });
  Object.defineProperty(navigator, 'share', { configurable: true, value: async (data) => {
    if (window.__abbrechen) throw new DOMException('Share canceled', 'AbortError');
    window.__geteilt.push({ name: data.files[0].name, type: data.files[0].type, text: await data.files[0].text() });
  } });
};
const offen = async (context) => {
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.clock.setFixedTime(new Date('2026-10-18T10:00:00Z'));
  await page.goto(url + '?demo=1'); await page.getByRole('heading', { name: 'Monatsübersicht', exact: true }).waitFor();
  const nav = async (name) => { if (await page.getByRole('button', { name: 'Menü öffnen', exact: true }).isVisible()) await page.getByRole('button', { name: 'Menü öffnen', exact: true }).click(); await page.locator('.sidebar nav').getByRole('button', { name: new RegExp('^' + name) }).click(); };
  return { page, errors, nav };
};

try {
  /* ---------- Handy ---------- */
  const handyContext = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, timezoneId: 'Europe/Berlin' });
  await handyContext.addInitScript(teilenMenue);
  const handy = await offen(handyContext);
  const hp = handy.page;
  const zeile = hp.locator('.folder-banner');
  const karte = hp.getByRole('region', { name: 'An den PC senden' });
  const geteilt = () => hp.evaluate(() => window.__geteilt);
  let bestandHandy, erste;

  await check('Handy: Datensicherung zeigt „An den PC senden“ statt „Vom Handy übernehmen“; ohne Einträge nichts zu senden', async () => {
    await handy.nav('Datensicherung');
    await karte.waitFor();
    assert.equal(await hp.getByRole('region', { name: 'Vom Handy übernehmen' }).count(), 0);
    assert.match(await karte.innerText(), /Noch nichts erfasst\./);
    assert.equal(await karte.getByRole('button', { name: 'An den PC senden', exact: true }).isDisabled(), true);
  });
  await check('Handy: mit Einträgen zählen Zeile und Karte, was noch nicht gesendet ist', async () => {
    await hp.getByRole('button', { name: 'Demo-Daten laden', exact: true }).click();
    await until(async () => (await stored(hp))?.trips?.length, 'Demo-Daten');
    // dazu ein Belegfoto im Eingang (die Demo-Daten haben keine Bilder)
    await handy.nav('Monatsübersicht');
    await hp.getByRole('navigation', { name: 'Schnell erfassen' }).getByRole('button', { name: 'Belegfoto', exact: true }).click();
    const png = Buffer.from(await hp.evaluate(() => { const c = document.createElement('canvas'); c.width = 60; c.height = 90; const g = c.getContext('2d'); g.fillStyle = 'white'; g.fillRect(0, 0, 60, 90); g.fillStyle = 'black'; g.fillRect(10, 10, 40, 6); return c.toDataURL('image/png').split(',')[1]; }), 'base64');
    await hp.locator('.receipt-capture input[type=file]').first().setInputFiles({ name: 'bon.png', mimeType: 'image/png', buffer: png });
    await hp.getByText('Die automatische Erkennung war nicht möglich.', { exact: false }).waitFor({ timeout: 30000 });
    await hp.getByRole('button', { name: 'Nur im Eingang speichern', exact: true }).click();
    bestandHandy = await until(async () => { const s = await stored(hp); return s?.receiptInbox?.length === 1 ? s : null; }, 'Beleg im Eingang');
    await handy.nav('Datensicherung');
    const n = bestandHandy.trips.length + bestandHandy.expenses.length + bestandHandy.receiptInbox.length;
    await until(async () => (await karte.innerText()).includes(`${n} Einträge noch nicht gesendet.`), 'Zähler in der Karte');
    assert.match(await zeile.innerText(), new RegExp(`${n} Einträge noch nicht gesendet\\s*Bisher nur auf diesem Gerät\\.`));
  });
  await check('Handy: Teilen-Menü ohne Auswahl geschlossen → nichts gilt als gesendet', async () => {
    await hp.evaluate(() => { window.__abbrechen = true; });
    await karte.getByRole('button', { name: 'An den PC senden', exact: true }).click();
    await hp.getByText('Nicht geteilt – das Teilen-Menü wurde geschlossen.', { exact: false }).waitFor();
    assert.equal(await hp.evaluate(() => localStorage.getItem('spesenkit-uebergabe-gesendet')), null);
    assert.match(await karte.innerText(), /Einträge noch nicht gesendet\./);
    await hp.evaluate(() => { window.__abbrechen = false; });
  });
  await check('Handy: „An den PC senden“ gibt eine Datei an das Teilen-Menü; danach ist alles gesendet, die Einträge bleiben', async () => {
    await karte.getByRole('button', { name: 'An den PC senden', exact: true }).click();
    await until(async () => (await geteilt()).length === 1, 'Datei geteilt');
    erste = (await geteilt())[0];
    assert.match(erste.name, /^SpesenKit-Uebergabe_2026-10-18_\d{4}\.txt$/);
    assert.equal(erste.type, 'text/plain');
    const inhalt = JSON.parse(erste.text);
    assert.deepEqual([inhalt.format, inhalt.version, inhalt.trips.length, inhalt.expenses.length], ['spesenkit-uebergabe', 1, bestandHandy.trips.length, bestandHandy.expenses.length]);
    assert.equal(inhalt.settings, undefined, 'keine Einstellungen in der Übergabe');
    assert.ok(Object.keys(inhalt.belege).length >= 1, 'Belegbilder liegen bei');
    await until(async () => /Alles gesendet\.\s*Zuletzt gesendet: 18\.10\.2026\./.test(await karte.innerText()), 'Karte: alles gesendet');
    assert.match(await zeile.innerText(), /Alles an den PC gesendet\s*Zuletzt an den PC gesendet: 18\.10\.2026/);
    assert.equal(await zeile.getByRole('button').count(), 0);
    assert.equal(await karte.getByRole('button', { name: 'An den PC senden', exact: true }).isDisabled(), true);
    assert.equal((await stored(hp)).trips.length, bestandHandy.trips.length, 'Einträge bleiben auf dem Handy');
  });
  await check('Handy: eine Reise geändert → genau 1 Eintrag wieder offen; gesendet wird nur dieser', async () => {
    await handy.nav('Monatsübersicht'); await hp.getByRole('button', { name: /^Jul/ }).click();
    // Zeitleiste: nach dem Senden trägt jede Zeile „gesendet“
    const marken = () => hp.locator('.month-timeline .timeline-sent').allInnerTexts();
    assert.ok((await marken()).length >= 10 && (await marken()).every((text) => text === 'gesendet'), 'alle Zeilen gesendet');
    await hp.locator('.month-timeline').getByRole('button', { name: /Bonn/ }).first().click();
    const km = hp.locator('.modal').getByLabel(/Dienstliche Kilometer|Kilometer \(dienstlich\)|Dienstlich gefahren/).first();
    if (!(await km.count())) await hp.locator('.modal').getByText('Weitere Angaben', { exact: false }).click();
    const feld = hp.locator('.modal').getByLabel('Reiseziel *', { exact: false }).first();
    await feld.fill('Bonn-Beuel'); await feld.blur();
    await hp.locator('.modal').getByRole('button', { name: /Speichern & fertig|Änderungen speichern|Speichern/ }).last().click();
    await until(async () => (await stored(hp)).trips.some((t) => t.destination === 'Bonn-Beuel'), 'Reise geändert');
    await until(async () => /1 Eintrag noch nicht gesendet/.test(await zeile.innerText()), 'Zeile: 1 Eintrag offen');
    assert.deepEqual((await marken()).filter((text) => text !== 'gesendet'), ['geändert – noch nicht gesendet']);
    assert.match(await hp.locator('.month-timeline').getByRole('button', { name: /Bonn-Beuel/ }).innerText(), /geändert – noch nicht gesendet/);
    // auch im Namen des Knopfs (Vorlesehilfe), nicht nur sichtbar
    assert.match(await hp.locator('.month-timeline').getByRole('button', { name: /Bonn-Beuel/ }).getAttribute('aria-label'), /bearbeiten, geändert – noch nicht gesendet$/);
    assert.ok((await hp.locator('.month-timeline .timeline-entry.expense').first().getAttribute('aria-label')).endsWith('bearbeiten, gesendet'));
    assert.equal(await hp.evaluate(() => document.documentElement.scrollWidth), 390, 'nichts ragt seitlich heraus');
    await zeile.getByRole('button', { name: 'Senden', exact: true }).click();
    await until(async () => (await geteilt()).length === 2, 'zweite Datei');
    const zweite = JSON.parse((await geteilt())[1].text);
    assert.deepEqual([zweite.trips.length, zweite.expenses.length, zweite.receiptInbox.length, zweite.trips[0].destination], [1, 0, 0, 'Bonn-Beuel']);
    await until(async () => (await marken()).every((text) => text === 'gesendet'), 'wieder alles gesendet');
  });
  await check('Handy: Hinweis im Abschlussbereich – abgeschlossen wird am PC', async () => {
    assert.match(await hp.locator('.month-entry-workspace').innerText(), /Abschluss am PC – dort liegen alle Einträge\./);
  });
  assert.deepEqual(handy.errors, []);
  const dateien = await geteilt();
  await handyContext.close();

  /* ---------- PC ---------- */
  const pc = await offen(await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Europe/Berlin' }));
  const pp = pc.page;
  const pcKarte = pp.getByRole('region', { name: 'Vom Handy übernehmen' });
  const dialog = pp.getByRole('dialog', { name: 'Vom Handy übernehmen' });
  const waehlen = async (name, text) => { const wahl = pp.waitForEvent('filechooser'); await pcKarte.getByRole('button', { name: 'Datei vom Handy wählen', exact: true }).click(); await (await wahl).setFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(text, 'utf8') }); };

  await check('PC: Datensicherung zeigt „Vom Handy übernehmen“; kein Abschluss-Hinweis, kein „An den PC senden“', async () => {
    assert.doesNotMatch(await pp.locator('.month-entry-workspace').innerText(), /Abschluss am PC/);
    assert.equal(await pp.locator('.timeline-sent').count(), 0, 'am PC keine Sende-Marken');
    // eigener Bestand am PC: eine Reise, die erhalten bleiben muss
    await pp.locator('.month-entry-workspace').getByRole('button', { name: 'Dienstreise erfassen', exact: true }).click();
    const m = pp.locator('.modal');
    await m.getByLabel('Projekt *', { exact: false }).fill('26.0999 Aachen'); await m.getByLabel('Reisegrund *', { exact: false }).fill('PC-Reise'); await m.getByLabel('Reiseziel *', { exact: false }).fill('Aachen');
    await m.getByRole('button', { name: 'Speichern & fertig', exact: true }).click();
    await until(async () => (await stored(pp))?.trips?.length === 1, 'PC-Reise gespeichert');
    await pc.nav('Datensicherung'); await pcKarte.waitFor();
    assert.equal(await pp.getByRole('region', { name: 'An den PC senden' }).count(), 0);
    assert.match(await pcKarte.innerText(), /nicht ersetzt/);
  });
  await check('PC: fremde Dateien werden mit verständlicher Meldung abgelehnt', async () => {
    await waehlen('irgendwas.txt', 'kein json');
    await pp.getByText('Die Datei ist keine SpesenKit-Übergabe (kein lesbarer Inhalt).', { exact: false }).waitFor();
    await waehlen('sicherung.json', JSON.stringify(await stored(pp)));
    await pp.getByText('Das ist eine vollständige JSON-Sicherung, keine Übergabe vom Handy.', { exact: false }).waitFor();
    assert.equal(await dialog.count(), 0);
  });
  await check('PC: Vorschau nennt, was dazukommt; Abbrechen ändert nichts', async () => {
    await waehlen(dateien[0].name, dateien[0].text);
    await dialog.waitFor();
    const text = await dialog.innerText();
    assert.match(text.replace(/\s+/g, ' '), new RegExp(`Reisen ${bestandHandy.trips.length} Kosten ${bestandHandy.expenses.length} Belege im Eingang ${bestandHandy.receiptInbox.length}`));
    assert.match(text, /kommen als „ungeprüft“ an/);
    assert.match(text, /Auf dem Handy gelöschte Einträge werden hier nicht gelöscht\./);
    await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
    assert.equal((await stored(pp)).trips.length, 1);
  });
  await check('PC: „Übernehmen“ fügt hinzu – die eigene Reise bleibt, Belegbilder sind gespeichert, ein Protokolleintrag', async () => {
    await waehlen(dateien[0].name, dateien[0].text);
    await dialog.getByRole('button', { name: 'Übernehmen', exact: true }).click();
    const danach = await until(async () => { const s = await stored(pp); return s.trips.length === bestandHandy.trips.length + 1 ? s : null; }, 'übernommen');
    assert.ok(danach.trips.some((t) => t.purpose === 'PC-Reise'), 'Reise vom PC bleibt');
    assert.equal(danach.expenses.length, bestandHandy.expenses.length);
    assert.ok(danach.trips.filter((t) => t.purpose !== 'PC-Reise').every((t) => t.status === 'ungeprüft' || t.status === 'storniert'));
    assert.equal(danach.changes[0].field, 'Vom Handy übernommen');
    await pp.locator('.toast').getByText('Vom Handy übernommen:', { exact: false }).waitFor();
    const erwartet = Object.keys(JSON.parse(dateien[0].text).belege);
    const da = await until(async () => { const keys = await bilder(pp); return erwartet.every((id) => keys.includes(id)) ? keys : null; }, 'Belegbilder gespeichert');
    assert.ok(da.length >= erwartet.length);
  });
  await check('PC: dieselbe Datei noch einmal → „Nichts Neues“, kein Übernehmen-Knopf', async () => {
    const vorher = await stored(pp);
    await waehlen(dateien[0].name, dateien[0].text);
    await dialog.waitFor();
    assert.match(await dialog.innerText(), /Nichts Neues\./);
    assert.equal(await dialog.getByRole('button', { name: 'Übernehmen', exact: true }).count(), 0);
    await dialog.getByRole('button', { name: 'Schließen', exact: true }).last().click();
    assert.deepEqual((await stored(pp)).trips.map((t) => t.id), vorher.trips.map((t) => t.id));
  });
  await check('PC: auf dem Handy geänderte Reise → Abweichung mit Feld, der Stand am PC bleibt', async () => {
    await waehlen(dateien[1].name, dateien[1].text);
    await dialog.waitFor();
    assert.match(await dialog.innerText(), /Abweichungen – der Stand hier bleibt[\s\S]*Bonn: weicht ab \(Reiseziel\) – der vorhandene Eintrag bleibt\./);
    await dialog.getByRole('button', { name: 'Schließen', exact: true }).last().click();
    assert.equal((await stored(pp)).trips.some((t) => t.destination === 'Bonn-Beuel'), false);
  });
  assert.deepEqual(pc.errors, []);
} finally { await browser.close(); server.close(); }
