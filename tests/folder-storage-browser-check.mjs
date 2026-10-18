// Synthetischer Browsercheck für den persönlichen SpesenKit-Ordner (lokaler Produktionsbuild, vorhandenes Playwright).
// npm run build && PLAYWRIGHT_MODULE=/absolute/path/to/playwright BROWSER_EXECUTABLE=/path/to/chromium node tests/folder-storage-browser-check.mjs
// Der "Mitarbeiterordner" ist das private Dateisystem (OPFS) eines frischen Browserprofils; echte Ordner/Profile
// werden nie berührt. Ordnerauswahl, Berechtigungsabfrage und Schreibfehler werden im Testprofil simuliert.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
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
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' })[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }).end(body);
  } catch { res.writeHead(404).end('Not found'); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/reisekosten-pro/`;
const browser = await engines.chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
const output = await mkdtemp(path.join(tmpdir(), 'spesenkit-ordner-'));
const check = async (name, fn) => { await fn(); console.log('PASS', name); };

// Simulierte Ordnerauswahl und Berechtigungen; Steuerung über localStorage (überlebt Neuladen).
const harness = () => {
  const flag = (key) => localStorage.getItem(key);
  window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('Max Mustermann', { create: true });
  FileSystemHandle.prototype.queryPermission = async function () { return flag('test-perm') || 'granted'; };
  FileSystemHandle.prototype.requestPermission = async function () { localStorage.removeItem('test-perm'); return 'granted'; };
  const original = FileSystemFileHandle.prototype.createWritable;
  FileSystemFileHandle.prototype.createWritable = async function (...args) {
    if (flag('test-fail-write') && this.name === 'spesenkit.json') throw new DOMException('Netzlaufwerk nicht erreichbar', 'InvalidStateError');
    return original.apply(this, args);
  };
};
const readFolder = (page) => page.evaluate(async () => {
  try {
    const app = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('Max Mustermann')).getDirectoryHandle('SpesenKit');
    const data = await app.getDirectoryHandle('Daten');
    const text = async (dir, name) => { try { return await (await (await dir.getFileHandle(name)).getFile()).text(); } catch { return null; } };
    const copies = [];
    try { for await (const [name, handle] of (await app.getDirectoryHandle('Sicherungen')).entries()) copies.push({ name, text: await (await handle.getFile()).text() }); } catch { /* none */ }
    return { file: JSON.parse(await text(data, 'spesenkit.json')), previous: await text(data, 'spesenkit.vorher.json'), copies };
  } catch { return null; }
});
// Ein anderer Terminalserver schreibt eine neuere Revision.
const writeExternally = (page, mutate) => page.evaluate(async (source) => {
  const data = await (await (await (await navigator.storage.getDirectory()).getDirectoryHandle('Max Mustermann')).getDirectoryHandle('SpesenKit')).getDirectoryHandle('Daten');
  const handle = await data.getFileHandle('spesenkit.json');
  const file = JSON.parse(await (await handle.getFile()).text());
  // eslint-disable-next-line no-new-func
  new Function('file', source)(file);
  file.revision += 1; file.savedAt = new Date().toISOString();
  const w = await handle.createWritable(); await w.write(JSON.stringify(file)); await w.close();
  return file.revision;
}, mutate);
const idbState = (page) => page.evaluate(() => new Promise((resolve, reject) => { const r = indexedDB.open('reisekosten-pro', 1); r.onsuccess = () => { const g = r.result.transaction('state').objectStore('state').get('main'); g.onsuccess = () => { r.result.close(); resolve(g.result); }; g.onerror = () => reject(g.error); }; r.onerror = () => reject(r.error); }));
const writeIdb = (page, value) => page.evaluate((value) => new Promise((resolve, reject) => { const r = indexedDB.open('reisekosten-pro', 1); r.onsuccess = () => { const tx = r.result.transaction('state', 'readwrite'); tx.objectStore('state').put(value, 'main'); tx.oncomplete = () => { r.result.close(); resolve(); }; tx.onerror = () => reject(tx.error); }; }), value);
const until = async (fn, what) => { for (let i = 0; i < 100; i++) { const value = await fn(); if (value) return value; await new Promise((r) => setTimeout(r, 100)); } throw Error(`Zeitüberschreitung: ${what}`); };
const nav = async (page, name) => { if (await page.getByRole('button', { name: 'Menü öffnen', exact: true }).isVisible()) await page.getByRole('button', { name: 'Menü öffnen', exact: true }).click(); await page.locator('.sidebar nav').getByRole('button', { name, exact: true }).click(); };
const folderStatus = (page) => page.locator('.storage-status').getAttribute('data-folder-status');
const ready = async (page) => { await page.getByRole('heading', { name: 'Monatsübersicht', exact: true }).waitFor(); await until(async () => (await folderStatus(page)) !== 'checking', 'Ordnerabgleich'); };
const fits = async (page) => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'horizontal overflow');
const tripIds = (state) => state.trips.map((t) => t.id);

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Europe/Berlin' });
  await context.addInitScript(harness);
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const banner = page.locator('.folder-banner');
  await page.goto(url); await ready(page);

  await check('ohne Ordner: deutlicher Hinweis, Verhalten wie bisher', async () => {
    assert.equal(await folderStatus(page), 'none');
    assert.match(await banner.innerText(), /nur in diesem Browser/);
    assert.equal(await readFolder(page), null);
  });

  await check('Ordner einrichten legt SpesenKit/Daten/spesenkit.json an', async () => {
    await banner.getByRole('button', { name: 'Ordner einrichten' }).click();
    await until(async () => (await folderStatus(page)) === 'ok', 'Status ok');
    const folder = await readFolder(page);
    assert.equal(folder.file.format, 'spesenkit-daten'); assert.equal(folder.file.revision, 1);
    assert.equal(await banner.count(), 0);
    assert.match(await page.locator('.storage-status').innerText(), /Im SpesenKit-Ordner gespeichert/);
  });

  await check('jede lokale Änderung landet im Ordner, vorheriger Stand bleibt als spesenkit.vorher.json', async () => {
    await nav(page, 'Datensicherung'); await page.getByRole('button', { name: 'Demo-Daten laden', exact: true }).click();
    const folder = await until(async () => { const f = await readFolder(page); return f?.file.state.trips.length ? f : null; }, 'Demo-Daten im Ordner');
    assert.equal(folder.file.revision, 2);
    assert.equal(JSON.parse(folder.previous).revision, 1);
    assert.deepEqual(tripIds(folder.file.state), tripIds(await idbState(page)));
    assert.match(await page.locator('.folder-card').innerText(), /verbunden/);
  });

  await check('neuerer Stand von einem anderen Terminalserver wird beim Start übernommen', async () => {
    const revision = await writeExternally(page, "file.state.trips.push({...file.state.trips[0], id:'server-b'})");
    await page.reload(); await ready(page);
    assert.equal(await folderStatus(page), 'ok');
    assert.ok(tripIds(await idbState(page)).includes('server-b'));
    assert.match(await page.locator('.toast').innerText(), /aus dem SpesenKit-Ordner geladen/);
    assert.equal((await readFolder(page)).file.revision, revision, 'beim Übernehmen nichts zurückgeschrieben');
  });

  await check('beidseitige Änderung: Konfliktdialog, „Browserstand behalten“ sichert den Ordnerstand als Kopie', async () => {
    await writeExternally(page, "file.state.trips.push({...file.state.trips[0], id:'server-c'})");
    const local = await idbState(page); local.settings.profileName = 'Lokal geändert';
    await nav(page, 'Einstellungen');
    await page.getByLabel('Name', { exact: true }).fill('Lokal geändert');
    await page.getByRole('button', { name: 'Einstellungen speichern', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Welcher Datenstand gilt?' });
    await dialog.waitFor();
    assert.match(await dialog.innerText(), /SpesenKit-Ordner/); assert.match(await dialog.innerText(), /Dieser Browser/);
    await dialog.screenshot({ path: path.join(output, 'konflikt-1440.png') });
    await dialog.getByRole('button', { name: 'Browserstand behalten' }).click();
    await until(async () => (await folderStatus(page)) === 'ok', 'Status ok nach Konflikt');
    const folder = await readFolder(page);
    assert.equal(folder.file.state.settings.profileName, 'Lokal geändert');
    assert.ok(!tripIds(folder.file.state).includes('server-c'));
    const copy = folder.copies.find((c) => c.name.startsWith('spesenkit_ordnerstand_'));
    assert.ok(copy && JSON.parse(copy.text).trips.some((t) => t.id === 'server-c'), 'Ordnerstand als wiederherstellbare Kopie');
  });

  await check('beidseitige Änderung: „Ordnerstand übernehmen“ sichert den Browserstand als Kopie', async () => {
    await writeExternally(page, "file.state.trips.push({...file.state.trips[0], id:'server-d'})");
    await page.getByLabel('Name', { exact: true }).fill('Zweite lokale Änderung');
    await page.getByRole('button', { name: 'Einstellungen speichern', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Welcher Datenstand gilt?' });
    await dialog.getByRole('button', { name: 'Ordnerstand übernehmen' }).click();
    await until(async () => (await folderStatus(page)) === 'ok', 'Status ok nach Übernahme');
    const local = await idbState(page);
    assert.ok(tripIds(local).includes('server-d')); assert.equal(local.settings.profileName, 'Lokal geändert');
    const copy = (await readFolder(page)).copies.find((c) => c.name.startsWith('spesenkit_browserstand_'));
    assert.equal(JSON.parse(copy.text).settings.profileName, 'Zweite lokale Änderung');
  });

  await check('Schreibfehler im Ordner wird angezeigt und lässt sich wiederholen', async () => {
    await page.reload(); await ready(page);
    await page.evaluate(() => localStorage.setItem('test-fail-write', '1'));
    await nav(page, 'Einstellungen');
    await page.getByLabel('Name', { exact: true }).fill('Während Ausfall');
    await page.getByRole('button', { name: 'Einstellungen speichern', exact: true }).click();
    await until(async () => (await folderStatus(page)) === 'error', 'Fehlerstatus');
    assert.match(await banner.innerText(), /nicht im SpesenKit-Ordner gespeichert/);
    assert.equal((await idbState(page)).settings.profileName, 'Während Ausfall', 'im Browser gespeichert');
    assert.notEqual((await readFolder(page)).file.state.settings.profileName, 'Während Ausfall');
    await page.evaluate(() => localStorage.removeItem('test-fail-write'));
    await banner.getByRole('button', { name: 'Erneut speichern' }).click();
    await until(async () => (await readFolder(page))?.file.state.settings.profileName === 'Während Ausfall', 'nachgeholtes Speichern');
    assert.equal(await folderStatus(page), 'ok');
  });

  // Synthetischer Abschlussmonat wie im Abschluss-Browsercheck.
  const seed = await idbState(page);
  const trip = (id, date) => ({ ...seed.trips[0], id, date, endDate: date, startTime: '08:00', endTime: '17:00', destination: 'Musterstadt', purpose: 'Synthetischer Termin', order: '26.0123 Musterstadt', businessKm: 0, privateKm: 0, tripType: 'dienstlich', absenceConfirmed: true, manualAbsenceMinutes: undefined, overnight: false, status: 'geprüft', warnings: [], meals: { breakfast: false, lunch: false, dinner: false }, dailyMeals: {} });
  seed.trips = [trip('juni-trip', '2026-06-10'), trip('juli-trip', '2026-07-08')];
  seed.expenses = []; seed.statements = []; seed.changes = []; seed.receiptInbox = []; seed.merchantRules = [];
  await writeIdb(page, seed); await page.reload(); await ready(page);
  const workspace = page.getByRole('region', { name: 'Monatsarbeitsbereich', exact: true });
  const review = page.getByRole('region', { name: 'Abschlussprüfung', exact: true });
  const closing = page.getByRole('dialog', { name: /Monatsabrechnung/ });
  const closeMonth = async (month) => {
    await page.locator('input[type=month]').fill(month);
    await workspace.getByRole('button', { name: 'Spesenabrechnung erstellen', exact: true }).click();
    await review.getByRole('button', { name: 'Monatsabrechnung abschließen', exact: true }).click();
    for (const box of await closing.getByRole('checkbox').all()) await box.check();
    await closing.getByRole('button', { name: 'Verbindlich abschließen', exact: true }).click();
  };

  await check('Abschluss meldet Erfolg erst, wenn er im Ordner gespeichert ist', async () => {
    assert.equal(await folderStatus(page), 'ok', 'lokal geänderter Stand wurde beim Start in den Ordner geschrieben');
    await closeMonth('2026-06');
    await until(async () => /im SpesenKit-Ordner gespeichert/.test(await page.locator('.toast').innerText({ timeout: 500 }).catch(() => '')), 'Erfolgsmeldung');
    const folder = await readFolder(page);
    assert.equal(folder.file.state.statements.find((s) => s.month === '2026-06').locked, true);
  });

  await check('Abschluss bei nicht beschreibbarem Ordner: keine Erfolgsmeldung, klare Anzeige, nachholbar', async () => {
    await page.evaluate(() => localStorage.setItem('test-fail-write', '1'));
    await closeMonth('2026-07');
    // Die Version ist lokal gesperrt, der Abschlussdialog schließt; die Meldung steht im Fehlerfeld oben.
    const alert = page.locator('.error-box');
    await until(async () => (await alert.count()) && /im Browser gespeichert, aber noch nicht im SpesenKit-Ordner/.test(await alert.innerText()), 'Fehlermeldung');
    assert.doesNotMatch(await page.locator('.toast').innerText({ timeout: 500 }).catch(() => ''), /abgeschlossen/);
    assert.equal((await idbState(page)).statements.find((s) => s.month === '2026-07').locked, true, 'im Browser abgeschlossen');
    assert.equal((await readFolder(page)).file.state.statements.some((s) => s.month === '2026-07'), false);
    assert.match(await banner.innerText(), /nicht im SpesenKit-Ordner gespeichert/);
    await page.evaluate(() => localStorage.removeItem('test-fail-write'));
    await banner.getByRole('button', { name: 'Erneut speichern' }).click();
    await until(async () => (await readFolder(page))?.file.state.statements.find((s) => s.month === '2026-07')?.locked, 'Abschluss im Ordner nachgeholt');
  });

  await check('nach Neustart ohne Berechtigung: Zugriff bestätigen, Abschluss bis dahin gesperrt', async () => {
    await page.evaluate(() => localStorage.setItem('test-perm', 'prompt'));
    await page.reload(); await ready(page);
    assert.equal(await folderStatus(page), 'permission');
    assert.match(await banner.innerText(), /Zugriff auf deinen SpesenKit-Ordner/);
    await page.locator('input[type=month]').fill('2026-05');
    await banner.getByRole('button', { name: 'Zugriff bestätigen' }).click();
    await until(async () => (await folderStatus(page)) === 'ok', 'Status ok nach Bestätigung');
  });

  await check('neues Browserprofil/anderer Server: gleicher Ordner gewählt, alles wieder da', async () => {
    const before = await readFolder(page);
    await page.goto(url + 'favicon.svg');
    await page.evaluate(() => Promise.all(['reisekosten-pro', 'mosaik-suite'].map((name) => new Promise((resolve, reject) => { const r = indexedDB.deleteDatabase(name); r.onsuccess = resolve; r.onerror = () => reject(r.error); r.onblocked = () => reject(Error('blocked ' + name)); }))));
    await page.goto(url); await ready(page);
    assert.equal(await folderStatus(page), 'none');
    await banner.getByRole('button', { name: 'Ordner einrichten' }).click();
    await until(async () => (await folderStatus(page)) === 'ok', 'Status ok');
    const local = await idbState(page);
    assert.deepEqual(tripIds(local), tripIds(before.file.state));
    assert.deepEqual(local.statements.map((s) => [s.month, s.locked]), before.file.state.statements.map((s) => [s.month, s.locked]));
    assert.equal((await readFolder(page)).file.revision, before.file.revision, 'leerer Browser hat die Datei nicht überschrieben');
  });

  await check('plötzlich leerer Browser bei bekanntem Ordner: keine automatische Leerung der Datei', async () => {
    const before = await readFolder(page);
    await page.goto(url + 'favicon.svg');
    await page.evaluate(() => new Promise((resolve, reject) => { const r = indexedDB.deleteDatabase('reisekosten-pro'); r.onsuccess = resolve; r.onerror = () => reject(r.error); r.onblocked = () => reject(Error('blocked')); }));
    await page.goto(url); await page.getByRole('heading', { name: 'Monatsübersicht', exact: true }).waitFor();
    const dialog = page.getByRole('dialog', { name: 'Welcher Datenstand gilt?' });
    await dialog.waitFor();
    assert.equal((await readFolder(page)).file.revision, before.file.revision);
    await dialog.getByRole('button', { name: 'Ordnerstand übernehmen' }).click();
    await until(async () => (await folderStatus(page)) === 'ok', 'Status ok');
    assert.deepEqual(tripIds(await idbState(page)), tripIds(before.file.state));
  });

  assert.deepEqual(errors, []);
  await context.close();

  for (const viewport of [{ width: 390, height: 844 }, { width: 820, height: 1180 }, { width: 1440, height: 1000 }]) {
    await check(`Layout ${viewport.width}px: Hinweis, Ordnerkarte und Konfliktdialog ohne Überlauf`, async () => {
      const ctx = await browser.newContext({ viewport, timezoneId: 'Europe/Berlin' });
      await ctx.addInitScript(harness);
      const p = await ctx.newPage(); await p.goto(url); await ready(p);
      await fits(p); await p.screenshot({ path: path.join(output, `hinweis-${viewport.width}.png`) });
      await p.locator('.folder-banner').getByRole('button', { name: 'Ordner einrichten' }).click();
      await until(async () => (await folderStatus(p)) === 'ok', 'ok');
      await nav(p, 'Datensicherung'); await fits(p);
      await p.locator('.folder-card').screenshot({ path: path.join(output, `ordnerkarte-${viewport.width}.png`) });
      await p.getByRole('button', { name: 'Demo-Daten laden', exact: true }).click();
      await until(async () => (await readFolder(p))?.file.revision === 2, 'rev 2');
      await writeExternally(p, "file.state.trips.push({...file.state.trips[0], id:'x'})");
      await p.getByRole('button', { name: 'Demo-Daten laden', exact: true }).click();
      const dialog = p.getByRole('dialog', { name: 'Welcher Datenstand gilt?' }); await dialog.waitFor();
      await fits(p); assert.equal(await dialog.evaluate((el) => el.scrollWidth > el.clientWidth), false);
      await p.screenshot({ path: path.join(output, `konflikt-${viewport.width}.png`) });
      await ctx.close();
    });
  }
  console.log('Screenshots:', output);
} finally {
  await browser.close(); server.close();
}
