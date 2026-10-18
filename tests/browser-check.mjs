// Optional browser checks: existing Playwright installation, no project dependency.
// PLAYWRIGHT_MODULE=/absolute/path/to/playwright CHROMIUM_EXECUTABLE=/path/to/chromium node tests/browser-check.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import http from 'node:http';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve('dist');
let legacyMode = false;
const legacyWorker = `const CACHE="reisekosten-pro-v1.6.0";self.addEventListener("install",e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(["./"])));self.skipWaiting();});self.addEventListener("activate",e=>e.waitUntil(self.clients.claim()));self.addEventListener("fetch",e=>{if(e.request.method==="GET")e.respondWith(fetch(e.request).catch(()=>caches.match(e.request)));});`;
const server = http.createServer(async (req,res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if (!pathname.startsWith('/reisekosten-pro/')) throw Error();
    const file = path.resolve(root, pathname.slice('/reisekosten-pro/'.length) || 'index.html');
    if (!file.startsWith(root+'/')) throw Error();
    const body = legacyMode && pathname.endsWith('/sw.js') ? Buffer.from(legacyWorker) : await readFile(file);
    res.writeHead(200, {'Content-Type': ({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'})[path.extname(file)] || 'application/octet-stream', 'Cache-Control':'no-cache'}).end(body);
  } catch {res.writeHead(404).end('Not found');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}/reisekosten-pro/`;
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE ? {executablePath:process.env.CHROMIUM_EXECUTABLE}: {})});
const output=await mkdtemp(path.join(tmpdir(),'reisekosten-browser-'));
const results=[];
let syntheticBackup;
const check=async(name,fn)=>{await fn();results.push(name);console.log('PASS',name);};
const open=async(options={})=>{const context=await browser.newContext(options);const page=await context.newPage();return {context,page};};
const nav=async(page,name)=>{if(name==='Fahrten importieren'){await nav(page,'Reisen');await page.getByRole('button',{name:'Fahrten importieren',exact:true}).click();return;}if(await page.getByRole('button',{name:'Menü öffnen',exact:true}).isVisible())await page.getByRole('button',{name:'Menü öffnen',exact:true}).click();await page.locator('.sidebar nav').getByRole('button',{name:new RegExp('^'+name)}).click();await page.waitForTimeout(250);};
const state=page=>page.evaluate(()=>new Promise((resolve,reject)=>{const request=indexedDB.open('reisekosten-pro',1);request.onsuccess=()=>{const db=request.result;const tx=db.transaction('state');const r=tx.objectStore('state').get('main');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);tx.oncomplete=()=>db.close();};request.onerror=()=>reject(request.error);}));
const waitState=async(page,fn)=>{for(let i=0;i<60;i++){const s=await state(page);if(fn(s))return s;await page.waitForTimeout(100);}throw Error('Saved state condition timed out');};
const download=async(page,name)=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name,exact:true}).click();const d=await pending;const target=path.join(output,d.suggestedFilename());await d.saveAs(target);return {file:target,bytes:await readFile(target)};};
var activePage;
try {
  const {context,page}=await open(); const errors=[],failed=[],badHttp=[],external=[]; activePage=page;
  page.on('pageerror',e=>errors.push(e.message));page.on('requestfailed',r=>failed.push(r.url()));page.on('response',r=>{if(r.status()>=400)badHttp.push([r.url(),r.status()]);});page.on('request',r=>{if(!r.url().startsWith(url.slice(0,url.indexOf('/reisekosten-pro/'))) && !r.url().startsWith('data:') && !r.url().startsWith('blob:'))external.push([r.method(),r.url()]);});
  await check('production subpath / React / IndexedDB / manifest / worker',async()=>{
    await page.goto(url);await page.getByRole('heading',{name:'Reisen',exact:true}).waitFor();
    assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);assert.deepEqual(badHttp,[]);
    const manifest=await (await page.request.get(url+'manifest.webmanifest')).json();assert.equal(manifest.scope,'.');
    await page.evaluate(()=>navigator.serviceWorker.ready);
    assert.equal(await page.evaluate(()=>navigator.serviceWorker.controller?.scriptURL || navigator.serviceWorker.ready.then(r=>r.active.scriptURL)),url+'sw.js');
  });
  await page.locator('input[type=month]').fill('2026-03');
  const header='Abfahrt_datum;Abfahrt_uhrzeit;Ankunft_datum;Ankunft_uhrzeit;Betrieb_km;Arbeitsweg_km;Privat_km;Start Adresse;End Adresse;Anlass der Fahrt';
  const csv=[header,'09.03.2026;08:30;09.03.2026;09:00;12,5;0;0;Start;Testziel;Testtermin','09.03.2026;17:00;09.03.2026;17:30;25,75;0;0;Testziel;Start;Testtermin','09.03.2026;08:30;09.03.2026;09:00;12,5;0;0;Start;Testziel;Testtermin','09.03.2026;07:00;09.03.2026;07:30;0;10;0;Start;Büro;Arbeitsweg','09.03.2026;06:00;09.03.2026;06:30;0;0;5;Start;Privat;Privat'].join('\n');
  const importCsv=async()=>{await nav(page,'Übersicht');await nav(page,'Fahrten importieren');await page.locator('input[type=file]').setInputFiles({name:'synthetic-vimcar.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});await page.getByRole('button',{name:'Weiter',exact:true}).click();await page.getByRole('button',{name:'Weiter',exact:true}).click();await page.getByRole('heading',{name:/Datenzeilen/}).waitFor();const confirm=page.getByRole('button',{name:/^\d+ Fahrten importieren$/});if(await confirm.isEnabled())await confirm.click();};
  await check('Vimcar preview, duplicate detection, private/commute exclusion, daily absence',async()=>{
    await importCsv();const s=await waitState(page,s=>s?.trips.length===2);assert.equal(s.trips.reduce((v,t)=>v+t.businessKm,0),38.25);assert.ok(s.trips.every(t=>t.tripType==='dienstlich'&&!t.absenceConfirmed));
    assert.match(await page.locator('.result-grid').innerText(),/1\s+Duplikate/);
    await importCsv();assert.match(await page.locator('.result-grid').innerText(),/3\s+Duplikate/);
    await nav(page,'Reisen');assert.match(await page.locator('.day-list').innerText(),/9:00/);
    await nav(page,'Monatsabrechnungen');assert.match(await page.locator('.summary-grid').innerText(),/Kilometererstattung\s+0,00/);
  });
  await check('settings persist and private-car reimbursement',async()=>{
    await nav(page,'Einstellungen');await page.getByLabel('Firma',{exact:true}).fill('Synthetischer Test');
    await page.locator('.vehicle-list article').first().getByLabel('Fahrzeugart').selectOption('privatwagen');
    await page.getByRole('button',{name:'Einstellungen speichern',exact:true}).click();await waitState(page,s=>s?.settings.company==='Synthetischer Test');await page.reload();await page.getByRole('heading',{name:'Reisen',exact:true}).waitFor();await page.locator('input[type=month]').fill('2026-03');
    await nav(page,'Monatsabrechnungen');assert.match(await page.locator('.summary-grid').innerText(),/Kilometererstattung\s+11,48/);
  });
  // OCR asset loading is deliberately blocked; manual capture must remain usable.
  await context.route(/https?:\/\/(?!127\.0\.0\.1)/,r=>r.abort());
  await check('receipt file capture, OCR failure fallback, inbox, explicit no-trip assignment',async()=>{
    await page.getByRole('button',{name:'Beleg',exact:true}).click();
    const png=Buffer.from(await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=20;canvas.height=40;const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,20,40);ctx.fillStyle='black';ctx.fillRect(2,5,16,2);return canvas.toDataURL('image/png').split(',')[1];}),'base64');
    await page.locator('.receipt-capture input[type=file]').first().setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:png});
    await page.getByText('Die automatische Erkennung war nicht möglich.',{exact:false}).waitFor({timeout:20000});
    await page.locator('.receipt-capture').getByLabel('Datum',{exact:true}).fill('2026-03-09');await page.locator('.receipt-capture').getByLabel('Betrag (€)',{exact:true}).fill('12.50');
    await page.getByRole('button',{name:'Nur im Eingang speichern',exact:true}).click();await waitState(page,s=>s?.receiptInbox.length===1);
    await nav(page,'Kosten & Belege');await page.locator('.receipt-inbox').getByRole('button',{name:'Prüfen',exact:true}).click();
    await page.locator('.receipt-capture').getByLabel('Passende Reise').selectOption('');
    await page.getByRole('button',{name:'Bestätigen & Ausgabe anlegen',exact:true}).click();const s=await waitState(page,s=>s?.expenses.length===1);
    assert.equal(s.expenses[0].tripId,undefined);assert.equal(s.receiptInbox[0].status,'zugeordnet');assert.equal(s.expenses[0].receipt.type,'image/png');
  });
  await check('PDF with image attachment, Excel, CSV, ZIP exports and frozen approved statement',async()=>{
    await nav(page,'Monatsabrechnungen');await page.getByRole('button',{name:'Abrechnung erstellen',exact:true}).click();await waitState(page,s=>s?.statements.length===1);
    await page.locator('.statement-actions select').selectOption('freigegeben');const snapshot=await waitState(page,s=>s?.statements[0].locked);
    assert.equal(snapshot.statements[0].expensesSnapshot.length,1);
    const pdf=await download(page,'PDF');assert.equal(pdf.bytes.subarray(0,4).toString(),'%PDF');assert.ok((pdf.bytes.toString('latin1').match(/\/Type \/Page\b/g)||[]).length>=3);assert.ok(/\/Subtype \/Image/.test(pdf.bytes.toString('latin1')),'PDF embeds receipt image');assert.ok(pdf.bytes.toString('latin1').includes('Privatwagen'),'PDF uses reimbursed vehicle profile');
    const xlsx=await download(page,'Excel');assert.equal(xlsx.bytes.subarray(0,2).toString(),'PK');
    const csv=await download(page,'CSV');assert.match(csv.bytes.toString(),/11\.48/);assert.match(csv.bytes.toString(),/12\.5/);
    const zip=await download(page,'ZIP + Belege');assert.equal(zip.bytes.subarray(0,2).toString(),'PK');
    await nav(page,'Einstellungen');await page.locator('.vehicle-list article').first().getByLabel('Fahrzeugart').selectOption('dienstwagen');await page.getByRole('button',{name:'Einstellungen speichern',exact:true}).click();await waitState(page,s=>s?.settings.vehicles[0].ownership==='dienstwagen');
    await nav(page,'Monatsabrechnungen');assert.match(await page.locator('.summary-grid').innerText(),/Kilometererstattung\s+11,48/);
    await page.getByRole('button',{name:'Neue Version erstellen',exact:true}).click();await waitState(page,s=>s?.statements.length===2);assert.match(await page.locator('.summary-grid').innerText(),/Kilometererstattung\s+0,00/);
  });
  await check('JSON backup/restore round trip and rejection without overwriting data',async()=>{
    await nav(page,'Datensicherung');const backup=await download(page,'Sicherung herunterladen');syntheticBackup=backup.bytes;const saved=JSON.parse(backup.bytes);assert.equal(saved.expenses.length,1);
    await page.locator('.backup-grid input[type=file]').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({...saved,expenses:'broken'}))});await page.getByText('Ungültige Datensicherung',{exact:true}).waitFor();assert.deepEqual(JSON.parse(JSON.stringify(await state(page))),saved);
    await page.locator('.backup-grid input[type=file]').setInputFiles({name:'roundtrip.json',mimeType:'application/json',buffer:backup.bytes});await page.getByText('Datensicherung wiederhergestellt',{exact:true}).waitFor();assert.deepEqual(JSON.parse(JSON.stringify(await waitState(page,s=>s?.expenses.length===1))),saved);
  });
  await check('offline reload including lazy Excel chunk and foreign-cache preservation',async()=>{
    await page.evaluate(async()=>{const c=await caches.open('other-app-cache');await c.put('/other-app/test',new Response('keep'));await navigator.serviceWorker.ready;});
    assert.ok((await page.evaluate(()=>caches.keys())).includes('other-app-cache'));
    await page.reload();await page.getByRole('heading',{name:'Reisen',exact:true}).waitFor();await context.setOffline(true);await page.reload();await page.getByRole('heading',{name:'Reisen',exact:true}).waitFor();await page.locator('input[type=month]').fill('2026-03');await nav(page,'Monatsabrechnungen');await download(page,'Excel');await context.setOffline(false);
  });
  await check('mobile layout and menu, import, settings and receipt modal at 390px',async()=>{
    await page.setViewportSize({width:390,height:844});for(const name of ['Übersicht','Fahrten importieren','Kosten & Belege','Einstellungen']){await nav(page,name);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'horizontal page overflow in '+name);}
    await nav(page,'Kosten & Belege');
    await page.locator('.receipt-inbox').getByRole('button',{name:'Beleg fotografieren',exact:true}).click();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.waitForTimeout(300);await page.screenshot({path:path.join(output,'mobile.png')});
  });
  assert.equal(external.filter(([method])=>method!=='GET').length,0,'no receipt/data uploads');
  await context.close();
  await check('legacy worker update, foreign caches and IndexedDB preservation', async()=>{
    legacyMode=true;
    const {context,page}=await open();
    await page.goto(url);await page.getByRole('heading',{name:'Reisen',exact:true}).waitFor();await page.evaluate(()=>navigator.serviceWorker.ready);
    await nav(page,'Datensicherung');await page.locator('.backup-grid input[type=file]').setInputFiles({name:'synthetic-backup.json',mimeType:'application/json',buffer:syntheticBackup});await waitState(page,s=>s?.expenses.length===1);
    await page.evaluate(async()=>{
      const foreign=await caches.open('foreign-app');await foreign.put('/other-repo/marker',new Response('keep'));
      const old=await caches.open('reisekosten-pro-v1.6.0');await old.put('/other-repo/legacy',new Response('keep'));
    });
    const before=JSON.parse(JSON.stringify(await state(page)));
    legacyMode=false;
    await page.evaluate(async()=>{const registration=await navigator.serviceWorker.ready;await registration.update();});
    await page.waitForFunction(async()=>!!(await navigator.serviceWorker.getRegistration()).waiting);
    await page.close();
    const next=await context.newPage();await next.goto(url);await next.getByRole('heading',{name:'Reisen',exact:true}).waitFor();
    await next.waitForFunction(async()=>{const keys=await caches.keys();return keys.some(k=>k.startsWith('reisekosten-pro:/reisekosten-pro/:'));});
    assert.deepEqual(JSON.parse(JSON.stringify(await state(next))),before);
    const cachesKept=await next.evaluate(async()=>({foreign:!!await (await caches.open('foreign-app')).match('/other-repo/marker'),legacy:!!await (await caches.open('reisekosten-pro-v1.6.0')).match('/other-repo/legacy')}));
    assert.deepEqual(cachesKept,{foreign:true,legacy:true});
    await context.close();
  });
  for (const mode of ['denied','malformed','quota','bundle','render']) await check('visible error: '+mode,async()=>{
    const {context,page}=await open();
    if(mode==='denied')await context.addInitScript(()=>{indexedDB.open=()=>{throw new DOMException('Storage denied','SecurityError');};});
    if(mode==='quota')await context.addInitScript(()=>{IDBObjectStore.prototype.put=()=>{throw new DOMException('Storage full','QuotaExceededError');};});
    if(mode==='render')await context.addInitScript(()=>{Number.prototype.toLocaleString=()=>{throw Error('Synthetic render error');};});
    if(mode==='bundle')await context.route('**/assets/*.js',r=>r.abort());
    if(mode==='malformed'){await page.goto(url);await page.getByRole('heading',{name:'Reisen',exact:true}).waitFor();await page.evaluate(()=>new Promise(resolve=>{const r=indexedDB.open('reisekosten-pro',1);r.onsuccess=()=>{const tx=r.result.transaction('state','readwrite');tx.objectStore('state').put({settings:{},trips:[],expenses:'broken'},'main');tx.oncomplete=()=>{r.result.close();resolve();};};}));}
    await page.goto(url);
    if(mode==='denied'||mode==='malformed'){await page.getByRole('heading',{name:'Lokale Daten konnten nicht geöffnet werden'}).waitFor();if(mode==='malformed')assert.equal((await state(page)).expenses,'broken');}
    if(mode==='bundle')await page.getByText(/Die Anwendung konnte nicht geladen werden|Programmdateien konnten nicht geladen werden/).waitFor();
    if(mode==='render'){await page.getByRole('heading',{name:'Reisen',exact:true}).waitFor();await nav(page,'Übersicht');await page.getByRole('heading',{name:'Reisekosten Pro konnte nicht gestartet werden'}).waitFor();}
    if(mode==='quota'){await page.getByRole('heading',{name:'Reisen',exact:true}).waitFor();await nav(page,'Einstellungen');await page.getByLabel('Firma',{exact:true}).fill('Synthetic');await page.getByRole('button',{name:'Einstellungen speichern',exact:true}).click();await page.getByRole('alert').getByText(/Änderungen konnten nicht lokal gespeichert/).waitFor();}
    await context.close();
  });
  console.log(JSON.stringify({checks:results.length,results,output},null,2));
} catch(error) {if(activePage && !activePage.isClosed()){console.error(await activePage.locator('body').innerText());await activePage.screenshot({path:path.join(output,'failure.png'),fullPage:true});}throw error;} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
