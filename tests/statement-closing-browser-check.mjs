// Synthetic closing checks against the local production build, using existing Playwright.
// PLAYWRIGHT_MODULE=/absolute/path/to/playwright BROWSER_EXECUTABLE=/path/to/browser node tests/statement-closing-browser-check.mjs
// Optional BROWSER_ENGINE=webkit for Safari-engine coverage.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
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
const browser=await engines[engine].launch({headless:true,...(process.env.BROWSER_EXECUTABLE ? {executablePath:process.env.BROWSER_EXECUTABLE}: {})});
const output=await mkdtemp(path.join(tmpdir(),'reisekosten-browser-'));
const results=[];
const check=async(name,fn)=>{await fn();results.push(name);console.log('PASS',name);};
const open=async(options={})=>{const context=await browser.newContext(options);const page=await context.newPage();return {context,page};};
const nav=async(page,name)=>{if(name==='Fahrten importieren'){await nav(page,'Monatsübersicht');await page.locator('.month-entry-workspace').getByRole('button',{name:'Fahrtenbuch importieren',exact:true}).click();return;}if(await page.getByRole('button',{name:'Menü öffnen',exact:true}).isVisible())await page.getByRole('button',{name:'Menü öffnen',exact:true}).click();await page.locator('.sidebar nav').getByRole('button',{name:new RegExp('^'+name)}).click();await page.waitForTimeout(250);};
const state=page=>page.evaluate(()=>new Promise((resolve,reject)=>{const request=indexedDB.open('reisekosten-pro',1);request.onsuccess=()=>{const db=request.result;const tx=db.transaction('state');const r=tx.objectStore('state').get('main');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);tx.oncomplete=()=>db.close();};request.onerror=()=>reject(request.error);}));
const waitState=async(page,fn)=>{for(let i=0;i<60;i++){const s=await state(page);if(fn(s))return s;await page.waitForTimeout(100);}throw Error('Saved state condition timed out');};
const download=async(page,name)=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name,exact:true}).click();const d=await pending;const target=path.join(output,d.suggestedFilename());await d.saveAs(target);return {file:target,bytes:await readFile(target)};};
// Purely synthetic dates, trips and reports; never uses a real browser profile.
const writeState=(page,value)=>page.evaluate(value=>new Promise((resolve,reject)=>{const r=indexedDB.open('reisekosten-pro',1);r.onsuccess=()=>{const tx=r.result.transaction('state','readwrite');tx.objectStore('state').put(value,'main');tx.oncomplete=()=>{r.result.close();resolve();};tx.onabort=()=>reject(tx.error);};}),value);
try {
  for(const viewport of [{width:390,height:844},{width:820,height:1180},{width:1440,height:1000}]) {
    const {context,page}=await open({viewport,timezoneId:'Europe/Berlin'});
    await page.clock.setFixedTime(new Date('2026-10-18T10:00:00Z'));
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    const workspace=page.getByRole('region',{name:'Monatsarbeitsbereich',exact:true});
    const review=page.getByRole('region',{name:'Abschlussprüfung',exact:true});
    const dialog=page.getByRole('dialog');
    const fits=async()=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'horizontal overflow');
    const resume=async()=>{await page.locator('input[type=month]').fill('2026-06');await workspace.getByRole('button',{name:/^Abrechnung (fortsetzen|ansehen)$/}).click();await page.locator('.statement-head').waitFor();};
    const reload=async()=>{await page.reload();await page.getByRole('heading',{name:'Monatsübersicht',exact:true}).waitFor();await resume();};
    const accept=async()=>{for(const checkbox of await dialog.getByRole('checkbox').all())await checkbox.check();};
    let frozen;
    try {
      await page.goto(url);await page.getByRole('heading',{name:'Monatsübersicht',exact:true}).waitFor();
      await nav(page,'Datensicherung');await page.getByRole('button',{name:'Demo-Daten laden',exact:true}).click();
      const seed=await waitState(page,s=>s?.trips.length>0);
      seed.trips=[{...seed.trips[0],id:'closing-trip',date:'2026-06-10',endDate:'2026-06-10',startTime:'08:00',endTime:'17:00',destination:'Musterstadt',purpose:'Synthetischer Termin',order:'26.0123 Musterstadt',businessKm:0,privateKm:0,tripType:'dienstlich',absenceConfirmed:true,manualAbsenceMinutes:undefined,overnight:false,status:'geprüft',warnings:[],meals:{breakfast:false,lunch:false,dinner:false},dailyMeals:{}}];
      seed.expenses=[{...seed.expenses[0],id:'closing-cost',date:'2026-06-10',category:'Parken',description:'Synthetisches Parken',gross:25,net:25,vat:0,vatRate:0,exchangeRate:1,businessShare:100,currency:'EUR',paymentType:'unbekannt',reimbursementStatus:'offen',status:'ungeprüft',warnings:[],receipt:undefined,tripId:'closing-trip',projectNumber:'26.0123',stayStart:undefined,stayEnd:undefined}];
      seed.statements=[];seed.changes=[];seed.receiptInbox=[];seed.merchantRules=[];
      await writeState(page,seed);await page.reload();await page.getByRole('heading',{name:'Monatsübersicht',exact:true}).waitFor();await page.locator('input[type=month]').fill('2026-06');
      await check(`${engine} ${viewport.width}: explicit draft and PDF/Excel never close or mark the month green`,async()=>{
        await workspace.getByRole('button',{name:'Spesenabrechnung erstellen',exact:true}).click();
        const saved=await waitState(page,s=>s?.statements.length===1);assert.equal(saved.statements[0].locked,false);
        assert.equal(saved.statements[0].data.totals.openAmount,14);assert.match(await review.innerText(),/Beleg fehlt/);assert.match(await review.innerText(),/Zahlungsart unbekannt/);
        const options=await page.getByLabel('Abrechnungsstatus',{exact:true}).locator('option').allTextContents();assert.ok(!options.includes('freigegeben'));assert.ok(!options.includes('ausgezahlt'));
        assert.equal((await download(page,'PDF')).bytes.subarray(0,4).toString(),'%PDF');assert.equal((await download(page,'Excel')).bytes.subarray(0,2).toString(),'PK');
        assert.deepEqual((await state(page)).statements,saved.statements);assert.doesNotMatch(await page.locator('.year-month.selected').getAttribute('class'),/month-closed/);
      });
      await check(`${engine} ${viewport.width}: affected warning opens the existing cost editor directly`,async()=>{
        await review.getByRole('button',{name:'Kosten bearbeiten',exact:true}).first().click();
        const modal=page.locator('.modal');assert.equal(await modal.getByLabel('Beschreibung',{exact:true}).inputValue(),'Synthetisches Parken');
        await modal.getByRole('button',{name:'Abbrechen',exact:true}).click();await nav(page,'Monatsübersicht');await resume();
      });
      await check(`${engine} ${viewport.width}: both explicit confirmations are required; dialog remains responsive`,async()=>{
        await review.getByRole('button',{name:'Monatsabrechnung abschließen',exact:true}).click();
        assert.equal(await dialog.getByRole('button',{name:'Verbindlich abschließen',exact:true}).isEnabled(),false);
        assert.match(await dialog.innerText(),/Offene persönliche Erstattung\s+14,00/);
        await dialog.getByRole('checkbox').first().check();assert.equal(await dialog.getByRole('button',{name:'Verbindlich abschließen',exact:true}).isEnabled(),false);
        await accept();assert.equal(await dialog.getByRole('button',{name:'Verbindlich abschließen',exact:true}).isEnabled(),true);
        await fits();assert.equal(await dialog.evaluate(element=>element.scrollWidth>element.clientWidth),false);
        await dialog.screenshot({path:path.join(output,`${engine}-${viewport.width}-closing.png`)});
        await dialog.getByRole('button',{name:'Abbrechen',exact:true}).click();assert.equal((await state(page)).statements[0].locked,false);
      });
      await check(`${engine} ${viewport.width}: failed IndexedDB write never reports or persists a successful close`,async()=>{
        await review.getByRole('button',{name:'Monatsabrechnung abschließen',exact:true}).click();await accept();
        await page.evaluate(()=>{window.closingPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,...rest){if(value?.statements?.some(item=>item.locked))throw new DOMException('Synthetischer Abschluss-Speicherfehler','QuotaExceededError');return window.closingPut.call(this,value,...rest);};});
        await dialog.getByRole('button',{name:'Verbindlich abschließen',exact:true}).click();await dialog.getByRole('alert').waitFor();
        assert.match(await dialog.getByRole('alert').innerText(),/Speicherfehler/);assert.equal((await state(page)).statements[0].locked,false);
        assert.equal(await page.getByText('Monatsabrechnung lokal gespeichert und abgeschlossen.',{exact:true}).count(),0);
        assert.doesNotMatch(await page.locator('.year-month.selected').getAttribute('class'),/month-closed/);
        await page.evaluate(()=>IDBObjectStore.prototype.put=window.closingPut);
      });
      await check(`${engine} ${viewport.width}: rapid double click closes exactly once, freezes the draft and does not pay it`,async()=>{
        const before=(await state(page)).statements[0];
        await dialog.getByRole('button',{name:'Verbindlich abschließen',exact:true}).evaluate(button=>{button.click();button.click();});
        const saved=await waitState(page,s=>s?.statements[0].locked);await dialog.waitFor({state:'hidden'});
        assert.equal(saved.statements.length,1);assert.equal(saved.changes.filter(change=>change.entityType==='statement'&&change.newValue?.status==='freigegeben').length,1);
        assert.deepEqual(saved.statements[0],{...before,status:'freigegeben',locked:true});assert.match(await page.locator('.year-month.selected').getAttribute('class'),/month-closed/);
        assert.equal((await download(page,'PDF')).bytes.subarray(0,4).toString(),'%PDF');assert.equal((await download(page,'Excel')).bytes.subarray(0,2).toString(),'PK');
        assert.deepEqual((await state(page)).statements,saved.statements);
        await page.getByLabel('Abrechnungsstatus',{exact:true}).selectOption('ausgezahlt');frozen=(await waitState(page,s=>s?.statements[0].status==='ausgezahlt')).statements[0];
        assert.ok(!(await page.getByLabel('Abrechnungsstatus',{exact:true}).locator('option').allTextContents()).includes('freigegeben'));
      });
      await check(`${engine} ${viewport.width}: equal totals with changed cost details make a draft stale without overwriting it`,async()=>{
        // An unchanged close no longer offers a redundant identical correction.
        const changed=await state(page);changed.expenses[0].description='Synthetischer Korrekturanlass';await writeState(page,changed);await reload();
        await page.getByRole('button',{name:'Neue Version erstellen',exact:true}).click();const saved=await waitState(page,s=>s?.statements.length===2);const draft=structuredClone(saved.statements[1]);
        saved.expenses[0].description='Geänderte synthetische Einzelposition';await writeState(page,saved);await reload();
        assert.match(await review.innerText(),/Seit Erstellung des Entwurfs/);assert.equal(await review.getByRole('button',{name:'Monatsabrechnung abschließen',exact:true}).isEnabled(),false);
        assert.deepEqual((await state(page)).statements[1],draft);assert.deepEqual((await state(page)).statements[0],frozen);
        assert.doesNotMatch(await page.locator('.year-month.selected').getAttribute('class'),/month-closed/);
      });
      await check(`${engine} ${viewport.width}: legacy drafts remain readable and exportable but require a new version`,async()=>{
        const saved=await state(page);delete saved.statements[1].settingsSnapshot;delete saved.statements[1].expensesSnapshot;await writeState(page,saved);await reload();
        assert.match(await review.innerText(),/älteren Entwurf fehlen Vergleichsinformationen/);assert.equal(await review.getByRole('button',{name:'Monatsabrechnung abschließen',exact:true}).isEnabled(),false);
        assert.equal((await download(page,'PDF')).bytes.subarray(0,4).toString(),'%PDF');assert.deepEqual((await state(page)).statements[0],frozen);
        await page.getByRole('button',{name:'Neue Version erstellen',exact:true}).click();await waitState(page,s=>s?.statements.length===3);
      });
      await check(`${engine} ${viewport.width}: unconfirmed allowance duration blocks closing and links to the existing trip editor`,async()=>{
        const saved=await state(page);saved.trips[0].absenceConfirmed=false;await writeState(page,saved);await reload();
        assert.match(await review.innerText(),/für die Verpflegungsberechnung benötigte Abwesenheitsdauer/);assert.equal(await review.getByRole('button',{name:'Monatsabrechnung abschließen',exact:true}).isEnabled(),false);
        await review.locator('.closing-errors').getByRole('button',{name:'Reise bearbeiten',exact:true}).first().click();
        assert.equal(await page.locator('.modal').getByLabel('Abfahrt Datum *',{exact:true}).inputValue(),'2026-06-10');
        await page.locator('.modal').getByRole('button',{name:'Abbrechen',exact:true}).click();await nav(page,'Monatsübersicht');await resume();
        const restored=await state(page);restored.trips[0].absenceConfirmed=true;restored.expenses[0].notes='Synthetischer neuer Prüfstand';await writeState(page,restored);await reload();
        await page.getByRole('button',{name:'Neue Version erstellen',exact:true}).click();await waitState(page,s=>s?.statements.length===4);
      });
      await check(`${engine} ${viewport.width}: data changed in another tab after confirmation cannot be overwritten or approved`,async()=>{
        await review.getByRole('button',{name:'Monatsabrechnung abschließen',exact:true}).click();await accept();
        const external=await state(page);external.expenses[0].description='Synthetische Änderung in anderem Tab';await writeState(page,external);
        await dialog.getByRole('button',{name:'Verbindlich abschließen',exact:true}).click();await dialog.getByRole('alert').waitFor();assert.match(await dialog.getByRole('alert').innerText(),/anderen Tab/);
        assert.deepEqual(await state(page),external);assert.equal(external.statements[3].locked,false);assert.deepEqual(external.statements[0],frozen);
        await dialog.getByRole('button',{name:'Abbrechen',exact:true}).click();await reload();assert.match(await review.innerText(),/Seit Erstellung des Entwurfs/);
      });
      await check(`${engine} ${viewport.width}: offline reload preserves all snapshots and the stale draft remains unapproved`,async()=>{
        const before=await state(page);await page.evaluate(()=>navigator.serviceWorker.ready);await page.reload();await page.getByRole('heading',{name:'Monatsübersicht',exact:true}).waitFor();
        await context.setOffline(true);await page.reload();await page.getByRole('heading',{name:'Monatsübersicht',exact:true}).waitFor();await resume();
        assert.deepEqual(await state(page),before);assert.deepEqual(before.statements[0],frozen);assert.equal(before.statements[3].locked,false);await fits();assert.deepEqual(errors,[]);await context.setOffline(false);
      });
    } catch(error){await page.screenshot({path:path.join(output,`${engine}-${viewport.width}-failure.png`),fullPage:true});throw error;}
    finally{await context.close();}
  }
  console.log(JSON.stringify({url,output,engine,checks:results.length,results},null,2));
} catch(error){console.error('Browser failure artifacts:',output);throw error;}
finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
