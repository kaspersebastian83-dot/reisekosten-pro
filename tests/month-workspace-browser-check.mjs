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
import { databases, storedState } from './helpers/browser-state.mjs';
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
const state=page=>storedState(page);   // Belegbilder aus der Bilddatenbank wieder eingesetzt (seit 1.9 getrennt gespeichert)
const waitState=async(page,fn)=>{for(let i=0;i<60;i++){const s=await state(page);if(fn(s))return s;await page.waitForTimeout(100);}throw Error('Saved state condition timed out');};
const download=async(page,name)=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name,exact:true}).click();const d=await pending;const target=path.join(output,d.suggestedFilename());await d.saveAs(target);return {file:target,bytes:await readFile(target)};};
// Purely synthetic dates, trips and reports; never uses a real browser profile.
const writeState=(page,value)=>page.evaluate(value=>new Promise((resolve,reject)=>{const r=indexedDB.open('reisekosten-pro',1);r.onsuccess=()=>{const tx=r.result.transaction('state','readwrite');tx.objectStore('state').put(value,'main');tx.oncomplete=()=>{r.result.close();resolve();};tx.onabort=()=>reject(tx.error);};}),value);
const names=['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
try {
  for(const viewport of [{width:390,height:844},{width:820,height:1180},{width:1440,height:1000}]) {
    const {context,page}=await open({viewport,timezoneId:'Europe/Berlin'});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.clock.setFixedTime(new Date('2026-10-18T10:00:00Z'));
    const workspace=page.getByRole('region',{name:'Monatsarbeitsbereich',exact:true});
    const editor=page.locator('.modal');
    const selectMonth=async(month)=>{await page.locator('input[type=month]').fill(month);};
    const assertJune=async()=>{assert.equal(await page.locator('input[type=month]').inputValue(),'2026-06');await workspace.waitFor();};
    const clickAction=async(name)=>workspace.getByRole('button',{name,exact:true}).click();
    const saveCost=async()=>editor.getByRole('button',{name:'Speichern & fertig',exact:true}).click();
    const fits=async()=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'page overflow');
    let frozen,tripId;
    try {
      await check(`${engine} ${viewport.width}: Demo-Daten nur mit ?demo in der Adresse`,async()=>{await page.goto(url);await page.getByRole('heading',{name:'Monatsübersicht',exact:true}).waitFor();await nav(page,'Datensicherung');await page.getByRole('heading',{name:'Sicherung wiederherstellen',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Demo-Daten laden',exact:true}).count(),0,'kein Demo-Knopf ohne Schalter');});
      await page.goto(url+'?demo=1');await page.getByRole('heading',{name:'Monatsübersicht',exact:true}).waitFor();
      await nav(page,'Datensicherung');await page.getByRole('button',{name:'Demo-Daten laden',exact:true}).click();
      const seed=await waitState(page,s=>s?.trips.length>0);
      seed.trips=[];seed.expenses=[];seed.statements=[];seed.receiptInbox=[];seed.changes=[];seed.merchantRules=[];
      await writeState(page,seed);await page.reload();await page.getByRole('heading',{name:'Monatsübersicht',exact:true}).waitFor();
      await nav(page,'Monatsübersicht');await page.locator('.year-months').getByRole('button',{name:/^Juni 2026 ·/}).click();
      await check(`${engine} ${viewport.width}: June workspace opens without snapshots and retains responsive year navigation`,async()=>{
        await assertJune();assert.equal((await state(page)).statements.length,0);assert.equal(await page.locator('.statement-head').count(),0);
        assert.deepEqual(await workspace.locator('section[aria-label]').evaluateAll(sections=>sections.map(section=>section.getAttribute('aria-label')).filter(name=>['Spesen erfassen','Monat im Überblick','Prüfen','Monatsabrechnung','Bisher erfasst'].includes(name))),['Spesen erfassen','Monat im Überblick','Prüfen','Bisher erfasst','Monatsabrechnung']);
        assert.equal(await workspace.getByRole('button',{name:'Spesenabrechnung erstellen',exact:true}).count(),1);
        const tripButton=workspace.getByRole('button',{name:'Dienstreise erfassen',exact:true});const hotelButton=workspace.getByRole('button',{name:'Hotelrechnung erfassen',exact:true});const otherButton=workspace.getByRole('button',{name:'Sonstige Kosten erfassen',exact:true});
        assert.ok(await tripButton.evaluate(button=>button.classList.contains('primary')));assert.equal(await workspace.locator('button.primary').filter({hasText:'erfassen'}).count(),1,'only one primary entry action');
        for(const button of [tripButton,hotelButton,otherButton])assert.ok((await button.boundingBox()).height>=44);
        const hotelBox=await hotelButton.boundingBox();const otherBox=await otherButton.boundingBox();
        if(viewport.width===390)assert.ok(Math.abs(otherBox.y-hotelBox.y)<2&&hotelBox.x<otherBox.x,'hotel and other side by side on phones');else {const tripBox=await tripButton.boundingBox();assert.ok(Math.abs(tripBox.y-hotelBox.y)<2&&tripBox.x<hotelBox.x,'toolbar keeps trip and hotel in one row');}
        if(viewport.width===1440){const side=await workspace.locator('.workspace-side').boundingBox();const main=await workspace.locator('.workspace-main').boundingBox();assert.ok(main.x+main.width<=side.x+1,'figures beside the timeline on desktop');}
        assert.deepEqual(await workspace.locator('.workspace-figures dt').allTextContents(),['Dienstreisen','Verpflegungspauschalen · Vorschau','Hotelkosten · erfasst','Weitere Kosten inkl. Tanken · erfasst']);
        assert.match(await workspace.innerText(),/Voraussichtliche persönliche Erstattung/);assert.match(await workspace.innerText(),/Vom Unternehmen bezahlt/);
        assert.equal(await page.locator('.quick-fab,.camera-fab').count(),0,'duplicate floating actions do not cover the month entry controls');
        await fits();
      });
      await check(`${engine} ${viewport.width}: existing manual trip form defaults to June and returns after saving`,async()=>{
        await clickAction('Dienstreise erfassen');await editor.waitFor();assert.equal(await editor.getByLabel('Abfahrt Datum *',{exact:true}).inputValue(),'2026-06-01');
        assert.equal(await editor.getByLabel('Rückkehr Datum *',{exact:true}).inputValue(),'2026-06-01');
        await editor.getByLabel('Projekt *',{exact:true}).fill('26.0123 Musterstadt');await editor.getByLabel('Reisegrund *',{exact:true}).fill('Synthetischer Termin');
        await editor.getByLabel('Abfahrt Datum *',{exact:true}).fill('2026-06-10');await editor.getByLabel('Rückkehr Datum *',{exact:true}).fill('2026-06-11');
        await editor.getByLabel(/Auswärtige Übernachtung zwischen Abfahrt und Rückkehr/).check();await editor.getByRole('checkbox',{name:/Abwesenheitsdauer bestätigt/}).check();await editor.getByRole('button',{name:'Speichern & fertig',exact:true}).click();
        const saved=await waitState(page,s=>s?.trips.length===1);tripId=saved.trips[0].id;await assertJune();
        assert.equal(saved.trips[0].date,'2026-06-10');assert.equal(saved.statements.length,0);assert.match(await workspace.innerText(),/Dienstreisen\s+1/);
        assert.match(await workspace.innerText(),/Verpflegungspauschalen · Vorschau\s+28,00/);
      });
      await check(`${engine} ${viewport.width}: hotel category, local attachment, project and explicit trip assignment preserve actual July invoice date`,async()=>{
        await clickAction('Hotelrechnung erfassen');assert.equal(await editor.getByLabel('Kategorie',{exact:true}).inputValue(),'Hotel');
        assert.equal(await editor.getByLabel('Datum',{exact:true}).inputValue(),'2026-06-01');
        await editor.getByLabel('Datum',{exact:true}).fill('2026-07-02');await editor.getByLabel('Brutto (€)',{exact:true}).fill('115');
        await editor.getByLabel('Beschreibung',{exact:true}).fill('Synthetisches Hotel');
        await editor.getByLabel('Projekt',{exact:true}).fill('26.0123');
        await editor.getByLabel('Übernachtungsbeginn',{exact:true}).fill('2026-06-10');await editor.getByLabel('Übernachtungsende',{exact:true}).fill('2026-06-11');
        await editor.getByRole('button',{name:'Zuordnung bestätigen',exact:true}).click();
        await editor.getByLabel('Zahlungsart',{exact:true}).selectOption('Unternehmen');
        await editor.locator('input[type=file]').setInputFiles({name:'synthetic-hotel.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 synthetic workspace receipt')});
        await editor.getByText('synthetic-hotel.pdf',{exact:true}).waitFor();assert.match(await editor.innerText(),/Diese Ausgabe erscheint wegen ihres Rechnungsdatums in Juli 2026/);
        await saveCost();const saved=await waitState(page,s=>s?.expenses.length===1);await assertJune();
        assert.equal(saved.expenses[0].date,'2026-07-02');assert.equal(saved.expenses[0].tripId,tripId);assert.equal(saved.expenses[0].stayStart,'2026-06-10');
        assert.equal(saved.expenses[0].paymentType,'Unternehmen');assert.ok(saved.expenses[0].receipt.dataUrl);assert.equal(saved.statements.length,0);
        assert.match(await workspace.innerText(),/Hotelkosten · erfasst\s+0,00/);
        await selectMonth('2026-07');assert.match(await workspace.innerText(),/Hotelkosten · erfasst\s+115,00/);assert.match(await workspace.innerText(),/Vom Unternehmen bezahlt:?\s+115,00/);assert.match(await workspace.innerText(),/Voraussichtliche persönliche Erstattung\s+0,00/);
        await selectMonth('2026-06');
      });
      await check(`${engine} ${viewport.width}: other expense defaults to June; figures update without snapshots and editing returns to June`,async()=>{
        await clickAction('Sonstige Kosten erfassen');assert.equal(await editor.getByLabel('Datum',{exact:true}).inputValue(),'2026-06-01');
        await editor.getByLabel('Beschreibung',{exact:true}).fill('Synthetisches Parken');await editor.getByLabel('Brutto (€)',{exact:true}).fill('25');await saveCost();
        const saved=await waitState(page,s=>s?.expenses.length===2);await assertJune();assert.equal(saved.statements.length,0);
        assert.match(await workspace.innerText(),/Weitere Kosten inkl. Tanken · erfasst\s+25,00/);assert.match(await workspace.innerText(),/Voraussichtliche persönliche Erstattung\s+53,00/);
        await page.getByRole('region',{name:'Monat im Überblick',exact:true}).locator('.timeline-entry.expense').filter({hasText:'Synthetisches Parken'}).click();
        await editor.getByLabel('Brutto (€)',{exact:true}).fill('30');await saveCost();await waitState(page,s=>s?.expenses.find(e=>e.category==='Parken')?.gross===30);await assertJune();
        assert.match(await workspace.innerText(),/Weitere Kosten inkl. Tanken · erfasst\s+30,00/);await fits();
        await page.screenshot({path:path.join(output,`${engine}-${viewport.width}-workspace.png`),fullPage:true});
      });
      await check(`${engine} ${viewport.width}: local OCR capture remains available without closing a month`,async()=>{
        await clickAction('Beleg fotografieren / OCR');const capture=page.locator('.receipt-capture');await capture.waitFor();
        assert.equal(await capture.locator('input[capture=environment]').count(),1);await capture.getByRole('button',{name:'Schließen',exact:true}).click();await assertJune();assert.equal((await state(page)).statements.length,0);
      });
      await check(`${engine} ${viewport.width}: saved entries resume after reload without any draft; cancelling new input preserves June`,async()=>{
        const before=await state(page);assert.equal(before.statements.length,0);
        await page.reload();await page.getByRole('heading',{name:'Monatsübersicht',exact:true}).waitFor();assert.deepEqual(await state(page),before);
        await nav(page,'Monatsübersicht');await selectMonth('2026-06');await assertJune();
        await clickAction('Dienstreise erfassen');await editor.getByRole('button',{name:'Abbrechen',exact:true}).click();
        // Abbrechen bleibt in der Monatsübersicht: kein Tab-Wechsel, kein „Zurück“ nötig.
        assert.equal(await page.locator('.topbar h1').innerText(),'Monatsübersicht');assert.equal(await page.getByRole('button',{name:'Zurück zum Monatsarbeitsbereich',exact:true}).count(),0);
        await assertJune();assert.deepEqual(await state(page),before);
      });
      await check(`${engine} ${viewport.width}: explicit June draft creation, continuation and PDF/Excel export never auto-close or duplicate drafts`,async()=>{
        // Dispatch both activations to the same control; opening the report scrolls the page.
        await workspace.getByRole('button',{name:'Spesenabrechnung erstellen',exact:true}).evaluate(button=>{button.click();button.click();});const saved=await waitState(page,s=>s?.statements.length===1);
        assert.equal(saved.statements[0].month,'2026-06');assert.equal(saved.statements[0].locked,false);assert.equal(saved.statements[0].status,'vollständig');assert.equal(saved.changes.length,1);
        await page.locator('.statement-head').waitFor();assert.match(await page.locator('.statement-head').innerText(),/Juni 2026/);
        await page.getByRole('button',{name:'Zurück zur Erfassung',exact:true}).click();await clickAction('Abrechnung fortsetzen');assert.equal((await state(page)).statements.length,1);
        assert.equal((await download(page,'PDF')).bytes.subarray(0,4).toString(),'%PDF');assert.equal((await download(page,'Excel')).bytes.subarray(0,2).toString(),'PK');assert.deepEqual((await state(page)).statements,saved.statements);
        await closeStatementInBrowser(page);frozen=(await waitState(page,s=>s?.statements[0].locked)).statements[0];
        await fits();
      });
      await check(`${engine} ${viewport.width}: closed report survives later entry, workspace uses live figures and viewing preserves snapshot`,async()=>{
        await clickAction('Sonstige Kosten erfassen');await editor.getByLabel('Beschreibung',{exact:true}).fill('Synthetisches Taxi');await editor.getByLabel('Brutto (€)',{exact:true}).fill('10');await saveCost();
        await waitState(page,s=>s?.expenses.length===3);await assertJune();assert.deepEqual((await state(page)).statements[0],frozen);
        assert.match(await workspace.innerText(),/Weitere Kosten inkl. Tanken · erfasst\s+40,00/);await clickAction('Abrechnung ansehen');assert.match(await page.locator('.statement-head').innerText(),/Juni 2026/);
        assert.equal((await download(page,'Excel')).bytes.subarray(0,2).toString(),'PK');assert.deepEqual((await state(page)).statements[0],frozen);
      });
      await check(`${engine} ${viewport.width}: offline reload preserves entries, receipt, links, frozen data and explicit June selection remains read-only`,async()=>{
        const before=await state(page);await page.evaluate(()=>navigator.serviceWorker.ready);await page.reload();await page.getByRole('heading',{name:'Monatsübersicht',exact:true}).waitFor();
        await context.setOffline(true);await page.reload();await page.getByRole('heading',{name:'Monatsübersicht',exact:true}).waitFor();
        assert.deepEqual(await state(page),before);await nav(page,'Monatsübersicht');await selectMonth('2026-06');await assertJune();assert.deepEqual(await state(page),before);assert.equal(await page.evaluate(()=>localStorage.length),0);
        await fits();assert.deepEqual(errors,[]);await context.setOffline(false);
      });
    } catch(error){await page.screenshot({path:path.join(output,`${engine}-${viewport.width}-failure.png`),fullPage:true});throw error;}
    finally {await context.close();}
  }
  console.log(JSON.stringify({url,output,engine,checks:results.length,results},null,2));
} catch(error){console.error('Browser failure artifacts:',output);throw error;}
finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
