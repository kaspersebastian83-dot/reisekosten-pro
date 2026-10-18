// Optional browser checks: existing Playwright installation, no project dependency.
// PLAYWRIGHT_MODULE=/absolute/path/to/playwright CHROMIUM_EXECUTABLE=/path/to/chromium node tests/browser-check.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import http from 'node:http';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve('dist');
let legacyMode = false;
let workerRevision = 0;
const legacyWorker = `const CACHE="reisekosten-pro-v1.6.0";self.addEventListener("install",e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(["./"])));self.skipWaiting();});self.addEventListener("activate",e=>e.waitUntil(self.clients.claim()));self.addEventListener("fetch",e=>{if(e.request.method==="GET")e.respondWith(fetch(e.request).catch(()=>caches.match(e.request)));});`;
const server = http.createServer(async (req,res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if (!pathname.startsWith('/reisekosten-pro/')) throw Error();
    const file = path.resolve(root, pathname.slice('/reisekosten-pro/'.length) || 'index.html');
    if (!file.startsWith(root+'/')) throw Error();
    let body = legacyMode && pathname.endsWith('/sw.js') ? Buffer.from(legacyWorker) : await readFile(file);
    if (pathname.endsWith('/sw.js') && workerRevision) body = Buffer.from(body.toString().replace(/(CACHE_PREFIX\})[a-f0-9]{16}/, '$1test-r'+workerRevision));
    if (pathname.endsWith('.js') && !pathname.endsWith('/sw.js') && workerRevision) body = Buffer.from(body.toString().replace('version:`1.7.0`', `version:\`1.7.${workerRevision}\``));
    res.writeHead(200, {'Content-Type': ({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'})[path.extname(file)] || 'application/octet-stream', 'Cache-Control':'no-cache'}).end(body);
  } catch {res.writeHead(404).end('Not found');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}/reisekosten-pro/`;
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE ? {executablePath:process.env.CHROMIUM_EXECUTABLE}: {})});
const output=path.resolve('outputs/feature-review');await mkdir(output,{recursive:true});
const results=[];
let syntheticBackup;
const check=async(name,fn)=>{await fn();results.push(name);console.log('PASS',name);};
const open=async(options={})=>{const context=await browser.newContext(options);const page=await context.newPage();return {context,page};};
const nav=async(page,name)=>{if(name==='Fahrten importieren'){await nav(page,'Reisen');await page.getByRole('button',{name:'Fahrten importieren',exact:true}).click();return;}if(await page.getByRole('button',{name:'Menü öffnen',exact:true}).isVisible())await page.getByRole('button',{name:'Menü öffnen',exact:true}).click();await page.locator('.sidebar nav').getByRole('button',{name:new RegExp('^'+name)}).click();await page.waitForTimeout(250);};
const state=page=>page.evaluate(()=>new Promise((resolve,reject)=>{const request=indexedDB.open('reisekosten-pro',1);request.onsuccess=()=>{const db=request.result;const tx=db.transaction('state');const r=tx.objectStore('state').get('main');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);tx.oncomplete=()=>db.close();};request.onerror=()=>reject(request.error);}));
const waitState=async(page,fn)=>{for(let i=0;i<60;i++){const s=await state(page);if(fn(s))return s;await page.waitForTimeout(100);}throw Error('Saved state condition timed out');};
const download=async(page,name)=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name,exact:true}).click();const d=await pending;const target=path.join(output,d.suggestedFilename());await d.saveAs(target);return {file:target,bytes:await readFile(target)};};
const header='Abfahrt_datum;Abfahrt_uhrzeit;Ankunft_datum;Ankunft_uhrzeit;Betrieb_km;Arbeitsweg_km;Privat_km;Start Adresse;End Adresse;Anlass der Fahrt';
const csv=[header,'09.03.2026;08:30;09.03.2026;09:00;12,5;0;0;Start;Testziel;Testtermin','09.03.2026;17:00;09.03.2026;17:30;25,75;0;0;Testziel;Start;Testtermin','09.03.2026;08:30;09.03.2026;09:00;12,5;0;0;Start;Testziel;Testtermin','09.03.2026;07:00;09.03.2026;07:30;0;10;0;Start;Büro;Arbeitsweg','09.03.2026;06:00;09.03.2026;06:30;0;0;5;Start;Privat;Privat','31.02.2026;08:00;31.02.2026;17:00;10;0;0;Start;Ziel;Termin'].join('\n');
const review=async(page, text=csv)=>{await nav(page,'Übersicht');await nav(page,'Fahrten importieren');await page.locator('input[type=file]').setInputFiles({name:'synthetic-review.csv',mimeType:'text/csv',buffer:Buffer.from(text)});await page.getByRole('button',{name:'Weiter',exact:true}).click();await page.getByRole('button',{name:'Weiter',exact:true}).click();await page.getByRole('heading',{name:/Datenzeilen/}).waitFor();};
const confirm=page=>page.getByRole('button',{name:/^\d+ Fahrten importieren$/});
const {context,page}=await open();
try {
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);await page.getByRole('heading',{name:'Reisen',exact:true}).waitFor();
  await check('review counts, physical source rows, filters, selection and cancel do not persist',async()=>{
    await review(page);assert.equal(await state(page),undefined);
    assert.match(await page.locator('.review-counts').innerText(),/2\s+Bereit/);
    assert.match(await page.locator('.review-counts').innerText(),/1\s+Ungültig/);
    assert.equal(await page.locator('.import-review input:disabled').count(),4);
    await page.getByLabel('Status filtern').selectOption('invalid');assert.match(await page.locator('.import-review tbody').innerText(),/7\s+31.02.2026/);
    await page.getByLabel('Status filtern').selectOption('all');
    await page.getByLabel('Zeile 2 übernehmen').uncheck();assert.equal(await confirm(page).innerText(),'1 Fahrten importieren');
    await page.getByRole('button',{name:'Auswahl aufheben',exact:true}).click();assert.equal(await confirm(page).isDisabled(),true);
    await page.getByRole('button',{name:'Alle bereiten auswählen',exact:true}).click();
    await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(150);await page.screenshot({path:path.join(output,'import-review-desktop.png'),fullPage:true});
    await page.getByRole('button',{name:'Import abbrechen',exact:true}).click();assert.equal(await state(page),undefined);
  });
  await check('transaction failure has no partial import; retry and double submission save exactly once',async()=>{
    await review(page);
    await page.evaluate(()=>{window.originalPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=()=>{throw new DOMException('Synthetic quota','QuotaExceededError');};});
    await confirm(page).click();await page.getByRole('alert').getByText(/Import nicht gespeichert/).waitFor();assert.equal(await state(page),undefined);
    await page.evaluate(()=>{IDBObjectStore.prototype.put=window.originalPut;});
    await confirm(page).evaluate(button=>{button.click();button.click();});
    const saved=await waitState(page,s=>s?.trips.length===2);assert.equal(saved.profiles.length,1);
    await page.getByRole('heading',{name:'Import abgeschlossen'}).waitFor();
  });
  await check('duplicate file cannot be confirmed and storage-time duplicate check preserves another tab change',async()=>{
    await review(page);assert.equal(await confirm(page).isDisabled(),true);
    await page.getByRole('button',{name:'Import abbrechen',exact:true}).click();
    // Same isolated test database; remove one synthetic record before making a new review.
    await page.evaluate(()=>new Promise(resolve=>{const r=indexedDB.open('reisekosten-pro',1);r.onsuccess=()=>{const tx=r.result.transaction('state','readwrite'),store=tx.objectStore('state');const q=store.get('main');q.onsuccess=()=>{const s=q.result;window.savedTrip=s.trips.pop();store.put(s,'main');};tx.oncomplete=()=>{r.result.close();resolve();};};}));
    await page.reload();await page.getByRole('heading',{name:'Reisen',exact:true}).waitFor();await review(page);assert.equal(await confirm(page).innerText(),'1 Fahrten importieren');
    await page.evaluate(()=>new Promise(resolve=>{const r=indexedDB.open('reisekosten-pro',1);r.onsuccess=()=>{const tx=r.result.transaction('state','readwrite'),store=tx.objectStore('state');const q=store.get('main');q.onsuccess=()=>{const s=q.result;const trip=structuredClone(s.trips[0]);trip.id='concurrent';trip.startTime='17:00';trip.endTime='17:30';trip.startPlace='Testziel';trip.destination='Start';trip.businessKm=25.75;s.trips.push(trip);s.settings.company='Concurrent synthetic setting';store.put(s,'main');};tx.oncomplete=()=>{r.result.close();resolve();};};}));
    await confirm(page).click();await page.getByRole('heading',{name:'Import abgeschlossen'}).waitFor();
    const saved=await state(page);assert.equal(saved.trips.length,2);assert.equal(saved.settings.company,'Concurrent synthetic setting');
    assert.match(await page.locator('.success-state').innerText(),/0 Fahrten/);
  });
  await check('daily, trip and month explanations reconcile displayed totals and frozen saved context',async()=>{
    await page.locator('input[type=month]').fill('2026-03');await nav(page,'Einstellungen');
    await page.locator('.vehicle-list article').first().getByLabel('Fahrzeugart').selectOption('privatwagen');
    await page.getByRole('button',{name:'Einstellungen speichern',exact:true}).click();await waitState(page,s=>s.settings.vehicles[0].ownership==='privatwagen');
    await nav(page,'Reisen');await page.locator('.day-card > .calculation-details summary').click();assert.match(await page.locator('.day-card > .calculation-details').innerText(),/14,00/);
    await page.locator('.trip-rows .calculation-details summary').first().click();assert.match(await page.locator('.trip-rows .calculation-details').first().innerText(),/11,48/);
    await nav(page,'Monatsabrechnungen');await page.locator('.monthly-details summary').click();await page.locator('.statement-day-details .calculation-details summary').click();
    await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(150);await page.screenshot({path:path.join(output,'calculation-details-desktop.png'),fullPage:true});
    await page.getByRole('button',{name:'Abrechnung erstellen',exact:true}).click();await waitState(page,s=>s.statements.length===1);
    await page.locator('.statement-actions select').selectOption('freigegeben');const frozen=(await waitState(page,s=>s.statements[0].locked)).statements[0];
    await nav(page,'Einstellungen');await page.locator('.vehicle-list article').first().getByLabel('Fahrzeugart').selectOption('dienstwagen');await page.getByRole('button',{name:'Einstellungen speichern',exact:true}).click();await waitState(page,s=>s.settings.vehicles[0].ownership==='dienstwagen');
    await nav(page,'Monatsabrechnungen');await page.locator('.statement-day-details .calculation-details summary').click();
    assert.match(await page.locator('.statement-day-details .calculation-details').innerText(),/Privatwagen.*12,5 berechtigte km/s);
    assert.deepEqual((await state(page)).statements[0],frozen);
  });
  await check('iPhone and iPad review, details and version layouts do not overflow',async()=>{
    for(const [width,height,label] of [[390,844,'iphone'],[820,1180,'ipad']]) {
      await page.setViewportSize({width,height});await review(page,csv.replaceAll("09.03.2026","10.03.2026"));
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(150);await page.screenshot({path:path.join(output,`import-review-${label}.png`),fullPage:true});
      await page.getByRole('button',{name:'Import abbrechen',exact:true}).click();await nav(page,'Monatsabrechnungen');await page.locator('.monthly-details summary').click();
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(150);await page.screenshot({path:path.join(output,`calculation-details-${label}.png`),fullPage:true});
      await nav(page,'Einstellungen');assert.match(await page.locator('.app-version').innerText(),/Reisekosten Pro 1\.7\.0/);assert.match(await page.locator('.app-version').innerText(),/Commit [a-f0-9]{7}/);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(150);await page.screenshot({path:path.join(output,`version-${label}.png`),fullPage:true});
    }
  });
  await check('waiting update defers, protects import and unsaved edits in another tab, then explicitly reloads preserving storage',async()=>{
    await page.setViewportSize({width:1280,height:900});await page.evaluate(()=>navigator.serviceWorker.ready);
    const before=await state(page);await page.evaluate(()=>localStorage.setItem('synthetic-preserve','keep'));
    await review(page);workerRevision=1;await page.evaluate(async()=>{await (await navigator.serviceWorker.ready).update();});
    await page.getByRole('button',{name:'Jetzt aktualisieren',exact:true}).waitFor({timeout:20000});
    await page.getByRole('button',{name:'Später',exact:true}).click();await page.getByRole('button',{name:/Update anzeigen/}).click();
    await page.getByRole('button',{name:'Jetzt aktualisieren',exact:true}).click();await page.getByText(/Es gibt offene Eingaben/).waitFor();
    await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(150);await page.screenshot({path:path.join(output,'update-pending-import.png'),fullPage:true});
    const second=await context.newPage();await second.goto(url);await second.getByRole('heading',{name:'Reisen',exact:true}).waitFor();await nav(second,'Einstellungen');await second.getByLabel('Firma',{exact:true}).fill('Unsaved synthetic');
    await page.getByRole('button',{name:'Offene Eingaben verwerfen und aktualisieren',exact:true}).click();await page.getByText(/in allen App-Tabs abschließen/).waitFor();
    assert.equal(await page.evaluate(()=>localStorage.getItem('synthetic-preserve')),'keep');assert.deepEqual(await state(page),before);
    await second.getByRole('button',{name:'Einstellungen speichern',exact:true}).click();await waitState(second,s=>s.settings.company==='Unsaved synthetic');
    const saved=await state(page);
    const navigated=page.waitForEvent('load');await page.getByRole('button',{name:'Offene Eingaben verwerfen und aktualisieren',exact:true}).click();await navigated;
    await page.getByRole('heading',{name:'Reisen',exact:true}).waitFor();assert.deepEqual(await state(page),saved);assert.equal(await page.evaluate(()=>localStorage.getItem('synthetic-preserve')),'keep');
    assert.equal(await page.getByRole('button',{name:'Jetzt aktualisieren',exact:true}).count(),0);await second.close();
    await nav(page,'Einstellungen');await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(150);await page.screenshot({path:path.join(output,'version-desktop.png'),fullPage:true});
  });
  await check('unsaved settings block update; saved work updates through the normal action',async()=>{
    await nav(page,'Einstellungen');await page.getByLabel('Firma',{exact:true}).fill('Pending edit');
    workerRevision=2;await page.evaluate(async()=>{await (await navigator.serviceWorker.ready).update();});
    await page.getByRole('button',{name:'Jetzt aktualisieren',exact:true}).waitFor();
    await page.getByRole('button',{name:'Jetzt aktualisieren',exact:true}).click();await page.getByText(/Es gibt offene Eingaben/).waitFor();
    assert.match(await page.locator('.app-version').innerText(),/1\.7\.1/);
    await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(150);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(output,'version-update-desktop.png'),fullPage:true});
    await page.getByRole('button',{name:'Einstellungen speichern',exact:true}).click();await waitState(page,s=>s.settings.company==='Pending edit');
    const load=page.waitForEvent('load');await page.getByRole('button',{name:'Jetzt aktualisieren',exact:true}).click();await load;
    await page.getByRole('heading',{name:'Reisen',exact:true}).waitFor();assert.equal((await state(page)).settings.company,'Pending edit');
  });
  await check('offline startup retains running version and handles checks quietly',async()=>{
    await context.setOffline(true);await page.reload();await page.getByRole('heading',{name:'Reisen',exact:true}).waitFor();await nav(page,'Einstellungen');assert.match(await page.locator('.app-version').innerText(),/1\.7\.2/);await context.setOffline(false);assert.deepEqual(errors,[]);
  });
  console.log(JSON.stringify({checks:results.length,results,output},null,2));
} catch(error) { console.error(await page.locator('body').innerText());await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(150);await page.screenshot({path:path.join(output,'failure.png'),fullPage:true});throw error; }
finally {await context.close();await browser.close();await new Promise(resolve=>server.close(resolve));}
