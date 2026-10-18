// Optional browser checks: existing Playwright installation, no project dependency.
// PLAYWRIGHT_MODULE=/absolute/path/to/playwright CHROMIUM_EXECUTABLE=/path/to/chromium node tests/review-browser-check.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
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
    if (pathname.endsWith('.js') && !pathname.endsWith('/sw.js') && workerRevision) body = Buffer.from(body.toString().replace(/version:`\d+\.\d+\.\d+`/, `version:\`9.9.${workerRevision}\``));
    res.writeHead(200, {'Content-Type': ({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'})[path.extname(file)] || 'application/octet-stream', 'Cache-Control':'no-cache'}).end(body);
  } catch {res.writeHead(404).end('Not found');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}/reisekosten-pro/`;
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE ? {executablePath:process.env.CHROMIUM_EXECUTABLE}: {})});
const output=path.resolve('outputs/pr-review');await mkdir(output,{recursive:true});
const results=[];
const failures = [];
const check=async(name,fn)=>{try { await fn(); results.push(name); console.log('PASS',name); } catch (error) { failures.push({name,error:String(error)});console.error('FAIL',name,String(error)); }};
const open=async(options={})=>{const context=await browser.newContext(options);const page=await context.newPage();return {context,page};};
const nav=async(page,name)=>{if(name==='Fahrten importieren'){await nav(page,'Monatsübersicht');await page.locator('.month-entry-workspace').getByRole('button',{name:'Fahrtenbuch importieren',exact:true}).click();return;}if(await page.getByRole('button',{name:'Menü öffnen',exact:true}).isVisible())await page.getByRole('button',{name:'Menü öffnen',exact:true}).click();await page.locator('.sidebar nav').getByRole('button',{name:new RegExp('^'+name)}).click();await page.waitForTimeout(250);};
const state=page=>page.evaluate(()=>new Promise((resolve,reject)=>{const request=indexedDB.open('reisekosten-pro',1);request.onsuccess=()=>{const db=request.result;const tx=db.transaction('state');const r=tx.objectStore('state').get('main');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);tx.oncomplete=()=>db.close();};request.onerror=()=>reject(request.error);}));
const waitState=async(page,fn)=>{for(let i=0;i<60;i++){const s=await state(page);if(fn(s))return s;await page.waitForTimeout(100);}throw Error('Saved state condition timed out');};
const download=async(page,name)=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name,exact:true}).click();const d=await pending;const target=path.join(output,d.suggestedFilename());await d.saveAs(target);return {file:target,bytes:await readFile(target)};};
const header='Abfahrt_datum;Abfahrt_uhrzeit;Ankunft_datum;Ankunft_uhrzeit;Betrieb_km;Arbeitsweg_km;Privat_km;Start Adresse;End Adresse;Anlass der Fahrt';
const csv=[header,'09.03.2026;08:30;09.03.2026;09:00;12,5;0;0;Start;Testziel;Hinfahrt','09.03.2026;17:00;09.03.2026;17:30;25,75;0;0;Testziel;Start;Rückfahrt'].join('\n');
const importTrips=async(page,text=csv)=>{await nav(page,'Fahrten importieren');await page.locator('input[type=file]').setInputFiles({name:'synthetic-review.csv',mimeType:'text/csv',buffer:Buffer.from(text)});await page.getByRole('button',{name:'Weiter',exact:true}).click();await page.getByRole('button',{name:'Weiter',exact:true}).click();await page.getByRole('button',{name:/^\d+ Fahrten importieren$/}).click();await page.getByRole('heading',{name:'Import abgeschlossen'}).waitFor();};
const start=async()=>{const result=await open();await result.page.goto(url);await result.page.getByRole('heading',{name:'Monatsübersicht',exact:true}).waitFor();return result;};
const writeState=(page,value)=>page.evaluate(value=>new Promise((resolve,reject)=>{const r=indexedDB.open('reisekosten-pro',1);r.onsuccess=()=>{const tx=r.result.transaction('state','readwrite');tx.objectStore('state').put(value,'main');tx.oncomplete=()=>{r.result.close();resolve();};tx.onabort=()=>reject(tx.error);};}),value);
try {
  await check('stale tab autosave cannot overwrite imported trips or receipts',async()=>{
    workerRevision=0;const {context,page}=await start();
    try {
      await nav(page,'Einstellungen');await page.getByRole('button',{name:'Einstellungen speichern',exact:true}).click();let saved=await waitState(page,s=>s?.changes.length===1);
      saved.expenses=[{id:'synthetic-expense',date:'2026-03-09',category:'Parken',description:'Synthetischer Beleg',gross:12.5,net:12.5,vatRate:0,vat:0,currency:'EUR',exchangeRate:1,paymentType:'privat vorgestreckt',paidBy:'',reimbursementStatus:'offen',businessShare:100,notes:'',status:'ungeprüft',warnings:[],receipt:{id:'synthetic-receipt',name:'synthetic.png',type:'image/png',hash:'synthetic',size:1,dataUrl:'data:image/png;base64,AA=='}}];
      saved.expenses[0].receipt.dataUrl=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=2;canvas.height=2;return canvas.toDataURL('image/png');});
      await writeState(page,saved);await page.reload();await page.getByRole('heading',{name:'Monatsübersicht',exact:true}).waitFor();
      const second=await context.newPage();await second.goto(url);await second.getByRole('heading',{name:'Monatsübersicht',exact:true}).waitFor();await nav(second,'Einstellungen');
      await importTrips(page);const committed=await state(page);
      await second.getByLabel('Firma',{exact:true}).fill('Stale tab');await second.getByRole('button',{name:'Einstellungen speichern',exact:true}).click();await second.waitForTimeout(400);
      assert.equal((await state(page)).trips.length,2);assert.deepEqual(await state(page),committed);
      assert.match(await second.getByRole('alert').innerText(),/anderen Tab/);
      assert.equal((await state(page)).expenses[0].receipt.dataUrl,saved.expenses[0].receipt.dataUrl);
    } finally {await context.close();}
  });
  await check('abort after put rolls back the whole import; retry preserves existing records',async()=>{
    workerRevision=0;const {context,page}=await start();
    try {
      await importTrips(page);const before=await state(page);
      await nav(page,'Fahrten importieren');await page.locator('input[type=file]').setInputFiles({name:'synthetic-next.csv',mimeType:'text/csv',buffer:Buffer.from(csv.replaceAll('09.03.2026','10.03.2026'))});
      await page.getByRole('button',{name:'Weiter',exact:true}).click();await page.getByRole('button',{name:'Weiter',exact:true}).click();
      await page.evaluate(()=>{window.originalPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){const request=window.originalPut.apply(this,args);if(this.name==='state')request.addEventListener('success',()=>this.transaction.abort());return request;};});
      await page.getByRole('button',{name:'2 Fahrten importieren',exact:true}).click();await page.getByRole('alert').getByText(/Import nicht gespeichert/).waitFor();
      assert.deepEqual(await state(page),before);
      await page.evaluate(()=>IDBObjectStore.prototype.put=window.originalPut);
      await page.getByRole('button',{name:'2 Fahrten importieren',exact:true}).click();await page.getByRole('heading',{name:'Import abgeschlossen'}).waitFor();
      const after=await state(page);assert.equal(after.trips.length,4);assert.deepEqual(after.trips.slice(0,2),before.trips);
      assert.deepEqual(after.expenses,before.expenses);assert.equal(after.profiles.length,1);
      await nav(page,'Datensicherung');page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Daten löschen',exact:true}).click();
      await waitState(page,s=>s.trips.length===0&&s.profiles.length===0);
      await nav(page,'Einstellungen');await page.getByLabel('Firma',{exact:true}).fill('Synthetic after explicit reset');await page.getByRole('button',{name:'Einstellungen speichern',exact:true}).click();
      await waitState(page,s=>s.settings.company==='Synthetic after explicit reset');assert.equal(await page.getByRole('alert').count(),0);
    } finally {await context.close();}
  });
  await check('file reading blocks updates and a newer selection cannot be replaced by an older read',async()=>{
    workerRevision=0;const {context,page}=await start();
    try {
      await page.evaluate(()=>navigator.serviceWorker.ready);await nav(page,'Fahrten importieren');
      await page.evaluate(()=>{const read=File.prototype.text;File.prototype.text=async function(){const value=await read.call(this);if(this.name==='synthetic-slow.csv')await new Promise(resolve=>window.releaseFirstRead=resolve);return value;};});
      await page.locator('input[type=file]').setInputFiles({name:'synthetic-slow.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
      await page.waitForFunction(()=>!!window.releaseFirstRead);
      workerRevision=1;await page.evaluate(async()=>{await(await navigator.serviceWorker.ready).update();});await page.getByRole('button',{name:'Jetzt aktualisieren',exact:true}).waitFor();
      await page.getByRole('button',{name:'Jetzt aktualisieren',exact:true}).click();await page.getByText(/Es gibt offene Eingaben/).waitFor();
      await page.locator('input[type=file]').setInputFiles({name:'synthetic-newer.csv',mimeType:'text/csv',buffer:Buffer.from(csv.replaceAll('09.03.2026','10.03.2026'))});
      await page.getByRole('button',{name:'Weiter',exact:true}).waitFor();await page.evaluate(()=>window.releaseFirstRead());await page.waitForTimeout(100);
      await page.getByRole('button',{name:'Weiter',exact:true}).click();await page.getByRole('button',{name:'Weiter',exact:true}).click();
      assert.match(await page.locator('.import-review').innerText(),/10.03.2026/);assert.equal(await state(page),undefined);
      await page.getByRole('button',{name:'Import abbrechen',exact:true}).click();assert.equal(await state(page),undefined);
    } finally {await context.close();}
  });
  await check('a backup restoration being read blocks update until its data is saved',async()=>{
    workerRevision=0;const {context,page}=await start();
    try {
      await importTrips(page);const backup=await state(page);backup.settings.company='Synthetic restored company';
      // Seit 3.3c fragt „JSON auswählen“ vor dem Ersetzen ausdrücklich nach; hier bestätigen.
      page.on('dialog',dialog=>void dialog.accept());
      await nav(page,'Datensicherung');await page.evaluate(()=>navigator.serviceWorker.ready);
      await page.evaluate(()=>{const read=File.prototype.text;File.prototype.text=async function(){const value=await read.call(this);if(this.name==='synthetic-backup.json')await new Promise(resolve=>window.releaseBackupRead=resolve);return value;};});
      await page.locator('input[type=file]').setInputFiles({name:'synthetic-backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});await page.waitForFunction(()=>!!window.releaseBackupRead);
      workerRevision=1;await page.evaluate(async()=>{await(await navigator.serviceWorker.ready).update();});await page.getByRole('button',{name:'Jetzt aktualisieren',exact:true}).waitFor();
      await page.getByRole('button',{name:'Jetzt aktualisieren',exact:true}).click();await page.getByText(/Es gibt offene Eingaben/).waitFor();
      await page.evaluate(()=>window.releaseBackupRead());await waitState(page,s=>s.settings.company==='Synthetic restored company');
      assert.deepEqual(await state(page),JSON.parse(JSON.stringify(backup)));
    } finally {await context.close();}
  });
  // Tagessummen und Rechenweg stehen in der Zeitleiste der Monatsübersicht (frühere Reisen-Liste).
  await check('timeline keeps day totals and explanations, also across the month boundary',async()=>{
    workerRevision=0;const {context,page}=await start();
    try {
      await importTrips(page);await page.locator('input[type=month]').fill('2026-03');await nav(page,'Monatsübersicht');
      const timeline=page.getByRole('region',{name:'Monat im Überblick',exact:true});
      assert.match(await timeline.locator('.timeline-day').first().locator('.timeline-date').innerText(),/14,00/);
      await timeline.locator('.timeline-calc summary').first().click();assert.match(await timeline.locator('.timeline-calc').first().innerText(),/14,00.*Spesen/s);
      const saved=await state(page);saved.trips=[{...saved.trips[0],date:'2026-02-28',endDate:'2026-03-02',overnight:true}];await writeState(page,saved);await page.reload();await page.getByRole('heading',{name:'Monatsübersicht',exact:true}).waitFor();
      await page.locator('input[type=month]').fill('2026-03');await nav(page,'Monatsübersicht');assert.equal(await timeline.locator('.timeline-day').count(),2);
      assert.match(await timeline.locator('.timeline-day').first().locator('.timeline-date').innerText(),/28,00/);
    } finally {await context.close();}
  });
  await check('ready tabs cannot accept new edits while another tab delays its update acknowledgement',async()=>{
    workerRevision=0;const {context,page}=await start();
    try {
      await nav(page,'Einstellungen');await page.evaluate(()=>navigator.serviceWorker.ready);
      const second=await context.newPage();await second.goto(url);await second.getByRole('heading',{name:'Monatsübersicht',exact:true}).waitFor();
      await second.evaluate(()=>{const send=ServiceWorker.prototype.postMessage;ServiceWorker.prototype.postMessage=function(message,...rest){if(message?.type==='UPDATE_READINESS')setTimeout(()=>send.call(this,message,...rest),900);else send.call(this,message,...rest);};});
      await page.evaluate(()=>{navigator.serviceWorker.addEventListener('message',e=>{if(e.data?.type==='UPDATE_APPROVED')e.stopImmediatePropagation();},true);const send=ServiceWorker.prototype.postMessage;ServiceWorker.prototype.postMessage=function(message,...rest){if(message?.type==='UPDATE_READINESS')window.updateReady=message.ready;return send.call(this,message,...rest);};});
      workerRevision=1;await page.evaluate(async()=>{await (await navigator.serviceWorker.ready).update();});await page.getByRole('button',{name:'Jetzt aktualisieren',exact:true}).waitFor();
      await page.getByRole('button',{name:'Jetzt aktualisieren',exact:true}).click();await page.waitForFunction(()=>window.updateReady===true);
      assert.equal(await page.locator('.app-shell').evaluate(node=>node.inert),true,'acknowledged readiness must hold until activation/block');
      await page.getByRole('heading',{name:'Monatsübersicht',exact:true}).waitFor();
    } finally {await context.close();}
  });
  console.log(JSON.stringify({results,failures},null,2));if(failures.length)throw Error(`${failures.length} review regression(s) failed`);
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
