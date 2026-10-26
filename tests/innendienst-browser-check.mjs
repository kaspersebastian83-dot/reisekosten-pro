// Optional browser checks: existing Playwright installation, no project dependency.
// PLAYWRIGHT_MODULE=/absolute/path/to/playwright BROWSER_EXECUTABLE=/path/to/browser node tests/innendienst-browser-check.mjs
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
// SpesenKit 1.8.5: Rückmeldungen 1 und 2 – „Gehört zu keiner Reise und keinem Projekt“ und Tätigkeit Innendienst. Synthetische Daten.
const browser=await engines[engine].launch({headless:true,...(process.env.BROWSER_EXECUTABLE ? {executablePath:process.env.BROWSER_EXECUTABLE}: {})});
const nav=async(page,name)=>{if(await page.getByRole('button',{name:'Menü öffnen',exact:true}).isVisible())await page.getByRole('button',{name:'Menü öffnen',exact:true}).click();await page.locator('.sidebar nav').getByRole('button',{name:new RegExp('^'+name)}).click();await page.waitForTimeout(250);};
try {
  for (const viewport of [{width:1440,height:1000},{width:390,height:844}]) {
    const context=await browser.newContext({viewport});await context.route(/https?:\/\/(?!127\.0\.0\.1)/,r=>r.abort());
    const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(url);await page.getByRole('heading',{name:'Monatsübersicht',exact:true}).waitFor();
    await page.locator('input[type=month]').fill('2026-03');
    const workspace=page.locator('.month-entry-workspace'),editor=page.locator('.modal'),timeline=page.getByRole('region',{name:'Monat im Überblick',exact:true});
    const kosten=async(button,betrag,haken)=>{
      await workspace.getByRole('button',{name:button,exact:true}).click();await editor.waitFor();
      await editor.getByLabel('Datum',{exact:true}).fill('2026-03-09');await editor.getByLabel('Brutto (€)',{exact:true}).fill(betrag);
      if(haken){
        await editor.getByLabel('Gehört zu keiner Reise und keinem Projekt (z. B. Büromaterial)',{exact:true}).check();
        assert.equal(await editor.getByLabel('Reisezuordnung',{exact:true}).count(),0,'keine Reiseauswahl mehr');
        assert.equal(await editor.getByLabel('Projekt',{exact:true}).count(),0,'kein Projektfeld mehr');
        await editor.getByText('Ohne Reise und Projekt erfasst',{exact:false}).waitFor();
      }
      await editor.getByRole('button',{name:'Speichern & fertig',exact:true}).click();await editor.waitFor({state:'detached'});
    };
    // Außendienst: mit Haken kein Hinweis, ohne Haken wie bisher
    await kosten('Sonstige Kosten erfassen','12',true);
    let s=await waitState(page,s=>s.expenses.length===1);
    assert.equal(s.expenses[0].noTrip,true);assert.equal(s.expenses[0].tripId,undefined);
    await kosten('Sonstige Kosten erfassen','8',false);
    s=await waitState(page,s=>s.expenses.length===2);
    const zeilen=await timeline.innerText();
    assert.match(zeilen,/ohne Reise/);assert.equal((zeilen.match(/keiner Reise zugeordnet/g)||[]).length,1,'nur die Position ohne Haken');
    console.log(`PASS ${viewport.width}: Haken „keine Reise / kein Projekt“ – keine Zuordnungshinweise`);
    // Innendienst
    await nav(page,'Einstellungen');await page.getByLabel('Tätigkeit',{exact:true}).selectOption('innendienst');
    await page.getByRole('button',{name:'Einstellungen speichern',exact:true}).click();await waitState(page,s=>s.settings.staffRole==='innendienst');
    await nav(page,'Monatsübersicht');await workspace.waitFor();
    assert.equal(await workspace.getByRole('button',{name:'Dienstreise erfassen',exact:true}).count(),0);
    assert.equal(await workspace.getByRole('button',{name:/Fahrtenbuch importieren/}).count(),0);
    assert.equal(await page.getByText('Verpflegungspauschalen · Vorschau',{exact:true}).count(),0);
    await workspace.getByRole('button',{name:'Kosten erfassen',exact:true}).click();await editor.waitFor();
    assert.equal(await editor.getByLabel('Gehört zu keiner Reise und keinem Projekt (z. B. Büromaterial)',{exact:true}).count(),0,'im Innendienst kein Haken nötig');
    assert.equal(await editor.getByLabel('Reisezuordnung',{exact:true}).count(),0);
    await editor.getByText('Innendienst: Kosten ohne Reisezuordnung',{exact:false}).waitFor();
    await editor.getByLabel('Datum',{exact:true}).fill('2026-03-10');await editor.getByLabel('Brutto (€)',{exact:true}).fill('5');
    await editor.getByRole('button',{name:'Speichern & fertig',exact:true}).click();await editor.waitFor({state:'detached'});
    await waitState(page,s=>s.expenses.length===3);
    assert.equal(((await timeline.innerText()).match(/keiner Reise zugeordnet/g)||[]).length,0,'Innendienst: keine Zuordnungshinweise');
    assert.deepEqual(errors.filter(e=>!/importScripts|tesseract/i.test(e)),[]);
    console.log(`PASS ${viewport.width}: Innendienst – nur Kosten, keine Reise-/Fahrtenbuch-Knöpfe, keine Zuordnungshinweise`);
    await context.close();
  }
} finally { await browser.close(); server.close(); }
