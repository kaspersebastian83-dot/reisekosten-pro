// Optional browser checks: existing Playwright installation, no project dependency.
// PLAYWRIGHT_MODULE=/absolute/path/to/playwright BROWSER_EXECUTABLE=/path/to/browser node tests/workflow-browser-check.mjs
// Optional BROWSER_ENGINE=webkit for Safari-engine coverage.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { closeStatementInBrowser } from './close-statement-browser.mjs';
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
const names=['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
try {
  for(const [timezone,time,expected] of [['Europe/Berlin','2026-12-05T10:00:00Z','2026-11'],['Pacific/Kiritimati','2026-12-31T10:05:00Z','2026-12']]) {
    const {context,page}=await open({timezoneId:timezone});
    try {
      await page.clock.setFixedTime(new Date(time));await page.goto(url);await page.getByRole('heading',{name:'Monatsübersicht',exact:true}).waitFor();
      await check(`${engine}: previous local month at ${timezone} ${time}`,async()=>{
        assert.equal(await page.locator('input[type=month]').inputValue(),expected);
        await nav(page,'Monatsübersicht');assert.equal(await page.locator('.year-month').count(),12);
        assert.equal(await state(page),undefined);assert.equal(await page.evaluate(()=>localStorage.length),0);
      });
    } finally {await context.close();}
  }
  for(const viewport of [{width:1440,height:1000},{width:820,height:1180},{width:390,height:844}].filter(v=>!process.env.VIEWPORT_WIDTH || v.width===Number(process.env.VIEWPORT_WIDTH))) {
    const {context,page}=await open({viewport,timezoneId:'Europe/Berlin'});await page.clock.setFixedTime(new Date('2026-12-05T10:00:00Z'));
    const errors=[];page.on('pageerror',e=>errors.push(e.message));const picker=page.locator('input[type=month]');
    const monthButton=(name,year=2026)=>page.locator('.year-months').getByRole('button',{name:new RegExp(`^${name} ${year} ·`)});
    const fits=async()=>{
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'horizontal page overflow');
      const clipped=await page.locator('.year-month').evaluateAll(buttons=>buttons.filter(b=>b.scrollWidth>b.clientWidth+1).map(b=>b.getAttribute('aria-label')));
      assert.deepEqual(clipped,[],'content overflows a month button');
    };
    let baseline,frozen;
    try {
      await page.goto(url+'?demo=1');await page.getByRole('heading',{name:'Monatsübersicht',exact:true}).waitFor();
      assert.equal(await picker.inputValue(),'2026-11');await picker.fill('');assert.equal(await picker.inputValue(),'2026-11');
      await nav(page,'Datensicherung');await page.getByRole('button',{name:'Demo-Daten laden',exact:true}).click();
      const seed=await waitState(page,s=>s?.trips.length>0);
      const base={...seed.trips[0],startTime:'08:00',endTime:'17:00',businessKm:0,privateKm:0,tripType:'dienstlich',status:'ungeprüft',warnings:[],absenceConfirmed:true,manualAbsenceMinutes:undefined,meals:{breakfast:false,lunch:false,dinner:false},dailyMeals:{}};
      seed.trips=[{...base,id:'jan',date:'2026-01-10',endDate:'2026-01-10'},{...base,id:'cross-month',date:'2026-07-30',endDate:'2026-08-02',overnight:true},{...base,id:'sep',date:'2026-09-10',endDate:'2026-09-10',destination:'',warnings:['Reiseziel fehlt']},{...base,id:'current',date:'2026-12-02',endDate:'2026-12-02'},{...base,id:'future',date:'2027-01-02',endDate:'2027-01-02'}];
      seed.expenses=[{...seed.expenses[0],id:'aug-expense',date:'2026-08-03',category:'Parken',gross:12,net:12,vat:0,paymentType:'privat vorgestreckt',status:'ungeprüft',warnings:[]}];
      seed.statements=[];seed.receiptInbox=[];seed.changes=[];seed.merchantRules=[];
      await writeState(page,seed);await page.reload();await page.getByRole('heading',{name:'Monatsübersicht',exact:true}).waitFor();await nav(page,'Monatsübersicht');
      await check(`${engine} ${viewport.width}: PDF/draft do not close a month; explicit persisted approval does`,async()=>{
        await monthButton('Januar').click();assert.match(await monthButton('Januar').getAttribute('class'),/month-working/);
        await page.getByRole('button',{name:'Spesenabrechnung erstellen',exact:true}).click();await waitState(page,s=>s?.statements.length===1);const before=await state(page);
        assert.equal((await download(page,'PDF')).bytes.subarray(0,4).toString(),'%PDF');assert.equal((await download(page,'Excel')).bytes.subarray(0,2).toString(),'PK');
        assert.deepEqual(await state(page),before);assert.match(await monthButton('Januar').getAttribute('class'),/month-working/);
        await closeStatementInBrowser(page);const saved=await waitState(page,s=>s?.statements[0].locked);frozen=saved.statements[0];
        assert.match(await monthButton('Januar').getAttribute('class'),/month-closed/);assert.match(await monthButton('Januar').getAttribute('aria-label'),/Abgeschlossen/);
        await monthButton('Oktober').click();await page.getByRole('button',{name:'Spesenabrechnung erstellen',exact:true}).click();const drafts=await waitState(page,s=>s?.statements.length===2);
        assert.match(await monthButton('Oktober').getAttribute('class'),/month-open/);
        const emptyDraft=drafts.statements[1];drafts.statements.push({...emptyDraft,id:'historical',month:'2025-12',status:'ausgezahlt',locked:true,data:{...emptyDraft.data,month:'2025-12'}});
        await writeState(page,drafts);await page.reload();await page.getByRole('heading',{name:'Monatsübersicht',exact:true}).waitFor();await nav(page,'Monatsübersicht');baseline=await state(page);
      });
      await check(`${engine} ${viewport.width}: twelve accessible months, clear stored statuses and unique cross-month trip count`,async()=>{
        assert.equal(await page.locator('.year-month').count(),12);
        assert.match(await monthButton('Juli').getAttribute('aria-label'),/In Bearbeitung · 1 Reise/);assert.match(await monthButton('August').getAttribute('aria-label'),/In Bearbeitung · 1 Reise/);
        assert.match(await monthButton('September').getAttribute('aria-label'),/Prüfung erforderlich/);assert.match(await monthButton('Oktober').getAttribute('aria-label'),/Offen/);
        for(let i=0;i<12;i++){const button=monthButton(names[i]);assert.ok((await button.boundingBox()).height>=44);await button.click();assert.equal(await picker.inputValue(),`2026-${String(i+1).padStart(2,'0')}`);assert.equal(await button.getAttribute('aria-current'),'date');}
        assert.deepEqual(await state(page),baseline);await monthButton('September').click();await page.locator('.month-checks summary').click();assert.match(await page.locator('.month-checks .month-review').innerText(),/Reiseziel fehlt/);
        await fits();const left=await page.locator('.year-navigation').boundingBox();const right=await page.locator('.month-statement').boundingBox();
        assert.ok(left.y+left.height<=right.y+1,'month bar above the month');if(viewport.width!==390){const tops=await page.locator('.year-month').evaluateAll(b=>b.map(x=>Math.round(x.getBoundingClientRect().top)));assert.equal(new Set(tops).size,1,'all twelve months in one row');}
        await page.screenshot({path:path.join(output,`${engine}-${viewport.width}-year.png`),fullPage:false});
      });
      await check(`${engine} ${viewport.width}: year browsing preserves selected month; historical frozen report remains intact`,async()=>{
        await monthButton('August').click();await page.getByRole('button',{name:'Nächstes Jahr',exact:true}).click();assert.equal(await page.locator('.year-switch h2').innerText(),'2027');assert.equal(await picker.inputValue(),'2026-08');
        await monthButton('Januar',2027).click();assert.equal(await picker.inputValue(),'2027-01');
        await page.getByRole('button',{name:'Vorheriges Jahr',exact:true}).click();await page.getByRole('button',{name:'Vorheriges Jahr',exact:true}).click();
        await monthButton('Dezember',2025).click();assert.match(await monthButton('Dezember',2025).getAttribute('aria-label'),/Abgeschlossen/);await page.getByRole('button',{name:'Abrechnung ansehen',exact:true}).click();assert.match(await page.locator('.statement-head').innerText(),/Dezember 2025/);
        assert.deepEqual(await state(page),baseline);assert.equal(await page.evaluate(()=>localStorage.length),0);
      });
      await check(`${engine} ${viewport.width}: oldest backlog crosses year and shares selection across all existing sections`,async()=>{
        const backlog=page.getByRole('region',{name:'Offene Abrechnungsmonate'});
        assert.match(await backlog.innerText(),/3 Monate mit offenen Abrechnungen/);await backlog.getByRole('button',{name:'Mit Juli 2026 beginnen',exact:true}).click();assert.equal(await picker.inputValue(),'2026-07');assert.equal(await page.locator('.year-switch h2').innerText(),'2026');
        await monthButton('August').click();
        // Reisen und Kosten des gewählten Monats stehen in der Zeitleiste; andere Bereiche behalten die Auswahl.
        const timeline=page.getByRole('region',{name:'Monat im Überblick',exact:true});assert.equal(await timeline.locator('.timeline-entry.trip').count(),2);assert.equal(await timeline.locator('.timeline-entry.expense').count(),1);
        await nav(page,'Einstellungen');assert.equal(await picker.inputValue(),'2026-08');
        await nav(page,'Monatsübersicht');assert.equal(await picker.inputValue(),'2026-08');assert.match(await page.getByRole('region',{name:'Monatsarbeitsbereich',exact:true}).innerText(),/August 2026/);
        await nav(page,'Monatsübersicht');assert.equal(await picker.inputValue(),'2026-08');assert.match(await page.getByRole('region',{name:'Monatsarbeitsbereich',exact:true}).innerText(),/August 2026/);assert.deepEqual(await state(page),baseline);
      });
      await check(`${engine} ${viewport.width}: normal close updates backlog; offline reload keeps records and resets only session selection`,async()=>{
        await page.getByRole('button',{name:'Mit Juli 2026 beginnen',exact:true}).click();await page.getByRole('button',{name:'Spesenabrechnung erstellen',exact:true}).click();await waitState(page,s=>s?.statements.length===4);
        await closeStatementInBrowser(page);await waitState(page,s=>s?.statements.find(s=>s.month==='2026-07')?.locked);
        assert.equal(await picker.inputValue(),'2026-07');await page.getByRole('button',{name:'Mit August 2026 beginnen',exact:true}).click();assert.equal(await picker.inputValue(),'2026-08');
        const before=await state(page);assert.deepEqual(before.statements[0],frozen);assert.deepEqual(before.trips,baseline.trips);assert.deepEqual(before.expenses,baseline.expenses);
        await page.evaluate(()=>navigator.serviceWorker.ready);await page.reload();await page.getByRole('heading',{name:'Monatsübersicht',exact:true}).waitFor();await context.setOffline(true);await page.reload();await page.getByRole('heading',{name:'Monatsübersicht',exact:true}).waitFor();
        assert.equal(await picker.inputValue(),'2026-11');assert.deepEqual(await state(page),before);await nav(page,'Monatsübersicht');assert.match(await monthButton('Juli').getAttribute('aria-label'),/Abgeschlossen/);await fits();assert.deepEqual(errors,[]);
      });
    } catch(e){await page.screenshot({path:path.join(output,`${engine}-${viewport.width}-failure.png`),fullPage:true});console.error('Browser failure artifacts:',output);throw e;}finally{await context.close();}
  }
  console.log(JSON.stringify({url,output,checks:results.length,results},null,2));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
