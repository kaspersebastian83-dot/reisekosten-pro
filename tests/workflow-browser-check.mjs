// Optional browser checks: existing Playwright installation, no project dependency.
// PLAYWRIGHT_MODULE=/absolute/path/to/playwright BROWSER_EXECUTABLE=/path/to/browser node tests/workflow-browser-check.mjs
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
// Isolated contexts only; all trips, expenses and receipt pixels are synthetic.
try {
  for (const viewport of [{width:1440,height:1000},{width:820,height:1180},{width:390,height:844}].filter(v=>!process.env.VIEWPORT_WIDTH || v.width===Number(process.env.VIEWPORT_WIDTH))) {
    const {context,page}=await open({viewport});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const fits=async()=>{
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth ? [...document.querySelectorAll('main *')].filter(el=>el.getBoundingClientRect().right>innerWidth+1).map(el=>({tag:el.tagName,class:el.className,width:el.getBoundingClientRect().width})).slice(0,15) : null);
      assert.equal(overflow,null,'page overflow: '+JSON.stringify(overflow));
    };
    try {
      await page.goto(url);await page.getByRole('heading',{name:'Reisen',exact:true}).waitFor();
      assert.equal(await page.title(),'SpesenKit');
      assert.equal(await page.locator('.brand b').innerText(),'SpesenKit');
      assert.equal(await page.locator('.brand-mark').innerText(),'SK');
      assert.equal(await page.locator('.brand-mark').evaluate(el=>el.offsetWidth===el.offsetHeight),true,'brand symbol keeps its square proportions');
      assert.equal(await page.locator('.brand small').innerText(),'Dienstreisen · Spesen · Abrechnungen');
      await check(`${engine} ${viewport.width}: navigation, import access and empty dashboard actions`,async()=>{
        const names=['Reisen','Kosten & Belege','Monatsabrechnungen','Übersicht','Auswertungen','Einstellungen','Datensicherung'];
        assert.deepEqual(await page.locator('.sidebar nav button span').allTextContents(),names);
        const create=page.locator('.trip-actions .primary');
        assert.equal(await create.evaluate(button=>getComputedStyle(button).fontSize),'14px');
        assert.ok((await create.boundingBox()).height>=44);
        await create.click();await fits();await page.locator('.modal').getByRole('button',{name:'Abbrechen',exact:true}).click();
        assert.equal(await page.locator('.sidebar nav').getByRole('button',{name:'Fahrten importieren',exact:true}).count(),0);
        for(const name of names){await nav(page,name);await page.getByRole('heading',{name,exact:true}).waitFor();await fits();}
        await nav(page,'Fahrten importieren');await page.getByRole('heading',{name:'Fahrtenbuch auswählen'}).waitFor();
        assert.equal(await page.locator('.sidebar nav [aria-current=page]').innerText(),'Reisen');
        await fits();await page.getByRole('button',{name:'Zurück zu Reisen',exact:true}).click();
        await nav(page,'Übersicht');
        assert.doesNotMatch(await page.locator('.hero-panel').innerText(),/Datei importieren|Fahrtenbuch importieren/);
        await page.locator('.hero-actions').getByRole('button',{name:'Ausgabe erfassen',exact:true}).click();
        await page.locator('.quick-sheet').getByRole('button',{name:'Schließen'}).click();
        await page.locator('.hero-actions').getByRole('button',{name:'Beleg hinzufügen',exact:true}).click();
        await fits();await page.locator('.receipt-capture').getByRole('button',{name:'Schließen'}).click();
        assert.equal(await state(page),undefined);
      });
      await check(`${engine} ${viewport.width}: validation, midnight, multiday meals and project suggestions`,async()=>{
        await nav(page,'Reisen');await page.locator('.trip-actions .primary').click();
        const modal=page.locator('.modal');const save=modal.getByRole('button',{name:'Speichern',exact:true});
        assert.equal(await save.isDisabled(),true);
        await modal.getByLabel('Projekt *',{exact:true}).fill('26.0123 Musterstadt');
        assert.equal(await modal.getByLabel('Reiseziel *',{exact:true}).inputValue(),'Musterstadt');
        await modal.getByLabel('Reisegrund *',{exact:true}).fill('Synthetischer Termin');
        await modal.getByLabel('Abfahrt Datum *',{exact:true}).fill('2026-03-09');
        await modal.getByLabel('Abfahrt Uhrzeit *',{exact:true}).fill('08:00');
        await modal.getByLabel('Rückkehr Uhrzeit *',{exact:true}).fill('15:59');
        const preview=modal.getByRole('region',{name:'Verpflegungsvorschau'});
        assert.match(await preview.innerText(),/Verpflegung gesamt: 0,00/);
        await modal.getByLabel('Rückkehr Uhrzeit *',{exact:true}).fill('16:01');
        assert.match(await preview.innerText(),/Verpflegung gesamt: 14,00/);
        await modal.getByRole('checkbox',{name:'Frühstück',exact:true}).check();
        assert.match(await preview.innerText(),/Verpflegung gesamt: 8,40/);
        // Switching to a multi-day journey retains first-day meal deductions.
        await modal.getByLabel('Rückkehr Datum *',{exact:true}).fill('2026-03-11');
        await modal.getByRole('checkbox',{name:/Alle 2 auswärtigen/}).check();
        assert.equal(await preview.locator('article').count(),3);
        assert.match(await preview.innerText(),/Verpflegung gesamt: 50,40/);
        await fits();await page.screenshot({path:path.join(output,`${engine}-${viewport.width}-preview.png`),fullPage:true});
        await modal.getByLabel('Rückkehr Datum *',{exact:true}).fill('2026-03-09');
        assert.equal(await save.isDisabled(),true); // overnight contradicts same-day times
        await modal.getByRole('checkbox',{name:/Alle 0 auswärtigen/}).click();
        await modal.getByLabel('Rückkehr Uhrzeit *',{exact:true}).fill('07:00');
        assert.equal(await save.isDisabled(),true);
        await modal.getByLabel('Abfahrt Uhrzeit *',{exact:true}).fill('23:00');
        await modal.getByLabel('Rückkehr Datum *',{exact:true}).fill('2026-03-10');
        await modal.getByLabel('Rückkehr Uhrzeit *',{exact:true}).fill('02:00');
        assert.match(await modal.innerText(),/Abwesenheitsdauer: 3 Std. 0 Min./);
        assert.match(await preview.innerText(),/ohne bestätigte/);
        await modal.getByLabel('Reiseziel *',{exact:true}).fill('Eigenes Reiseziel');
        await modal.getByLabel('Projekt *',{exact:true}).fill('26.0456 Anderstadt');
        assert.equal(await modal.getByLabel('Reiseziel *',{exact:true}).inputValue(),'Eigenes Reiseziel');
        await modal.getByRole('button',{name:'Abbrechen',exact:true}).click();
        assert.equal(await state(page),undefined);
        await nav(page,'Übersicht');
      });
      await check(`${engine} ${viewport.width}: manual trip, allowance, linked expense and receipt without import`,async()=>{
        await page.locator('.hero-actions').getByRole('button',{name:'Reise erfassen',exact:true}).click();
        const modal=page.locator('.modal');await modal.getByRole('heading',{name:'Neue Dienstreise',exact:true}).waitFor();
        await modal.getByLabel('Projekt *',{exact:true}).fill('26.0123 Musterstadt');
        await modal.getByLabel('Abfahrt Datum *',{exact:true}).fill('2026-03-09');
        await modal.getByLabel('Abfahrt Uhrzeit *',{exact:true}).fill('08:00');
        await modal.getByLabel('Rückkehr Uhrzeit *',{exact:true}).fill('17:00');
        await modal.getByLabel('Reiseziel *',{exact:true}).fill('Synthetisches Testziel');
        await modal.getByLabel('Reisegrund *',{exact:true}).fill('Synthetischer Testtermin');
        await modal.getByRole('checkbox',{name:/Abwesenheitsdauer bestätigt/}).check();
        await fits();await page.locator('.modal-body').evaluate(node=>node.scrollTop=0);await page.screenshot({path:path.join(output,`${engine}-${viewport.width}-manual.png`),fullPage:true});
        await modal.getByRole('button',{name:'Speichern',exact:true}).click();
        const saved=await waitState(page,s=>s?.trips.length===1);assert.equal(saved.profiles.length,0);assert.equal(saved.trips[0].order,'26.0123 Musterstadt');assert.equal(saved.trips[0].status,'ungeprüft');
        await page.locator('.trip-actions .primary').click();
        assert.deepEqual(await page.locator('#trip-projects option').evaluateAll(nodes=>nodes.map(n=>n.value)),['26.0123 Musterstadt']);
        await page.locator('.modal').getByRole('button',{name:'Abbrechen',exact:true}).click();
        await page.locator('input[type=month]').fill('2026-03');
        assert.match(await page.locator('.day-list').innerText(),/14,00/);
        const id=saved.trips[0].id;
        await nav(page,'Übersicht');await page.locator('.hero-actions').getByRole('button',{name:'Ausgabe erfassen',exact:true}).click();
        const quick=page.locator('.quick-sheet');await quick.locator('.quick-amount input').fill('12.50');
        await quick.getByRole('button',{name:'Datum, Zahlungsart oder Reise ändern',exact:true}).click();
        await quick.getByLabel('Datum',{exact:true}).fill('2026-03-09');await quick.getByLabel(/^Reise/).selectOption(id);
        const png=Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=20;c.height=40;return c.toDataURL('image/png').split(',')[1];}),'base64');
        await quick.locator('input[type=file]').setInputFiles({name:'synthetic-receipt.png',mimeType:'image/png',buffer:png});
        await quick.getByText('synthetic-receipt.png',{exact:true}).waitFor();
        await quick.getByRole('button',{name:'Speichern',exact:true}).click();
        const withExpense=await waitState(page,s=>s?.expenses.length===1);
        assert.equal(withExpense.expenses[0].tripId,id);assert.equal(withExpense.expenses[0].receipt.type,'image/png');
        await nav(page,'Monatsabrechnungen');await page.getByRole('button',{name:'Abrechnung erstellen',exact:true}).click();
        await waitState(page,s=>s?.statements.length===1);
        assert.equal((await download(page,'PDF')).bytes.subarray(0,4).toString(),'%PDF');
        assert.equal((await download(page,'Excel')).bytes.subarray(0,2).toString(),'PK');
        await page.screenshot({path:path.join(output,`${engine}-${viewport.width}-statement.png`),fullPage:true});
      });
      await check(`${engine} ${viewport.width}: existing import preserves manual records; offline reload`,async()=>{
        const before=await state(page);
        // Existing Vimcar parser and review path with deterministic source columns.
        const vimcar='Abfahrt_datum;Abfahrt_uhrzeit;Ankunft_datum;Ankunft_uhrzeit;Betrieb_km;Arbeitsweg_km;Privat_km;Start Adresse;End Adresse;Anlass der Fahrt\n10.03.2026;08:00;10.03.2026;17:00;10;0;0;Teststart;Import-Testziel;Import-Testtermin';
        await nav(page,'Fahrten importieren');
        await page.locator('input[type=file]').setInputFiles({name:'synthetic-import.csv',mimeType:'text/csv',buffer:Buffer.from(vimcar)});
        await page.getByRole('button',{name:'Weiter',exact:true}).click();await page.getByRole('button',{name:'Weiter',exact:true}).click();
        await page.getByRole('button',{name:'1 Fahrten importieren',exact:true}).click();await page.getByRole('heading',{name:'Import abgeschlossen'}).waitFor();
        const after=await waitState(page,s=>s?.trips.length===2);
        assert.deepEqual(after.trips[0],before.trips[0]);assert.deepEqual(after.expenses,before.expenses);assert.deepEqual(after.statements,before.statements);
        await page.evaluate(()=>navigator.serviceWorker.ready);await page.reload();await page.getByRole('heading',{name:'Reisen',exact:true}).waitFor();
        await context.setOffline(true);await page.reload();await page.getByRole('heading',{name:'Reisen',exact:true}).waitFor();
        assert.deepEqual(await state(page),after);await nav(page,'Fahrten importieren');await page.getByRole('heading',{name:'Fahrtenbuch auswählen'}).waitFor();
        await context.setOffline(false);await nav(page,'Reisen');await fits();
        await page.screenshot({path:path.join(output,`${engine}-${viewport.width}-trips.png`),fullPage:true});
        assert.deepEqual(errors,[]);
      });
      await check(`${engine} ${viewport.width}: multiday and existing project survive reload without changing frozen reports`,async()=>{
        const before=await state(page);
        await page.locator('.trip-actions .primary').click();const modal=page.locator('.modal');
        await modal.getByLabel('Projekt *',{exact:true}).fill('26.0123 Musterstadt');
        await modal.getByLabel('Reisegrund *',{exact:true}).fill('Synthetische mehrtägige Reise');
        await modal.getByLabel('Abfahrt Datum *',{exact:true}).fill('2026-03-20');
        await modal.getByLabel('Rückkehr Datum *',{exact:true}).fill('2026-03-22');
        await modal.getByRole('checkbox',{name:/Alle 2 auswärtigen/}).check();
        await modal.locator('fieldset').nth(1).getByRole('checkbox',{name:'Frühstück',exact:true}).check();
        await modal.getByRole('button',{name:'Speichern',exact:true}).click();
        const saved=await waitState(page,s=>s?.trips.length===before.trips.length+1);
        assert.equal(saved.trips.at(-1).overnight,true);
        assert.equal(saved.trips.at(-1).dailyMeals['2026-03-21'].breakfast,true);
        assert.equal(saved.trips.at(-1).businessKm,0);
        assert.deepEqual(saved.statements,before.statements);assert.deepEqual(saved.expenses,before.expenses);
        await page.reload();await page.getByRole('heading',{name:'Reisen',exact:true}).waitFor();
        assert.deepEqual(await state(page),saved);
        await page.locator('input[type=month]').fill('2026-03');
        const row=page.locator('.trip-rows > div').filter({hasText:'Synthetische mehrtägige Reise'}).first();
        await row.getByRole('button',{name:'Bearbeiten',exact:true}).click();
        assert.equal(await modal.getByLabel('Projekt *',{exact:true}).inputValue(),'26.0123 Musterstadt');
        assert.equal(await modal.getByRole('checkbox',{name:/Alle 2 auswärtigen/}).isChecked(),true);
        assert.equal(await modal.locator('fieldset').nth(1).getByRole('checkbox',{name:'Frühstück',exact:true}).isChecked(),true);
        await modal.getByLabel('Projekt *',{exact:true}).fill('Ungültiges neues Projekt');
        assert.equal(await modal.getByRole('button',{name:'Speichern',exact:true}).isDisabled(),true);
        await modal.getByRole('button',{name:'Abbrechen',exact:true}).click();
        // Imported legacy rows need no forced project migration to remain editable.
        await page.locator('.trip-rows > div').filter({hasText:'Import-Testtermin'}).first().getByRole('button',{name:'Bearbeiten',exact:true}).click();
        assert.equal(await modal.getByRole('button',{name:'Speichern',exact:true}).isEnabled(),true);
        await modal.getByRole('button',{name:'Abbrechen',exact:true}).click();await fits();
        assert.deepEqual(errors,[]);
      });
    } catch(error) {await page.screenshot({path:path.join(output,`${engine}-${viewport.width}-failure.png`),fullPage:true});console.error('Browser failure artifacts:',output,await page.locator('h1').innerText());throw error;} finally { await context.close(); }
  }
  console.log(JSON.stringify({url,output,checks:results.length,results},null,2));
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
