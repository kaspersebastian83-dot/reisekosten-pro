// Belegbilder als eigene Dateien (ab 1.9) im echten Browser: Umstellung eines 1.8-Bestands, Ordner im Format 2 mit
// SpesenKit/Belege/, Format-1-Datei eines älteren Rechners, fehlende Bilder vom Ordner holen, JSON-Sicherung vollständig.
// npm run build && node tests/belege-dateien-browser-check.mjs   (Sandbox-Chromium: SANDBOX_HANDLE_SHIM=1)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdtemp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { handleShim } from './helpers/folder-harness.mjs';
import { databases, storedState } from './helpers/browser-state.mjs';
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
const output = await mkdtemp(path.join(tmpdir(), 'spesenkit-belege-'));
const check = async (name, fn) => { await fn(); console.log('PASS', name); };

const harness = () => {
  window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('Max Mustermann', { create: true });
  if (typeof FileSystemHandle !== 'undefined') {
    FileSystemHandle.prototype.queryPermission = async function () { return 'granted'; };
    FileSystemHandle.prototype.requestPermission = async function () { return 'granted'; };
  }
};
const until = async (fn, what) => { for (let i = 0; i < 150; i++) { const value = await fn(); if (value) return value; await new Promise((r) => setTimeout(r, 100)); } throw Error(`Zeitüberschreitung: ${what}`); };
const nav = async (page, name) => { if (await page.getByRole('button', { name: 'Menü öffnen', exact: true }).isVisible()) await page.getByRole('button', { name: 'Menü öffnen', exact: true }).click(); await page.locator('.sidebar nav').getByRole('button', { name: new RegExp('^' + name) }).click(); };
const folderStatus = (page) => page.locator('.storage-status').getAttribute('data-folder-status');
const ready = async (page) => { await page.getByRole('heading', { name: 'Monatsübersicht', exact: true }).waitFor(); await until(async () => (await folderStatus(page)) !== 'checking', 'Ordnerabgleich'); };
const writeIdb = (page, value) => page.evaluate((value) => new Promise((resolve, reject) => { const r = indexedDB.open('reisekosten-pro', 1); r.onsuccess = () => { const tx = r.result.transaction('state', 'readwrite'); tx.objectStore('state').put(value, 'main'); tx.oncomplete = () => { r.result.close(); resolve(); }; tx.onerror = () => reject(tx.error); }; r.onerror = () => reject(r.error); }), value);
/** Ordnerinhalt: Datendatei (Text), Belege (Name → Bytes als base64). */
const readFolder = (page) => page.evaluate(async () => {
  const app = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('Max Mustermann')).getDirectoryHandle('SpesenKit');
  const text = await (await (await (await app.getDirectoryHandle('Daten')).getFileHandle('spesenkit.json')).getFile()).text();
  const belege = {};
  try { for await (const [name, handle] of (await app.getDirectoryHandle('Belege')).entries()) { const bytes = new Uint8Array(await (await handle.getFile()).arrayBuffer()); let s = ''; for (const b of bytes) s += String.fromCharCode(b); belege[name] = btoa(s); } } catch { /* noch keine */ }
  return { text, belege };
});
const writeDataFile = (page, content) => page.evaluate(async (content) => {
  const data = await (await (await (await navigator.storage.getDirectory()).getDirectoryHandle('Max Mustermann')).getDirectoryHandle('SpesenKit')).getDirectoryHandle('Daten');
  const w = await (await data.getFileHandle('spesenkit.json')).createWritable(); await w.write(JSON.stringify(content)); await w.close();
}, content);
const sha = (base64) => createHash('sha256').update(Buffer.from(base64, 'base64')).digest('hex');
const receiptsOf = (state) => [...state.expenses.map((e) => e.receipt), ...state.receiptInbox.map((i) => i.receipt), ...state.statements.flatMap((s) => (s.expensesSnapshot || []).map((e) => e.receipt))].filter(Boolean);

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Europe/Berlin', acceptDownloads: true });
  await context.addInitScript(harness);
  if (process.env.SANDBOX_HANDLE_SHIM) await context.addInitScript(handleShim);
  const page = await context.newPage(); page.setDefaultTimeout(20000);
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url); await ready(page);

  // Ausgangslage wie in 1.8: Demo-Daten, Juli-Entwurf, dann Bilder eingebettet in Kosten, Eingang und Version.
  await nav(page, 'Datensicherung'); await page.getByRole('button', { name: 'Demo-Daten laden', exact: true }).click();
  await until(async () => (await storedState(page, { raw: true }))?.expenses?.length, 'Demo-Daten');
  await nav(page, 'Monatsübersicht'); await page.locator('input[type=month]').fill('2026-07');
  await page.getByRole('button', { name: 'Spesenabrechnung erstellen', exact: true }).click();
  await until(async () => (await storedState(page, { raw: true })).statements.length, 'Entwurf');
  const images = await page.evaluate(() => ['#c0392b', '#2471a3', '#1e8449'].map((color, i) => { const c = document.createElement('canvas'); c.width = 600 + i; c.height = 800; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.fillStyle = color; g.font = '48px sans-serif'; for (let y = 60; y < 800; y += 70) g.fillText(`Beleg ${i + 1} · ${y}`, 30, y); return c.toDataURL('image/jpeg', 0.8); }));
  const legacy = await storedState(page, { raw: true });
  const july = legacy.expenses.filter((e) => e.date.startsWith('2026-07')).slice(0, 3);
  assert.equal(july.length, 3, 'drei Juli-Kosten in den Demo-Daten');
  july.forEach((expense, i) => { expense.receipt = { id: `r${i}`, name: `beleg-${i + 1}.jpg`, type: 'image/jpeg', size: images[i].length, hash: `orig-${i}`, dataUrl: images[i] }; });
  for (const expense of legacy.statements[0].expensesSnapshot) { const twin = july.find((e) => e.id === expense.id); if (twin) expense.receipt = structuredClone(twin.receipt); }
  legacy.receiptInbox = july.map((expense, i) => ({ id: `in${i}`, receipt: structuredClone(expense.receipt), capturedAt: '2026-07-20T10:00:00Z', status: 'zugeordnet', suggestion: { confidence: 90 }, expenseId: expense.id, notes: '' }));
  assert.equal(receiptsOf(legacy).length, 9, 'drei Bilder je dreimal eingebettet');
  await writeIdb(page, legacy);

  await check('1.8-Bestand im Browser: beim Öffnen umgestellt, Bilder einmal in eigener Datenbank, Inhalt unverändert', async () => {
    await page.reload(); await ready(page);
    const raw = await until(async () => { const s = await storedState(page, { raw: true }); return receiptsOf(s).every((r) => r.dataUrl === '' && /^[0-9a-f]{64}\.jpg$/.test(r.fileId)) ? s : null; }, 'umgestellter Bestand');
    assert.equal(new Set(receiptsOf(raw).map((r) => r.fileId)).size, 3);
    assert.ok(JSON.stringify(raw).length < JSON.stringify(legacy).length / 5);
    assert.deepEqual(await databases(page), [{ name: 'reisekosten-pro', version: 1 }, { name: 'spesenkit-belege', version: 1 }]);
    const hydrated = await storedState(page);
    assert.deepEqual(receiptsOf(hydrated).map((r) => r.dataUrl), receiptsOf(legacy).map((r) => r.dataUrl));
    for (const r of receiptsOf(raw)) assert.equal(r.fileId.slice(0, 64), sha(images[Number(r.id.slice(1))].split(',')[1]));
  });

  await check('Beleg im Kostenfenster wird aus der Bilddatenbank angezeigt', async () => {
    await nav(page, 'Monatsübersicht'); await page.locator('input[type=month]').fill('2026-07');
    const timeline = page.getByRole('region', { name: 'Monat im Überblick', exact: true });
    await timeline.locator('.timeline-entry.expense').filter({ hasText: july[0].description }).first().click();
    const editor = page.locator('.modal'); await editor.locator('.receipt-attachment summary').click();
    await until(async () => ((await editor.locator('.receipt-attachment img').getAttribute('src').catch(() => '')) || '').startsWith('data:image/jpeg;base64,'), 'Belegbild');
    assert.equal(await editor.locator('.receipt-attachment a[download]').getAttribute('href'), images[0]);
    await editor.getByRole('button', { name: 'Abbrechen', exact: true }).click(); await editor.waitFor({ state: 'hidden' });
  });

  await check('JSON-Sicherung zum Herunterladen enthält alle Bilder', async () => {
    await nav(page, 'Datensicherung');
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Sicherung herunterladen', exact: true }).click();
    const file = path.join(output, (await pending).suggestedFilename()); await (await pending).saveAs(file);
    const backup = JSON.parse(await readFile(file, 'utf8'));
    assert.deepEqual(receiptsOf(backup).map((r) => r.dataUrl), receiptsOf(legacy).map((r) => r.dataUrl));
  });

  await check('Ordner einrichten: spesenkit.json im Format 2 ohne Bilder, jedes Bild einmal unter SpesenKit/Belege/', async () => {
    await page.locator('.folder-banner').getByRole('button', { name: 'Ordner einrichten' }).click();
    await until(async () => (await folderStatus(page)) === 'ok', 'Status ok');
    const folder = await readFolder(page);
    const file = JSON.parse(folder.text);
    assert.equal(file.formatVersion, 2);
    assert.ok(!folder.text.includes(';base64,'));
    assert.ok(folder.text.length < 200_000, `Datendatei ${folder.text.length} Zeichen`);
    const ids = [...new Set(receiptsOf(file.state).map((r) => r.fileId))].sort();
    assert.deepEqual(Object.keys(folder.belege).sort(), ids);
    for (const [name, bytes] of Object.entries(folder.belege)) assert.equal(sha(bytes), name.slice(0, 64));
  });

  await check('Format-1-Datei eines älteren Rechners mit gleichem Inhalt: kein Konflikt, Datei wird ins Format 2 umgeschrieben', async () => {
    const current = JSON.parse((await readFolder(page)).text);
    const inline = await storedState(page);
    const strip = (s) => JSON.parse(JSON.stringify(s, (key, value) => key === 'fileId' ? undefined : value));
    await writeDataFile(page, { format: 'spesenkit-daten', formatVersion: 1, revision: current.revision, savedAt: current.savedAt, state: strip(inline) });
    // Verknüpfung wie von 1.8 gespeichert: alter Fingerabdruck, ohne hashFormat.
    await page.evaluate(() => new Promise((resolve, reject) => { const r = indexedDB.open('mosaik-suite'); r.onsuccess = () => { const db = r.result; const tx = db.transaction('kv', 'readwrite'); const store = tx.objectStore('kv');
      const get = store.get('spesenkit-ordner'); get.onsuccess = () => { const link = { ...get.result }; delete link.hashFormat; link.hash = 'alter-fingerabdruck-1-8'; if (link.handle && !(link.handle instanceof FileSystemHandle) && link.handle.testOpfsPath === undefined) delete link.handle; store.put(link, 'spesenkit-ordner'); };
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error); }; r.onerror = () => reject(r.error); }));
    await page.reload(); await ready(page);
    assert.equal(await folderStatus(page), 'ok');
    assert.equal(await page.locator('.folder-dialog, [role=dialog]').filter({ hasText: 'Welcher Datenstand gilt' }).count(), 0);
    const after = await until(async () => { const f = await readFolder(page); return JSON.parse(f.text).formatVersion === 2 ? f : null; }, 'Format 2');
    assert.ok(!after.text.includes(';base64,'));
  });

  await check('Bilder fehlen im Browser (anderer Rechner): werden aus dem Ordner geholt und angezeigt', async () => {
    await page.goto(url + 'manifest.webmanifest');
    await page.evaluate(() => new Promise((resolve, reject) => { const r = indexedDB.deleteDatabase('spesenkit-belege'); r.onsuccess = resolve; r.onerror = () => reject(r.error); r.onblocked = () => reject(Error('blockiert')); }));
    await page.goto(url); await ready(page);
    assert.equal(await folderStatus(page), 'ok');
    const hydrated = await until(async () => { const s = await storedState(page); return receiptsOf(s).every((r) => r.dataUrl.startsWith('data:image/jpeg')) ? s : null; }, 'Bilder aus dem Ordner übernommen');
    assert.deepEqual(receiptsOf(hydrated).map((r) => r.dataUrl), receiptsOf(legacy).map((r) => r.dataUrl));
  });

  assert.deepEqual(errors, []);
  await context.close();
} finally {
  await browser.close(); server.close();
}
console.log(`OK Belegbilder als Dateien; Downloads: ${output}`);
