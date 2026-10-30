// Optional browser checks: existing Playwright installation, no project dependency.
// PLAYWRIGHT_MODULE=/absolute/path/to/playwright BROWSER_EXECUTABLE=/path/to/browser node tests/workflow-browser-check.mjs
// Optional BROWSER_ENGINE=webkit for Safari-engine coverage.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import http from 'node:http';
import path from 'node:path';
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
    const {context,page}=await open({viewport,timezoneId:'Europe/Berlin'});await page.clock.setFixedTime(new Date('2026-12-05T10:00:00Z'));
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const workspace=page.getByRole('region',{name:'Monatsarbeitsbereich',exact:true});const picker=page.locator('input[type=month]');
    const fits=async()=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'horizontal overflow');
    const goJune=async()=>{await nav(page,'Monatsübersicht');await picker.fill('2026-06');await workspace.waitFor();};
    const rawNav=async(name)=>page.locator('.sidebar nav button').filter({hasText:name}).evaluate(button=>button.click());
    let seed;
    try {
      await page.goto(url+'?demo=1');await page.getByRole('heading',{name:'Monatsübersicht',exact:true}).waitFor();
      await check(`${engine} ${viewport.width}: one unified startup, twelve months, correct previous local month and read-only navigation`,async()=>{
        const labels=['Monatsübersicht','Auswertungen','Einstellungen','Datensicherung'];
        assert.deepEqual(await page.locator('.sidebar nav button span').allTextContents(),labels);assert.equal(await picker.inputValue(),'2026-11');assert.equal(await page.locator('.year-month').count(),12);
        assert.equal(await page.locator('.sidebar nav [aria-current=page]').innerText(),'Monatsübersicht');assert.equal(await page.locator('.workspace-return').count(),0);
        assert.equal(await workspace.count(),1);assert.equal(await workspace.locator('.workspace-figures').count(),1);assert.equal(await page.locator('.hero-actions,.month-command').count(),0);
        await picker.fill('2026-06');for(const name of labels){await nav(page,name);await page.getByRole('heading',{name,exact:true}).waitFor();assert.equal(await picker.inputValue(),'2026-06');await fits();}
        await nav(page,'Monatsübersicht');assert.equal(await state(page),undefined);assert.equal(await page.evaluate(()=>localStorage.length),0);
        assert.match(await page.locator('.month-checks summary').innerText(),/Keine bekannten Hinweise/);
        await page.locator('.month-checks summary').focus();await page.keyboard.press('Enter');assert.match(await page.getByRole('region',{name:'Prüfen',exact:true}).innerText(),/Keine bekannten Prüfhinweise/);
        assert.doesNotMatch(await page.locator('body').innerText(),/Bereit zum Abschluss|Alles plausibel|Alles geprüft/);
      });
      await nav(page,'Datensicherung');await page.getByRole('button',{name:'Demo-Daten laden',exact:true}).click();seed=await waitState(page,s=>s?.trips.length>0);
      const base={...seed.trips[0],date:'2026-06-10',endDate:'2026-06-10',startTime:'08:00',endTime:'17:00',businessKm:10,privateKm:0,tripType:'dienstlich',purpose:'Synthetischer Termin',destination:'Musterstadt',order:'26.0123 Musterstadt',dailyMeals:{},meals:{breakfast:false,lunch:false,dinner:false},manualAbsenceMinutes:undefined,overnight:false};
      seed.trips=[{...base,id:'confirmable',absenceConfirmed:false,status:'ungeprüft',warnings:['Abwesenheitsdauer muss bestätigt werden.']},{...base,id:'problem',date:'2026-06-11',endDate:'2026-06-11',destination:'',absenceConfirmed:true,status:'ungeprüft',warnings:['Reiseziel fehlt','Mögliches Duplikat']}];
      seed.expenses=[{...seed.expenses[0],id:'missing-receipt',date:'2026-06-10',category:'Parken',gross:25,net:25,vat:0,receipt:undefined,tripId:'confirmable',status:'ungeprüft',warnings:['Beleg fehlt'],paymentType:'privat vorgestreckt',reimbursementStatus:'offen'}];seed.statements=[];seed.receiptInbox=[];seed.changes=[];seed.merchantRules=[];
      await writeState(page,seed);await page.reload();await page.getByRole('heading',{name:'Monatsübersicht',exact:true}).waitFor();await goJune();
      await check(`${engine} ${viewport.width}: former checklist, missing receipts, duplicate hints and routes retain selected month`,async()=>{
        const before=await state(page);assert.match(await page.locator('.month-checks summary').innerText(),/Hinweise vorhanden/);await page.locator('.month-checks summary').click();const checks=page.getByRole('region',{name:'Prüfen',exact:true});assert.match(await checks.innerText(),/Reiseziel fehlt/);
        for(const label of ['Ungeprüfte Reisen / Reisehinweise','Ungeprüfte Kosten / Kostenhinweise','Fehlende Belege','Mögliche Duplikate'])assert.equal(await checks.getByRole('button',{name:new RegExp('^'+label)}).count(),1);
        // Prüfzeilen filtern die Zeitleiste in der Monatsübersicht, statt in die Listen zu wechseln.
        const timeline=page.getByRole('region',{name:'Monat im Überblick',exact:true});
        await checks.getByRole('button',{name:/^Ungeprüfte Reisen/}).click();await timeline.locator('.timeline-filter').waitFor();assert.match(await timeline.locator('.timeline-filter').innerText(),/Ungeprüfte Reisen/);
        assert.equal(await picker.inputValue(),'2026-06');assert.equal(await page.locator('.workspace-return').count(),0);assert.equal(await timeline.locator('.timeline-entry.expense').count(),0);assert.ok(await timeline.locator('.timeline-entry.trip').count()>=1);
        await checks.getByRole('button',{name:/^Fehlende Belege/}).click();assert.match(await timeline.locator('.timeline-filter').innerText(),/Fehlende Belege/);assert.equal(await timeline.locator('.timeline-entry').count(),1);assert.match(await timeline.locator('.timeline-entry').innerText(),/Beleg fehlt/);
        await timeline.getByRole('button',{name:'Alle anzeigen',exact:true}).click();assert.equal(await timeline.locator('.timeline-filter').count(),0);
        await nav(page,'Monatsübersicht');assert.equal(await picker.inputValue(),'2026-06');assert.equal(await page.locator('.workspace-return').count(),0);assert.deepEqual(await state(page),before);
      });
      await check(`${engine} ${viewport.width}: original batch confirmation changes only eligible trips and never creates a statement`,async()=>{
        const before=await state(page);await page.getByRole('button',{name:'Eindeutige Zeiten bestätigen',exact:true}).click();const saved=await waitState(page,s=>s?.trips[0].absenceConfirmed);
        assert.equal(saved.trips[0].status,'geprüft');assert.deepEqual(saved.trips[1],before.trips[1]);assert.deepEqual(saved.expenses,before.expenses);assert.deepEqual(saved.statements,before.statements);await fits();
      });
      await check(`${engine} ${viewport.width}: annual analysis has twelve months, independent year selection and stays read-only`,async()=>{
        const before=await state(page);await nav(page,'Auswertungen');
        assert.equal(await page.locator('.annual-month-row').count(),12);assert.equal(await page.locator('.annual-metric-grid .metric').count(),5);
        assert.equal(await page.locator('.quick-top,.receipt-top,.quick-fab,.camera-fab').count(),0);
        assert.equal(await page.locator('.year-picker strong').innerText(),'2026');assert.match(await page.locator('.analysis-card[aria-labelledby="projects-heading"]').innerText(),/Nicht eindeutig zugeordnet/);
        assert.match(await page.locator('.analysis-card[aria-labelledby="reimbursements-heading"]').innerText(),/Offene persönliche Erstattung/);
        await page.getByRole('button',{name:'Vorheriges Jahr',exact:true}).click();assert.equal(await page.locator('.year-picker strong').innerText(),'2025');
        assert.equal(await picker.inputValue(),'2026-06');assert.equal(await page.locator('.annual-month-row').count(),12);
        assert.match(await page.locator('.annual-month-bars').innerText(),/0,00/);await page.getByRole('button',{name:'Nächstes Jahr',exact:true}).click();
        assert.equal(await page.locator('.year-picker strong').innerText(),'2026');await fits();await page.screenshot({path:path.join(output,`${engine}-${viewport.width}-reports.png`),fullPage:true});assert.deepEqual(await state(page),before);
        await goJune();await page.getByRole('button',{name:'Tarife und Regeln ansehen',exact:true}).click();await page.getByRole('heading',{name:'Einstellungen',exact:true}).waitFor();assert.equal(await picker.inputValue(),'2026-06');await nav(page,'Monatsübersicht');
      });
      await check(`${engine} ${viewport.width}: unsaved cost draft survives sidebar, return and month-change requests until explicit cancel`,async()=>{
        const before=await state(page);await workspace.getByRole('button',{name:'Hotelrechnung erfassen',exact:true}).click();const modal=page.locator('.modal');await modal.getByLabel('Beschreibung',{exact:true}).fill('Ungespeicherter synthetischer Hotelentwurf');
        // Das Formular liegt jetzt über der Monatsübersicht; Wechsel in einen anderen Bereich oder Monat bleibt gesperrt.
        assert.equal(await page.locator('.topbar h1').innerText(),'Monatsübersicht');
        await rawNav('Einstellungen');assert.equal(await page.locator('.topbar h1').innerText(),'Monatsübersicht');assert.equal(await modal.getByLabel('Beschreibung',{exact:true}).inputValue(),'Ungespeicherter synthetischer Hotelentwurf');
        assert.equal(await modal.count(),1);await picker.fill('2026-07');assert.equal(await picker.inputValue(),'2026-06');
        assert.deepEqual(await state(page),before);await modal.getByRole('button',{name:'Abbrechen',exact:true}).click();await nav(page,'Monatsübersicht');assert.equal(await page.locator('.workspace-return').count(),0);assert.equal(await picker.inputValue(),'2026-06');assert.deepEqual(await state(page),before);
      });
      await check(`${engine} ${viewport.width}: existing pending settings protection also prevents silent internal navigation loss`,async()=>{
        const before=await state(page);await nav(page,'Einstellungen');const company=page.getByLabel('Firma',{exact:true});const original=await company.inputValue();await company.fill('Ungespeicherte synthetische Änderung');await nav(page,'Monatsübersicht');
        assert.equal(await page.locator('.topbar h1').innerText(),'Einstellungen');assert.equal(await company.inputValue(),'Ungespeicherte synthetische Änderung');assert.deepEqual(await state(page),before);
        await company.fill(original);await nav(page,'Monatsübersicht');await workspace.waitFor();assert.equal(await page.locator('.workspace-return').count(),0);await fits();
        await page.locator('.month-checks summary').click();await page.locator('.toast').waitFor({state:'hidden'});await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(output,`${engine}-${viewport.width}-overview.png`),fullPage:true});
      });
      await check(`${engine} ${viewport.width}: unified offline startup retains all existing records, snapshots and storage identity`,async()=>{
        const before=await state(page);await page.evaluate(()=>navigator.serviceWorker.ready);await page.reload();await page.getByRole('heading',{name:'Monatsübersicht',exact:true}).waitFor();await context.setOffline(true);await page.reload();await page.getByRole('heading',{name:'Monatsübersicht',exact:true}).waitFor();
        assert.equal(await picker.inputValue(),'2026-11');assert.deepEqual(await state(page),before);await picker.fill('2026-06');assert.deepEqual(await state(page),before);assert.equal(await page.evaluate(()=>localStorage.length),0);
        // Bestand unverändert in „reisekosten-pro“ v1; seit 1.9 höchstens zusätzlich die Bilddatenbank „spesenkit-belege“.
        assert.deepEqual((await databases(page)).filter(db=>db.name!=='spesenkit-belege'),[{name:'reisekosten-pro',version:1}]);assert.ok((await databases(page)).every(db=>db.name==='reisekosten-pro'||(db.name==='spesenkit-belege'&&db.version===1)));assert.deepEqual(errors,[]);await fits();await context.setOffline(false);
      });
    } catch(error){await page.screenshot({path:path.join(output,`${engine}-${viewport.width}-failure.png`),fullPage:true});throw error;}
    finally{await context.close();}
  }
  console.log(JSON.stringify({url,output,engine,checks:results.length,results},null,2));
} catch(error){console.error('Browser failure artifacts:',output);throw error;}
finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
