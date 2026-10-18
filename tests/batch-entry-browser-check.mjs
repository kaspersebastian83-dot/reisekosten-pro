// Optional browser checks: existing Playwright installation, no project dependency.
// PLAYWRIGHT_MODULE=/absolute/path/to/playwright BROWSER_EXECUTABLE=/path/to/browser node tests/batch-entry-browser-check.mjs
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
const nav=async(page,name)=>{if(name==='Fahrten importieren'){await nav(page,'Reisen');await page.getByRole('button',{name:'Fahrten importieren',exact:true}).click();return;}if(await page.getByRole('button',{name:'Menü öffnen',exact:true}).isVisible())await page.getByRole('button',{name:'Menü öffnen',exact:true}).click();await page.locator('.sidebar nav').getByRole('button',{name:new RegExp('^'+name)}).click();await page.waitForTimeout(250);};
const state=page=>page.evaluate(()=>new Promise((resolve,reject)=>{const request=indexedDB.open('reisekosten-pro',1);request.onsuccess=()=>{const db=request.result;const tx=db.transaction('state');const r=tx.objectStore('state').get('main');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);tx.oncomplete=()=>db.close();};request.onerror=()=>reject(request.error);}));
const waitState=async(page,fn)=>{for(let i=0;i<60;i++){const s=await state(page);if(fn(s))return s;await page.waitForTimeout(100);}throw Error('Saved state condition timed out');};
const download=async(page,name)=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name,exact:true}).click();const d=await pending;const target=path.join(output,d.suggestedFilename());await d.saveAs(target);return {file:target,bytes:await readFile(target)};};
// Purely synthetic dates, trips and reports; never uses a real browser profile.
const writeState=(page,value)=>page.evaluate(value=>new Promise((resolve,reject)=>{const r=indexedDB.open('reisekosten-pro',1);r.onsuccess=()=>{const tx=r.result.transaction('state','readwrite');tx.objectStore('state').put(value,'main');tx.oncomplete=()=>{r.result.close();resolve();};tx.onabort=()=>reject(tx.error);};}),value);
try {
  for(const viewport of [{width:390,height:844},{width:1440,height:1000}]) {
    const {context,page}=await open({viewport,timezoneId:'Europe/Berlin'});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.clock.setFixedTime(new Date('2026-10-18T10:00:00Z'));
    const workspace=page.getByRole('region',{name:'Monatsarbeitsbereich',exact:true});
    const timeline=page.getByRole('region',{name:'Monat im Überblick',exact:true});
    const editor=page.locator('.modal');
    const clickAction=async(name)=>workspace.getByRole('button',{name,exact:true}).click();
    const fits=async()=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'page overflow');
    try {
      await page.goto(url);await page.getByRole('heading',{name:'Monatsübersicht',exact:true}).waitFor();
      await nav(page,'Datensicherung');await page.getByRole('button',{name:'Demo-Daten laden',exact:true}).click();
      const seed=await waitState(page,s=>s?.trips.length>0);
      seed.trips=[];seed.expenses=[];seed.statements=[];seed.receiptInbox=[];seed.changes=[];seed.merchantRules=[];
      await writeState(page,seed);await page.reload();await page.getByRole('heading',{name:'Monatsübersicht',exact:true}).waitFor();
      await nav(page,'Monatsübersicht');await page.locator('.year-months').getByRole('button',{name:/^Juni 2026 ·/}).click();await workspace.waitFor();
      await check(`${engine} ${viewport.width}: trips in a batch – save & next keeps the window open, prefills the following day and counts`,async()=>{
        await clickAction('Dienstreise erfassen');await editor.waitFor();
        assert.equal(await editor.getByRole('button',{name:'Speichern & nächste',exact:true}).isDisabled(),true,'validation still applies');
        await editor.getByLabel('Projekt *',{exact:true}).fill('26.0123 Musterstadt');await editor.getByLabel('Reisegrund *',{exact:true}).fill('Synthetischer Termin A');
        await editor.getByLabel('Abfahrt Datum *',{exact:true}).fill('2026-06-10');await editor.getByLabel('Rückkehr Datum *',{exact:true}).fill('2026-06-10');
        await editor.getByRole('button',{name:'Speichern & nächste',exact:true}).click();
        const one=await waitState(page,s=>s?.trips.length===1);assert.equal(one.trips[0].date,'2026-06-10');
        assert.equal(await editor.count(),1,'window stays open');
        assert.equal(await editor.getByLabel('Abfahrt Datum *',{exact:true}).inputValue(),'2026-06-11');assert.equal(await editor.getByLabel('Rückkehr Datum *',{exact:true}).inputValue(),'2026-06-11');
        assert.equal(await editor.getByLabel('Projekt *',{exact:true}).inputValue(),'');assert.equal(await editor.getByLabel('Reisegrund *',{exact:true}).inputValue(),'');
        assert.match(await editor.getByRole('status').filter({hasText:'in dieser Runde'}).innerText(),/1 Reise in dieser Runde erfasst/);
        await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Projekt *');
        assert.equal(await editor.locator('.error-box,.field-error').count(),0,'fresh draft shows no red errors');
        assert.match(await timeline.innerText(),/Musterstadt/,'timeline updates behind the window');
        await editor.getByLabel('Projekt *',{exact:true}).fill('26.0456 Beispielhausen');await editor.getByLabel('Reisegrund *',{exact:true}).fill('Synthetischer Termin B');
        await page.keyboard.press('Control+Enter');
        const two=await waitState(page,s=>s?.trips.length===2);assert.equal(two.trips[1].date,'2026-06-11');assert.equal(two.trips[1].order,'26.0456 Beispielhausen');
        assert.match(await editor.getByRole('status').filter({hasText:'in dieser Runde'}).innerText(),/2 Reisen in dieser Runde erfasst/);
        assert.equal(await editor.getByLabel('Abfahrt Datum *',{exact:true}).inputValue(),'2026-06-12');
        await fits();
        await editor.getByRole('button',{name:'Abbrechen',exact:true}).click();await editor.waitFor({state:'detached'});
        assert.equal((await state(page)).trips.length,2,'cancelling the empty next draft keeps the saved batch');
        await clickAction('Dienstreise erfassen');await editor.waitFor();assert.equal(await editor.getByRole('status').filter({hasText:'in dieser Runde'}).count(),0,'counter starts fresh');
        await editor.getByRole('button',{name:'Abbrechen',exact:true}).click();await editor.waitFor({state:'detached'});
      });
      await check(`${engine} ${viewport.width}: expenses in a batch – date, payment type and link carry over, amount and description do not`,async()=>{
        await clickAction('Sonstige Kosten erfassen');await editor.waitFor();
        await editor.getByLabel('Datum',{exact:true}).fill('2026-06-10');await editor.getByLabel('Beschreibung',{exact:true}).fill('Synthetisches Parken');await editor.getByLabel('Brutto (€)',{exact:true}).fill('12');
        await editor.getByLabel('Zahlungsart',{exact:true}).selectOption('Unternehmen');
        await editor.getByRole('button',{name:'Speichern & nächste',exact:true}).click();
        await waitState(page,s=>s?.expenses.length===1);assert.equal(await editor.count(),1);
        assert.equal(await editor.getByLabel('Datum',{exact:true}).inputValue(),'2026-06-10');assert.equal(await editor.getByLabel('Zahlungsart',{exact:true}).inputValue(),'Unternehmen');
        assert.equal(await editor.getByLabel('Beschreibung',{exact:true}).inputValue(),'');assert.equal(Number(await editor.getByLabel('Brutto (€)',{exact:true}).inputValue()),0);
        assert.match(await editor.getByRole('status').filter({hasText:'in dieser Runde'}).innerText(),/1 Kostenposition in dieser Runde erfasst/);
        await editor.getByRole('button',{name:'Speichern & nächste',exact:true}).click();await page.waitForTimeout(300);
        assert.equal((await state(page)).expenses.length,1,'empty amount is still rejected');
        await editor.getByLabel('Beschreibung',{exact:true}).fill('Synthetisches Taxi');await editor.getByLabel('Brutto (€)',{exact:true}).fill('18');
        await editor.getByRole('button',{name:'Speichern & fertig',exact:true}).click();
        const saved=await waitState(page,s=>s?.expenses.length===2);await editor.waitFor({state:'detached'});
        assert.deepEqual(saved.expenses.map(e=>[e.date,e.paymentType,e.gross]),[['2026-06-10','Unternehmen',12],['2026-06-10','Unternehmen',18]]);
        assert.match(await timeline.innerText(),/Synthetisches Taxi/);await fits();assert.deepEqual(errors,[]);
      });
    } catch(error){await page.screenshot({path:path.join(output,`${engine}-${viewport.width}-batch-failure.png`),fullPage:true});throw error;}
    finally {await context.close();}
  }
  console.log(JSON.stringify({url,output,engine,checks:results.length,results},null,2));
} catch(error){console.error('Browser failure artifacts:',output);throw error;}
finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
