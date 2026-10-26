// Optional browser checks: existing Playwright installation, no project dependency.
// PLAYWRIGHT_MODULE=/absolute/path/to/playwright BROWSER_EXECUTABLE=/path/to/browser node tests/fahrzeug-speichern-browser-check.mjs
// Optional BROWSER_ENGINE=webkit for Safari-engine coverage.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
const require = createRequire(import.meta.url);
const engines = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const engine = process.env.BROWSER_ENGINE || 'chromium';
const root = path.resolve('dist');
const server = http.createServer(async (req,res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if (!pathname.startsWith('/reisekosten-pro/')) throw Error();
    const file = path.resolve(root, pathname.slice('/reisekosten-pro/'.length) || 'index.html');
    if (!file.startsWith(root+'/')) throw Error();
    const body = await readFile(file);
    res.writeHead(200, {'Content-Type': ({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'})[path.extname(file)] || 'application/octet-stream', 'Cache-Control':'no-cache'}).end(body);
  } catch {res.writeHead(404).end('Not found');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}/reisekosten-pro/`;
const state=page=>page.evaluate(()=>new Promise((resolve,reject)=>{const request=indexedDB.open('reisekosten-pro',1);request.onsuccess=()=>{const db=request.result;const tx=db.transaction('state');const r=tx.objectStore('state').get('main');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);tx.oncomplete=()=>db.close();};request.onerror=()=>reject(request.error);}));
const waitState=async(page,fn)=>{for(let i=0;i<60;i++){const s=await state(page);if(s&&fn(s))return s;await page.waitForTimeout(100);}throw Error('Saved state condition timed out');};
// SpesenKit 1.8.1: „Bisher: …“ im Feld „Verwendetes Fahrzeug“ ließ schon im einzelnen Tab jedes weitere Speichern
// mit „in einem anderen Tab geändert“ scheitern. Synthetische Daten.
const browser=await engines[engine].launch({headless:true,...(process.env.BROWSER_EXECUTABLE ? {executablePath:process.env.BROWSER_EXECUTABLE}: {})});
try {
  const page=await (await browser.newContext({viewport:{width:1440,height:1000}})).newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);await page.getByRole('heading',{name:'Monatsübersicht',exact:true}).waitFor();
  await page.locator('input[type=month]').fill('2026-03');
  const erfasse=async(datum,ziel,bisher)=>{
    await page.locator('.month-entry-workspace').getByRole('button',{name:'Dienstreise erfassen',exact:true}).click();
    const modal=page.locator('.modal');await modal.getByRole('heading',{name:'Neue Dienstreise',exact:true}).waitFor();
    await modal.getByLabel('Projekt *',{exact:true}).fill('26.0123 Musterstadt');
    await modal.getByLabel('Abfahrt Datum *',{exact:true}).fill(datum);
    await modal.getByLabel('Abfahrt Uhrzeit *',{exact:true}).fill('08:00');
    await modal.getByLabel('Rückkehr Uhrzeit *',{exact:true}).fill('17:00');
    await modal.getByLabel('Reiseziel *',{exact:true}).fill(ziel);
    await modal.getByLabel('Reisegrund *',{exact:true}).fill('Synthetischer Termin');
    if(bisher){
      await modal.locator('summary',{hasText:'Weitere Angaben'}).click();
      const auswahl=modal.locator('label',{hasText:'Verwendetes Fahrzeug'}).locator('select');
      const erste=await auswahl.locator('option').first().getAttribute('value');assert.equal(erste,'','erste Option ist „Bisher …“ bzw. „Bitte auswählen“');
      const vorher=await auswahl.inputValue();
      await auswahl.selectOption('');
      assert.equal(await auswahl.inputValue(),vorher,'„Bisher …“ lässt das Fahrzeug unverändert');
    }
    await modal.getByRole('button',{name:'Speichern & fertig',exact:true}).click();await modal.waitFor({state:'detached'});
  };
  await erfasse('2026-03-09','Ziel A',true);
  await waitState(page,s=>s.trips.length===1);
  await erfasse('2026-03-10','Ziel B',false);
  const saved=await waitState(page,s=>s.trips.length===2);
  assert.deepEqual(saved.trips.map(t=>t.destination).sort(),['Ziel A','Ziel B']);
  assert.ok(saved.trips.every(t=>t.vehicleId),'beide Fahrten mit Fahrzeug');
  assert.equal(await page.locator('.error-box').count(),0,'keine Speicher-Fehlermeldung');
  assert.deepEqual(errors,[]);
  console.log('PASS Fahrzeug „Bisher …“: weiteres Speichern im selben Tab klappt');
} finally { await browser.close(); server.close(); }
