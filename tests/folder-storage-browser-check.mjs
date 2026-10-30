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
import { handleShim } from './helpers/folder-harness.mjs';
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

const prepare = async (context) => { await context.addInitScript(harness); if (process.env.SANDBOX_HANDLE_SHIM) await context.addInitScript(handleShim); };

// Simulierte Ordnerauswahl und Berechtigungen; Steuerung über localStorage (überlebt Neuladen).
const harness = () => {
  const flag = (key) => localStorage.getItem(key);
  window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('Max Mustermann', { create: true });
  FileSystemHandle.prototype.queryPermission = async function () { return flag('test-perm') || 'granted'; };
  FileSystemHandle.prototype.requestPermission = async function () { localStorage.removeItem('test-perm'); return 'granted'; };
  const original = FileSystemFileHandle.prototype.createWritable;
  FileSystemFileHandle.prototype.createWritable = async function (...args) {
    const fail = flag('test-fail-write');
    if (fail && (fail === '1' ? this.name === 'spesenkit.json' : this.name.endsWith(fail))) throw new DOMException('Netzlaufwerk nicht erreichbar', 'InvalidStateError');
    // Ein unabhängiger Schreiber umgeht absichtlich den navigator.locks-Namensraum der App.
    if (flag('test-concurrent-save') && this.name.startsWith('spesenkit_vor_speichern_')) {
      localStorage.removeItem('test-concurrent-save');
      const root = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('Max Mustermann')).getDirectoryHandle('SpesenKit');
      const data = await root.getDirectoryHandle('Daten'), handle = await data.getFileHandle('spesenkit.json');
      const file = JSON.parse(await (await handle.getFile()).text());
      file.state.settings.profileName = 'Anderer Terminalserver'; file.revision += 1; file.savedAt = new Date().toISOString();
      const copies = await root.getDirectoryHandle('Sicherungen');
      const copy = await copies.getFileHandle(`spesenkit_speicherkandidat_2026-10-20_120000_${crypto.randomUUID()}.json`, { create: true });
      const w = await original.call(copy); const text = JSON.stringify(file.state); await w.write(text); await w.close();
      if (await (await copy.getFile()).text() !== text) throw Error('Synthetischer Kandidat nicht bestätigt');
      const external = await original.call(handle); await external.write(JSON.stringify(file)); await external.close();
    }
    const writable = await original.apply(this, args);
    if (flag('test-fail-candidate-close') && this.name.startsWith('spesenkit_speicherkandidat_')) {
      return { write: (data) => writable.write(data), abort: () => writable.abort(), close: async () => { throw new DOMException('Sicherung nicht geschlossen', 'InvalidStateError'); } };
    }
    return writable;
  };
};
// Abgelegte Dateien eines Monats: Name -> { size, lastModified, head }
const filedFiles = (page, year, month) => page.evaluate(async ({ year, month }) => {
  try {
    let dir = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('Max Mustermann')).getDirectoryHandle('SpesenKit');
    for (const part of ['Spesen', year, month]) dir = await dir.getDirectoryHandle(part);
    const files = {};
    for await (const [name, handle] of dir.entries()) { const f = await handle.getFile(); files[name] = { size: f.size, lastModified: f.lastModified, head: await f.slice(0, 4).text() }; }
    return files;
  } catch { return {}; }
}, { year, month });
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
  await prepare(context);
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const banner = page.locator('.folder-banner');
  await page.goto(url + '?demo=1'); await ready(page);

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
    // „Später entscheiden“: Hinweis bleibt sichtbar und führt zurück zur Entscheidung.
    await dialog.getByRole('button', { name: 'Später entscheiden' }).click();
    assert.match(await banner.innerText(), /Offene Entscheidung/);
    assert.equal(await folderStatus(page), 'conflict');
    await banner.getByRole('button', { name: 'Jetzt entscheiden' }).click();
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
    await until(async () => /im SpesenKit-Ordner gespeichert\. Abgelegt in SpesenKit\\Spesen\\2026\\06/.test(await page.locator('.toast').innerText({ timeout: 500 }).catch(() => '')), 'Erfolgsmeldung mit Ablage');
    const folder = await readFolder(page);
    assert.equal(folder.file.state.statements.find((s) => s.month === '2026-06').locked, true);
  });

  await check('Ablage nach dem Abschluss: PDF und ZIP in Spesen/2026/06, Excel nur auf Wunsch, nichts überschrieben', async () => {
    const files = await filedFiles(page, '2026', '06');
    assert.deepEqual(Object.keys(files).sort(), ['Reisekosten_2026-06_V01.pdf', 'Reisekosten_2026-06_V01.zip']);
    assert.equal(files['Reisekosten_2026-06_V01.pdf'].head, '%PDF'); assert.equal(files['Reisekosten_2026-06_V01.zip'].head.slice(0, 2), 'PK');
    const section = page.getByRole('region', { name: 'Ablage im SpesenKit-Ordner' });
    await page.locator('input[type=month]').fill('2026-06');
    await workspace.getByRole('button', { name: /^Abrechnung (fortsetzen|ansehen)$/ }).click();
    await until(async () => /abgelegt/.test(await section.innerText({ timeout: 1000 }).catch(() => '')), 'Ablageanzeige');
    assert.match(await section.innerText(), /SpesenKit\\Spesen\\2026\\06/);
    assert.equal(await section.getByRole('button', { name: 'Im SpesenKit-Ordner ablegen' }).count(), 0, 'nichts fehlt: ' + await section.innerText());
    // Excel zusätzlich wählen, dann in der Abrechnung nachträglich ablegen.
    await nav(page, 'Datensicherung');
    await page.locator('.filing-formats').getByLabel('Excel').check();
    await nav(page, 'Monatsübersicht'); await page.locator('input[type=month]').fill('2026-06');
    await workspace.getByRole('button', { name: /^Abrechnung (fortsetzen|ansehen)$/ }).click();
    await section.getByRole('button', { name: 'Im SpesenKit-Ordner ablegen' }).click();
    await until(async () => (await filedFiles(page, '2026', '06'))['Reisekosten_2026-06_V01.xlsx'], 'Excel abgelegt');
    const after = await filedFiles(page, '2026', '06');
    assert.equal(after['Reisekosten_2026-06_V01.xlsx'].head.slice(0, 2), 'PK');
    assert.deepEqual(after['Reisekosten_2026-06_V01.pdf'], files['Reisekosten_2026-06_V01.pdf'], 'PDF nicht neu geschrieben');
    assert.equal(await section.getByRole('button', { name: 'Abrechnung drucken' }).count(), 1);
    await section.screenshot({ path: path.join(output, 'ablage-1440.png') });
    await page.setViewportSize({ width: 390, height: 844 }); await fits(page);
    await section.screenshot({ path: path.join(output, 'ablage-390.png') });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('.filing-formats').count(); await nav(page, 'Datensicherung'); await page.locator('.filing-formats').getByLabel('Excel').uncheck();
    await nav(page, 'Monatsübersicht');
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
    // Die beim Abschluss nicht mögliche Ablage bleibt als Hinweis stehen und lässt sich nachholen.
    assert.deepEqual(await filedFiles(page, '2026', '07'), {});
    await until(async () => /noch nicht im SpesenKit-Ordner abgelegt/.test(await banner.innerText({ timeout: 500 }).catch(() => '')), 'Ablagehinweis');
    await banner.getByRole('button', { name: 'Erneut ablegen' }).click();
    await until(async () => Object.keys(await filedFiles(page, '2026', '07')).length === 2, 'Ablage Juli nachgeholt');
    await until(async () => (await banner.count()) === 0, 'Hinweis verschwindet');
  });

  await check('Fehler nur bei der Ablage: Abschluss bleibt gültig, Hinweis „Erneut ablegen“', async () => {
    const seeded = await idbState(page);
    seeded.trips.push({ ...seeded.trips[0], id: 'mai-trip', date: '2026-05-06', endDate: '2026-05-06' });
    await writeIdb(page, seeded); await page.reload(); await ready(page);
    await page.evaluate(() => localStorage.setItem('test-fail-write', 'V01.zip'));
    await closeMonth('2026-05');
    await until(async () => /noch nicht im SpesenKit-Ordner abgelegt/.test(await banner.innerText({ timeout: 500 }).catch(() => '')), 'Ablagehinweis');
    assert.equal((await readFolder(page)).file.state.statements.find((s) => s.month === '2026-05').locked, true, 'Datenstand gesichert');
    assert.deepEqual(Object.keys(await filedFiles(page, '2026', '05')), ['Reisekosten_2026-05_V01.pdf']);
    await page.evaluate(() => localStorage.removeItem('test-fail-write'));
    await banner.getByRole('button', { name: 'Erneut ablegen' }).click();
    await until(async () => Object.keys(await filedFiles(page, '2026', '05')).length === 2, 'ZIP nachgeholt');
  });

  await check('nach Neustart ohne Berechtigung: Zugriff bestätigen, Abschluss bis dahin gesperrt', async () => {
    await page.evaluate(() => localStorage.setItem('test-perm', 'prompt'));
    await page.reload(); await ready(page);
    assert.equal(await folderStatus(page), 'permission');
    assert.match(await banner.innerText(), /Zugriff auf Ihren SpesenKit-Ordner/);
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

  await check('Sicherungen: Tagessicherung, Abschluss-Sicherungen, „Jetzt sichern“, Wiederherstellen nur nach Bestätigung', async () => {
    const names = async () => (await readFolder(page)).copies.map((c) => c.name);
    const before = await names();
    assert.equal(before.filter((n) => /^spesenkit_auto_\d{4}-\d{2}-\d{2}_\d{6}(?:_[0-9a-f-]{36})?\.json$/.test(n)).length, 1, 'genau eine Tagessicherung heute');
    assert.ok(before.some((n) => n.startsWith('spesenkit_abschluss_2026-06_V01_')), 'Sicherung nach Abschluss Juni');
    assert.ok(before.some((n) => n.startsWith('spesenkit_abschluss_2026-05_V01_')), 'Sicherung nach Abschluss Mai (trotz Ablagefehler)');
    await nav(page, 'Datensicherung');
    const list = page.locator('.folder-backups');
    await until(async () => /Tagessicherung/.test(await list.innerText()), 'Liste');
    assert.match(await list.innerText(), /Monatsabschluss 2026-06 V01/);
    await list.getByRole('button', { name: 'Jetzt sichern' }).click();
    await until(async () => /Manuell/.test(await list.innerText()), 'manuelle Sicherung');
    const current = await idbState(page);
    // Ältere Tagessicherung: Warnung nennt die wegfallenden Abschlüsse; Abbrechen ändert nichts.
    let message = '';
    page.once('dialog', (dialog) => { message = dialog.message(); void dialog.dismiss(); });
    await list.locator('tr', { hasText: 'Tagessicherung' }).getByRole('button', { name: 'Wiederherstellen' }).click();
    await until(async () => message, 'Bestätigung');
    assert.match(message, /ACHTUNG: .*2026-05 V01.*2026-06 V01/);
    assert.deepEqual(await idbState(page), current, 'abgebrochen: nichts geändert');
    // Nach der manuellen Sicherung etwas ändern …
    await nav(page, 'Einstellungen');
    await page.getByLabel('Name', { exact: true }).fill('Nach der Sicherung geändert');
    await page.getByRole('button', { name: 'Einstellungen speichern', exact: true }).click();
    await until(async () => (await readFolder(page))?.file.state.settings.profileName === 'Nach der Sicherung geändert', 'Änderung im Ordner');
    await nav(page, 'Datensicherung');
    // … dann die manuelle Sicherung wiederherstellen: aktueller Stand wird vorher gesichert, Ordnerdatei folgt.
    const revision = (await readFolder(page)).file.revision;
    page.once('dialog', (dialog) => { message = dialog.message(); void dialog.accept(); });
    await list.locator('tr', { hasText: 'Manuell' }).getByRole('button', { name: 'Wiederherstellen' }).click();
    await until(async () => (await names()).some((n) => n.startsWith('spesenkit_vor_wiederherstellung_')), 'Vorher-Sicherung');
    assert.doesNotMatch(message, /ACHTUNG/);
    await until(async () => (await readFolder(page)).file.revision > revision, 'Ordnerdatei aktualisiert');
    assert.equal((await readFolder(page)).file.state.settings.profileName, current.settings.profileName, 'Ordnerdatei zeigt den wiederhergestellten Stand');
    assert.equal((await idbState(page)).settings.profileName, current.settings.profileName);
    assert.deepEqual(tripIds(await idbState(page)), tripIds(current));
    const saved = (await readFolder(page)).copies.find((c) => c.name.startsWith('spesenkit_vor_wiederherstellung_'));
    assert.equal(JSON.parse(saved.text).settings.profileName, 'Nach der Sicherung geändert', 'Vorher-Sicherung enthält den ersetzten Stand');
    assert.equal(await folderStatus(page), 'ok');
    await fits(page);
    await list.screenshot({ path: path.join(output, 'sicherungen-1440.png') });
  });

  await check('„JSON auswählen“ fragt vor dem Ersetzen und sichert den aktuellen Stand', async () => {
    const current = await idbState(page);
    const file = path.join(output, 'fremd.json');
    await (await import('node:fs/promises')).writeFile(file, JSON.stringify({ ...current, trips: [], statements: [] }));
    let message = '';
    page.once('dialog', (dialog) => { message = dialog.message(); void dialog.dismiss(); });
    await page.locator('input[type=file][accept=".json"]').setInputFiles(file);
    await until(async () => message, 'Bestätigung');
    assert.match(message, /ersetzen\?/); assert.match(message, /ACHTUNG/);
    assert.deepEqual(await idbState(page), current, 'abgebrochen: nichts geändert');
  });

  assert.deepEqual(errors, []);
  await context.close();

  await check('konkurrierender Terminalserver: Entscheidung statt Erfolg; beide Kandidaten nach Neustart wiederherstellbar', async () => {
    const ctx = await browser.newContext({ timezoneId: 'Europe/Berlin' }); await prepare(ctx);
    const p = await ctx.newPage(); await p.goto(url); await ready(p);
    await p.locator('.folder-banner').getByRole('button', { name: 'Ordner einrichten' }).click();
    await until(async () => (await folderStatus(p)) === 'ok', 'Ordner verbunden');
    await p.evaluate(() => localStorage.setItem('test-concurrent-save', '1'));
    await nav(p, 'Einstellungen'); await p.getByLabel('Name', { exact: true }).fill('Sitzung A');
    await p.getByRole('button', { name: 'Einstellungen speichern', exact: true }).click();
    const dialog = p.getByRole('dialog', { name: 'Welcher Datenstand gilt?' }); await dialog.waitFor();
    assert.equal(await folderStatus(p), 'conflict');
    const folder = await readFolder(p);
    assert.equal(folder.file.state.settings.profileName, 'Anderer Terminalserver');
    assert.equal((await idbState(p)).settings.profileName, 'Sitzung A');
    const candidates = folder.copies.filter((copy) => copy.name.startsWith('spesenkit_speicherkandidat_'));
    assert.ok(candidates.some((copy) => JSON.parse(copy.text).settings.profileName === 'Sitzung A'));
    const other = candidates.find((copy) => JSON.parse(copy.text).settings.profileName === 'Anderer Terminalserver'); assert.ok(other);
    await dialog.getByRole('button', { name: 'Browserstand behalten' }).click();
    await until(async () => (await folderStatus(p)) === 'ok', 'Entscheidung gespeichert');
    await p.reload(); await ready(p); await nav(p, 'Datensicherung');
    const list = p.locator('.folder-backups'); await list.getByLabel('Speicherkandidaten und Vorgänger anzeigen').check();
    const all = list.getByRole('button', { name: /^Alle \d+ anzeigen$/ }); if (await all.count()) await all.click();
    p.once('dialog', (confirmation) => void confirmation.accept());
    await list.locator(`tr[title="${other.name}"]`).getByRole('button', { name: 'Wiederherstellen' }).click();
    await until(async () => (await readFolder(p))?.file.state.settings.profileName === 'Anderer Terminalserver', 'Speicherkandidat wiederhergestellt');
    assert.equal((await idbState(p)).settings.profileName, 'Anderer Terminalserver');
    assert.equal(await folderStatus(p), 'ok'); await ctx.close();
  });

  await check('fehlgeschlagene Kandidatensicherung: Fehlerstatus, Hauptdatei unverändert, Wiederholung möglich', async () => {
    const ctx = await browser.newContext(); await prepare(ctx);
    const p = await ctx.newPage(); await p.goto(url); await ready(p);
    await p.locator('.folder-banner').getByRole('button', { name: 'Ordner einrichten' }).click();
    await until(async () => (await folderStatus(p)) === 'ok', 'Ordner verbunden');
    const before = (await readFolder(p)).file;
    await p.evaluate(() => localStorage.setItem('test-fail-candidate-close', '1'));
    await nav(p, 'Einstellungen'); await p.getByLabel('Name', { exact: true }).fill('Nach Sicherungsfehler');
    await p.getByRole('button', { name: 'Einstellungen speichern', exact: true }).click();
    await until(async () => (await folderStatus(p)) === 'error', 'Fehler beim Sichern');
    assert.deepEqual((await readFolder(p)).file, before);
    assert.match(await p.locator('.folder-banner').innerText(), /nicht im SpesenKit-Ordner gespeichert/);
    await p.evaluate(() => localStorage.removeItem('test-fail-candidate-close'));
    await p.locator('.folder-banner').getByRole('button', { name: 'Erneut speichern' }).click();
    await until(async () => (await folderStatus(p)) === 'ok', 'Sicherung und Schreiben wiederholt');
    assert.equal((await readFolder(p)).file.state.settings.profileName, 'Nach Sicherungsfehler');
    // Auch die neue Kandidatenwiederherstellung darf bei einem anschließenden Ordnerfehler keinen Erfolg melden.
    const beforeRestore = (await readFolder(p)).file;
    // Älterer Speicherkandidat (Name noch leer): Seit 1.8.3 löscht SpesenKit den Kandidaten eines Speichervorgangs beim nächsten
    // erfolgreichen Speichern – ein liegengebliebener (z. B. aus einer abgebrochenen Sitzung) wird hier daher selbst abgelegt.
    const oldCandidate = await p.evaluate(async (state) => {
      const z = (n) => String(n).padStart(2, '0'), d = new Date();
      const name = `spesenkit_speicherkandidat_${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}_${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}_00000000-0000-4000-8000-00000000c0de.json`;
      const text = JSON.stringify({ ...state, settings: { ...state.settings, profileName: '' } }, null, 2);
      const app = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('Max Mustermann')).getDirectoryHandle('SpesenKit');
      const w = await (await (await app.getDirectoryHandle('Sicherungen', { create: true })).getFileHandle(name, { create: true })).createWritable(); await w.write(text); await w.close();
      return { name, text };
    }, beforeRestore.state);
    assert.equal(JSON.parse(oldCandidate.text).settings.profileName, '');
    await nav(p, 'Datensicherung'); const list = p.locator('.folder-backups');
    await list.getByLabel('Speicherkandidaten und Vorgänger anzeigen').check();
    await p.evaluate(() => localStorage.setItem('test-fail-write', '1'));
    p.once('dialog', (confirmation) => void confirmation.accept());
    await list.locator(`tr[title="${oldCandidate.name}"]`).getByRole('button', { name: 'Wiederherstellen' }).click();
    await until(async () => (await folderStatus(p)) === 'error', 'Fehler beim Wiederherstellen im Ordner');
    assert.deepEqual((await readFolder(p)).file, beforeRestore);
    assert.equal((await idbState(p)).settings.profileName, '', 'Wiederherstellung nur lokal gespeichert');
    assert.doesNotMatch(await p.locator('.toast').innerText().catch(() => ''), /Sicherung wiederhergestellt/);
    await ctx.close();
  });

  for (const viewport of [{ width: 390, height: 844 }, { width: 820, height: 1180 }, { width: 1440, height: 1000 }]) {
    await check(`Layout ${viewport.width}px: Hinweis, Ordnerkarte und Konfliktdialog ohne Überlauf`, async () => {
      const ctx = await browser.newContext({ viewport, timezoneId: 'Europe/Berlin' });
      await prepare(ctx);
      const p = await ctx.newPage(); await p.goto(url + '?demo=1'); await ready(p);
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
