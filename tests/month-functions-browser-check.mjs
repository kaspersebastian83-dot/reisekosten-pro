// Optional browser checks: existing Playwright installation, no project dependency.
// PLAYWRIGHT_MODULE=/absolute/path/to/playwright BROWSER_EXECUTABLE=/path/to/browser node tests/month-functions-browser-check.mjs
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
const pdf=n=>'data:application/pdf;base64,'+Buffer.from(`%PDF-1.4 synthetic inbox ${n}`).toString('base64');
const inboxItem=(id,day)=>({id,receipt:{id:`r-${id}`,name:`synthetic-${id}.pdf`,type:'application/pdf',size:40,hash:`hash-${id}`,dataUrl:pdf(id)},capturedAt:`2026-07-${day}T10:00:00.000Z`,status:'neu',suggestion:{date:`2026-07-${day}`,gross:0,confidence:0},notes:''});
try {
  for(const viewport of [{width:1440,height:1000},{width:390,height:844}]) {
    const {context,page}=await open({viewport,timezoneId:'Europe/Berlin'});
    await context.route(/https?:\/\/(?!127\.0\.0\.1)/,r=>r.abort());
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.clock.setFixedTime(new Date('2026-10-18T10:00:00Z'));
    const workspace=page.getByRole('region',{name:'Monatsarbeitsbereich',exact:true});
    const timeline=page.getByRole('region',{name:'Monat im Überblick',exact:true});
    const editor=page.locator('.modal');const capture=page.locator('.receipt-capture');
    const fits=async()=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'page overflow');
    const july=async()=>{await nav(page,'Monatsübersicht');await page.locator('.year-months').getByRole('button',{name:/^Juli 2026 ·/}).click();await workspace.waitFor();};
    try {
      await page.goto(url);await page.getByRole('heading',{name:'Monatsübersicht',exact:true}).waitFor();
      await nav(page,'Datensicherung');await page.getByRole('button',{name:'Demo-Daten laden',exact:true}).click();
      const seed=await waitState(page,s=>s?.trips.length>0);seed.receiptInbox=[inboxItem('b',12),inboxItem('a',11)];seed.changes=[];
      await writeState(page,seed);await page.reload();await page.getByRole('heading',{name:'Monatsübersicht',exact:true}).waitFor();await july();
      await check(`${engine} ${viewport.width}: import is reachable from the month and returns to it`,async()=>{
        await workspace.getByRole('button',{name:'Fahrtenbuch importieren',exact:true}).click();
        await page.locator('input[type=file]').first().waitFor({state:'attached'});assert.match(await page.locator('.content').innerText(),/Fahrten importieren|Datei/);
        await page.getByRole('button',{name:'Zurück zum Monatsarbeitsbereich',exact:true}).click();await workspace.waitFor();assert.match(await workspace.innerText(),/Juli 2026/);
      });
      await check(`${engine} ${viewport.width}: receipt inbox is worked through one after another`,async()=>{
        const banner=workspace.getByRole('region',{name:'Beleg-Eingang',exact:true});assert.match(await banner.innerText(),/2 Belege warten auf Zuordnung/);
        await banner.getByRole('button',{name:'Nacheinander zuordnen',exact:true}).click();await capture.waitFor();
        assert.match(await capture.innerText(),/Beleg 1 von 2/i);assert.match(await capture.innerText(),/synthetic-a\.pdf/,'oldest first');
        await capture.getByLabel('Betrag (€)',{exact:true}).fill('7.5');await capture.getByRole('button',{name:'Bestätigen & Ausgabe anlegen',exact:true}).click();
        const after=await waitState(page,s=>s?.receiptInbox.find(i=>i.id==='a')?.status==='zugeordnet');assert.ok(after.expenses.some(e=>e.gross===7.5));
        await page.waitForFunction(()=>/Beleg 2 von 2/i.test(document.querySelector('.receipt-capture')?.textContent||''));assert.match(await capture.innerText(),/synthetic-b\.pdf/);
        await capture.getByRole('button',{name:'Schließen',exact:true}).click();await capture.waitFor({state:'detached'});
        assert.match(await banner.innerText(),/1 Beleg wartet auf Zuordnung/);assert.equal((await state(page)).receiptInbox.find(i=>i.id==='b').status,'neu');
        await fits();
      });
      await check(`${engine} ${viewport.width}: checks filter the timeline; calculation is explained per day`,async()=>{
        const checks=page.getByRole('region',{name:'Prüfen',exact:true});await checks.locator('summary').first().click();
        await checks.getByRole('button',{name:/Fehlende Belege/}).click();
        const filterNote=timeline.locator('.timeline-filter');await filterNote.waitFor();assert.match(await filterNote.innerText(),/Fehlende Belege/);
        const shown=await timeline.locator('.timeline-entry').count();assert.ok(shown>0);assert.equal(await timeline.locator('.timeline-entry.trip').count(),0);
        assert.equal(await timeline.locator('.timeline-entry').filter({hasText:'Beleg fehlt'}).count(),shown,'only entries without receipt');
        await filterNote.getByRole('button',{name:'Alle anzeigen',exact:true}).click();assert.ok(await timeline.locator('.timeline-entry.trip').count()>0);
        await timeline.locator('.timeline-calc summary').first().click();assert.match(await timeline.locator('.timeline-calc').first().innerText(),/Pauschale vor Kürzung/);
        await fits();
      });
      await check(`${engine} ${viewport.width}: trips and expenses can be deleted from their window after confirmation`,async()=>{
        const before=await state(page);const expense=before.expenses.find(e=>e.id===before.receiptInbox.find(i=>i.id==='a').expenseId);
        await timeline.getByRole('button',{name:new RegExp(`${expense.category} .*bearbeiten`)}).first().click();await editor.waitFor();
        page.once('dialog',d=>void d.dismiss());await editor.getByRole('button',{name:'Löschen',exact:true}).click();await page.waitForTimeout(200);
        assert.equal((await state(page)).expenses.length,before.expenses.length,'cancelled confirmation keeps the entry');
        page.once('dialog',d=>void d.accept());await editor.getByRole('button',{name:'Löschen',exact:true}).click();
        const s1=await waitState(page,s=>s?.expenses.length===before.expenses.length-1);await editor.waitFor({state:'detached'});
        assert.equal(s1.receiptInbox.find(i=>i.id==='a').status,'neu','receipt returns to the inbox');assert.equal(s1.changes.at(-1).newValue,'gelöscht');
        const trip=s1.trips.find(t=>t.date.startsWith('2026-07')&&t.destination==='Bonn');
        await timeline.locator('.timeline-entry.trip').filter({hasText:'Bonn'}).first().click();await editor.waitFor();
        page.once('dialog',d=>void d.accept());await editor.getByRole('button',{name:'Reise löschen',exact:true}).click();
        const s2=await waitState(page,s=>s?.trips.length===s1.trips.length-1);assert.equal(s2.changes.at(-1).entityType,'trip');assert.ok(trip);
        await editor.waitFor({state:'detached'});
        await workspace.getByRole('button',{name:'Dienstreise erfassen',exact:true}).click();await editor.waitFor();
        assert.equal(await editor.getByRole('button',{name:'Reise löschen',exact:true}).count(),0,'no delete for a new draft');
        await editor.getByRole('button',{name:'Abbrechen',exact:true}).click();assert.deepEqual(errors,[]);
      });
    } catch(error){await page.screenshot({path:path.join(output,`${engine}-${viewport.width}-functions-failure.png`),fullPage:true});throw error;}
    finally {await context.close();}
  }
  console.log(JSON.stringify({url,output,engine,checks:results.length,results},null,2));
} catch(error){console.error('Browser failure artifacts:',output);throw error;}
finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
