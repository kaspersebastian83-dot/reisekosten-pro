// Synthetic correction checks against the local production build, using existing Playwright.
// PLAYWRIGHT_MODULE=/absolute/path/to/playwright BROWSER_EXECUTABLE=/path/to/browser node tests/correction-browser-check.mjs
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
// Pace explicit test downloads to stay below Chromium's burst download limit.
const download=async(page,name)=>{await page.waitForTimeout(200);const pending=page.waitForEvent('download');await page.getByRole('button',{name,exact:true}).click();const d=await pending;const target=path.join(output,d.suggestedFilename());await d.saveAs(target);return {file:target,bytes:await readFile(target)};};
// Purely synthetic dates, trips and reports; never uses a real browser profile.
const writeState=(page,value)=>page.evaluate(value=>new Promise((resolve,reject)=>{const r=indexedDB.open('reisekosten-pro',1);r.onsuccess=()=>{const tx=r.result.transaction('state','readwrite');tx.objectStore('state').put(value,'main');tx.oncomplete=()=>{r.result.close();resolve();};tx.onabort=()=>reject(tx.error);};}),value);
const {closeStatementInBrowser}=await import('./close-statement-browser.mjs');
const ExcelJS=require('exceljs');
const JSZip=require('jszip');
try {
  for(const viewport of [{width:390,height:844},{width:820,height:1180},{width:1440,height:1000}]) {
    const {context,page}=await open({viewport,timezoneId:'Europe/Berlin'});
    await page.clock.setFixedTime(new Date('2026-10-18T10:00:00Z'));
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    const workspace=page.getByRole('region',{name:'Monatsarbeitsbereich',exact:true});
    const changes=page.getByRole('region',{name:'Änderungen nach Abschluss',exact:true});
    const review=page.getByRole('region',{name:'Abschlussprüfung',exact:true});
    const fits=async()=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'horizontal overflow');
    const reload=async()=>{await page.reload();await page.getByRole('heading',{name:'Monatsübersicht',exact:true}).waitFor();await page.locator('input[type=month]').fill('2026-06');};
    const report=async()=>{await workspace.getByRole('button',{name:/^Abrechnung (fortsetzen|ansehen)$/}).click();await page.locator('.statement-head').waitFor();};
    const mutate=async(fn)=>{const saved=await state(page);fn(saved);await writeState(page,saved);await reload();return saved;};
    let frozen,second;
    try {
      await page.goto(url);await page.getByRole('heading',{name:'Monatsübersicht',exact:true}).waitFor();
      await nav(page,'Datensicherung');await page.getByRole('button',{name:'Demo-Daten laden',exact:true}).click();
      const seed=await waitState(page,s=>s?.trips.length>0);
      seed.settings.profileName='Synthetisches Altprofil';seed.settings.company='Synthetische Altfirma';
      seed.trips=[{...seed.trips[0],id:'correction-trip',date:'2026-06-10',endDate:'2026-06-10',startTime:'08:00',endTime:'17:00',destination:'Musterstadt',purpose:'Synthetischer Termin',order:'26.0123 Musterstadt',businessKm:0,privateKm:0,tripType:'dienstlich',absenceConfirmed:true,manualAbsenceMinutes:undefined,overnight:false,status:'geprüft',warnings:[],meals:{breakfast:false,lunch:false,dinner:false},dailyMeals:{}}];
      const receipt={id:'synthetic-receipt',name:'synthetic-old.pdf',type:'application/pdf',size:25,hash:'synthetic-old',dataUrl:'data:application/pdf;base64,'+Buffer.from('%PDF synthetic old receipt').toString('base64')};
      seed.expenses=[{...seed.expenses[0],id:'old-hotel',date:'2026-06-10',category:'Hotel',description:'Synthetisches Alt-Hotel',merchant:'Synthetisches Alt-Hotel',gross:100,net:100,vat:0,vatRate:0,exchangeRate:1,businessShare:100,currency:'EUR',paymentType:'privat vorgestreckt',reimbursementStatus:'offen',status:'geprüft',warnings:[],receipt,tripId:'correction-trip',projectNumber:'26.0123',stayStart:'2026-06-10',stayEnd:'2026-06-11',breakfastIncluded:'no'}];
      seed.statements=[];seed.changes=[];seed.receiptInbox=[];seed.merchantRules=[];
      await writeState(page,seed);await reload();
      await workspace.getByRole('button',{name:'Spesenabrechnung erstellen',exact:true}).click();await waitState(page,s=>s?.statements.length===1);await closeStatementInBrowser(page);
      await waitState(page,s=>s?.statements[0].locked);await page.getByLabel('Abrechnungsstatus',{exact:true}).selectOption('ausgezahlt');
      frozen=structuredClone((await waitState(page,s=>s?.statements[0].status==='ausgezahlt')).statements[0]);
      await check(`${engine} ${viewport.width}: unchanged paid close stays green; unrelated month and future tariffs do not trigger correction`,async()=>{
        await mutate(saved=>{saved.expenses.push({...saved.expenses[0],id:'october-only',date:'2026-10-10',gross:999});saved.settings.tariffs[0].validTo='2026-12-31';saved.settings.tariffs.push({...saved.settings.tariffs[0],id:'future-only',validFrom:'2027-01-01',validTo:undefined,amount:999});});
        assert.equal(await changes.count(),0);assert.match(await page.locator('.year-month.selected').getAttribute('class'),/month-closed\b/);assert.deepEqual((await state(page)).statements,[frozen]);
      });
      await check(`${engine} ${viewport.width}: late hotel entered through existing form immediately shows +120 without opening report`,async()=>{
        await workspace.getByRole('button',{name:'Hotelrechnung erfassen',exact:true}).click();const editor=page.locator('.modal');
        await editor.getByLabel('Datum',{exact:true}).fill('2026-06-15');await editor.getByLabel('Beschreibung',{exact:true}).fill('Synthetisches Nachtragshotel');await editor.getByLabel('Brutto (€)',{exact:true}).fill('120');await editor.getByLabel('Zahlungsart',{exact:true}).selectOption('privat vorgestreckt');
        await editor.getByRole('button',{name:'Speichern',exact:true}).click();await waitState(page,s=>s?.expenses.length===3);
        await changes.waitFor();assert.equal(await page.locator('.statement-head').count(),0);assert.match(await changes.innerText(),/Abgeschlossen – Änderungen erkannt/);assert.match(await changes.innerText(),/\+120,00/);assert.match(await changes.innerText(),/keine Zahlungsforderung/);assert.doesNotMatch(await changes.innerText(),/Noch auszuzahlen|Restzahlung:/);
        await changes.getByText('Änderungen ansehen',{exact:true}).click();assert.match(await changes.innerText(),/Neu hinzugefügt/i);assert.match(await changes.innerText(),/Synthetisches Nachtragshotel/);assert.match(await page.locator('.year-month.selected').getAttribute('class'),/month-closed-changed/);assert.deepEqual((await state(page)).statements,[frozen]);await fits();
      });
      await check(`${engine} ${viewport.width}: failed correction save leaves historical snapshots and screen unconfirmed`,async()=>{
        await page.evaluate(()=>{window.originalPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,...rest){if(value?.statements?.length>1)throw new DOMException('Synthetischer Korrektur-Speicherfehler','QuotaExceededError');return window.originalPut.call(this,value,...rest);};});
        await changes.getByRole('button',{name:'Korrekturentwurf erstellen',exact:true}).click();await changes.getByRole('alert').waitFor();assert.match(await changes.getByRole('alert').innerText(),/Speicherfehler/);assert.deepEqual((await state(page)).statements,[frozen]);assert.equal(await page.getByText('Korrekturentwurf lokal gespeichert. Noch nicht freigegeben oder ausgezahlt.',{exact:true}).count(),0);
        await page.evaluate(()=>IDBObjectStore.prototype.put=window.originalPut);
      });
      await check(`${engine} ${viewport.width}: double activation creates one unpaid unlocked correction; resume does not duplicate it`,async()=>{
        await changes.getByRole('button',{name:'Korrekturentwurf erstellen',exact:true}).evaluate(button=>{button.click();button.click();});
        const saved=await waitState(page,s=>s?.statements.length===2);assert.deepEqual(saved.statements[0],frozen);assert.equal(saved.statements[1].locked,false);assert.equal(saved.statements[1].status,'vollständig');assert.equal(saved.statements[1].version,2);assert.equal(saved.statements[1].data.totals.openAmount,234);
        assert.match(await page.locator('.year-month.selected').getAttribute('class'),/month-correction/);assert.match(await review.innerText(),/Beleg fehlt/);
        await changes.getByRole('button',{name:'Korrekturentwurf fortsetzen',exact:true}).click();assert.equal((await state(page)).statements.length,2);
        await review.getByRole('button',{name:'Monatsabrechnung abschließen',exact:true}).click();const dialog=page.getByRole('dialog');assert.equal(await dialog.getByRole('button',{name:'Verbindlich abschließen',exact:true}).isEnabled(),false);assert.match(await dialog.innerText(),/keine tatsächliche Restzahlung oder Rückforderung/);
        await dialog.getByRole('button',{name:'Abbrechen',exact:true}).click();
        await closeStatementInBrowser(page);const closed=await waitState(page,s=>s?.statements[1].locked);second=structuredClone(closed.statements[1]);assert.equal(second.status,'freigegeben');assert.deepEqual(closed.statements[0],frozen);assert.match(await page.locator('.year-month.selected').getAttribute('class'),/month-closed\b/);
      });
      await check(`${engine} ${viewport.width}: selected older version is read-only; PDF Excel and ZIP use frozen amounts profile and receipt bytes`,async()=>{
        await mutate(saved=>{saved.expenses[0].gross=250;saved.expenses[0].net=250;saved.expenses[0].receipt.name='synthetic-new.pdf';saved.expenses[0].receipt.dataUrl='data:application/pdf;base64,'+Buffer.from('%PDF synthetic NEW receipt').toString('base64');saved.settings.profileName='Synthetisches Neuprofil';});await report();
        await page.getByLabel('Abrechnungsversion',{exact:true}).selectOption(frozen.id);assert.equal(await page.getByLabel('Abrechnungsstatus',{exact:true}).count(),0);assert.equal(await review.count(),0);assert.match(await page.locator('.statement-profile').innerText(),/Synthetisches Altprofil/);
        const pdf=await download(page,'PDF');assert.equal(pdf.file.endsWith('Reisekosten_2026-06_V01.pdf'),true);assert.match(pdf.bytes.toString('latin1'),/Abrechnungsversion: Version 1/);assert.match(pdf.bytes.toString('latin1'),/Persönlicher Erstattungsbetrag laut Abrechnungsstand/);assert.doesNotMatch(pdf.bytes.toString('latin1'),/Offener Auszahlungsbetrag/);assert.equal(pdf.bytes.subarray(0,4).toString(),'%PDF');assert.match(pdf.bytes.toString('latin1'),/synthetic-old\.pdf/);assert.doesNotMatch(pdf.bytes.toString('latin1'),/synthetic-new\.pdf/);assert.match(pdf.bytes.toString('latin1'),/100,00/);assert.doesNotMatch(pdf.bytes.toString('latin1'),/250,00/);
        const excel=await download(page,'Excel');const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(excel.bytes);assert.equal(workbook.getWorksheet('Übersicht').getCell('B2').value,'Synthetisches Altprofil');const sheet=workbook.getWorksheet('Reisekosten');const headers=sheet.getRow(1).values;assert.equal(sheet.getRow(2).getCell(headers.indexOf('Übernachtung')).value,100);assert.equal(sheet.getRow(2).getCell(headers.indexOf('OffenerBetrag')).value,114);
        const zip=await JSZip.loadAsync((await download(page,'ZIP + Belege')).bytes);const reportData=JSON.parse(await zip.file('Abrechnung_2026-06_V01.json').async('string'));assert.deepEqual(reportData.data,JSON.parse(JSON.stringify(frozen.data)));assert.equal(await zip.file('Belege/old-hotel_synthetic-old.pdf').async('string'),'%PDF synthetic old receipt');assert.ok(!zip.file('Belege/old-hotel_synthetic-new.pdf'));
        await page.getByLabel('Abrechnungsversion',{exact:true}).selectOption(second.id);const correctionPdf=await download(page,'PDF');assert.ok(correctionPdf.file.endsWith('_V02.pdf'));assert.match(correctionPdf.bytes.toString('latin1'),/Abrechnungsversion: Version 2/);assert.match(correctionPdf.bytes.toString('latin1'),/keine automatisch offenen Restzahlungen/);assert.match(correctionPdf.bytes.toString('latin1').replace(/\) Tj\s*T\* \(/g,' '),/gesondert abgestimmt werden/);const newerWorkbook=new ExcelJS.Workbook();await newerWorkbook.xlsx.load((await download(page,'Excel')).bytes);const newerSheet=newerWorkbook.getWorksheet('Reisekosten');const column=newerSheet.getRow(1).values.indexOf('Übernachtung');let total=0;newerSheet.eachRow((row,index)=>{if(index>1)total+=Number(row.getCell(column).value)||0;});assert.equal(total,220);assert.deepEqual((await state(page)).statements,[frozen,second]);
      });
      await check(`${engine} ${viewport.width}: all exports distinguish V01/V02; DATEV correction requires explicit acknowledgement and keeps its schema`,async()=>{
        const names=[];
        for(const snapshot of [frozen,second]) {
          await page.getByLabel('Abrechnungsversion',{exact:true}).selectOption(snapshot.id);
          const suffix=`V0${snapshot.version}`;
          for(const [button,ext] of [['PDF','pdf'],['Excel','xlsx'],['CSV','csv'],['ZIP + Belege','zip']]) {
            const file=await download(page,button);assert.ok(file.file.endsWith(`Reisekosten_2026-06_${suffix}.${ext}`));names.push(file.file);
            if(button==='CSV')assert.equal(file.bytes.toString('utf8').replace(/^\uFEFF/,'').split(/\r?\n/)[0],'Name;Abrechnungsmonat;Fahrzeug;Fahrzeugart;Kennzeichen;Datum;Beginn;Ende;Abwesenheitsminuten;Reiseziel;Reisezweck;Kunde;Kilometer;SpesenVorKürzung;Frühstückskürzung;Mittagessenkürzung;Abendessenkürzung;SpesenNachKürzung;Kilometererstattung;Tankkosten;Übernachtung;SonstigeKosten;OffenerBetrag;Berechnung');
          }
          if(snapshot.version===2) {
            let downloads=0;const record=()=>downloads++;page.on('download',record);
            page.once('dialog',async dialog=>{assert.match(dialog.message(),/keine zusätzliche Differenzbuchung/);assert.match(dialog.message(),/frühere Buchungen und Zahlungen gesondert abstimmen/);await dialog.dismiss();});
            await page.getByRole('button',{name:'DATEV-CSV',exact:true}).click();await page.waitForTimeout(150);assert.equal(downloads,0);page.off('download',record);
            page.once('dialog',dialog=>dialog.accept());
          }
          const datev=await download(page,'DATEV-CSV');assert.ok(datev.file.endsWith(`DATEV_Reisekosten_2026-06_${suffix}.csv`));assert.equal(datev.bytes.toString('utf8').replace(/^\uFEFF/,'').split(/\r?\n/)[0],'Belegdatum;Buchungstext;Betrag;Währung;Kostenstelle');
        }
        assert.equal(new Set(names).size,8);assert.deepEqual((await state(page)).statements,[frozen,second]);
      });
      await check(`${engine} ${viewport.width}: cancelling latest does not reactivate paid older close; comparison remains explicit`,async()=>{
        await page.getByLabel('Abrechnungsstatus',{exact:true}).selectOption('storniert');await waitState(page,s=>s?.statements[1].status==='storniert');assert.match(await changes.innerText(),/Neueste Version storniert/);assert.match(await page.locator('.year-month.selected').getAttribute('class'),/month-history-review/);assert.deepEqual((await state(page)).statements[0],frozen);
      });
      await check(`${engine} ${viewport.width}: cross-tab conflict refuses correction without overwriting external saved data`,async()=>{
        const external=await state(page);external.expenses[0].description='Synthetischer anderer Tab';await writeState(page,external);
        await changes.getByRole('button',{name:'Korrekturentwurf erstellen',exact:true}).click();await changes.getByRole('alert').waitFor();assert.match(await changes.getByRole('alert').innerText(),/anderen Tab/);assert.deepEqual(await state(page),external);await reload();
      });
      await check(`${engine} ${viewport.width}: stale correction cannot close; new version preserves every prior snapshot`,async()=>{
        await changes.getByRole('button',{name:'Korrekturentwurf erstellen',exact:true}).click();const saved=await waitState(page,s=>s?.statements.length===3);const preserved=structuredClone(saved.statements);
        await mutate(value=>{value.expenses[0].gross+=1;value.expenses[0].net+=1;});await changes.getByRole('button',{name:'Korrekturentwurf fortsetzen',exact:true}).click();assert.match(await review.innerText(),/Seit Erstellung des Entwurfs/);assert.equal(await review.getByRole('button',{name:'Monatsabrechnung abschließen',exact:true}).isEnabled(),false);
        await changes.getByRole('button',{name:'Neue Korrekturversion erstellen',exact:true}).click();const next=await waitState(page,s=>s?.statements.length===4);assert.deepEqual(next.statements.slice(0,3),preserved);assert.equal(next.statements[3].status,'vollständig');await fits();await page.screenshot({path:path.join(output,`${engine}-${viewport.width}-correction.png`),fullPage:true});
      });
      await check(`${engine} ${viewport.width}: zero and negative differences still disclose changed entries without invented payments`,async()=>{
        await mutate(saved=>{saved.expenses[0].gross=120;saved.expenses[0].net=120;saved.expenses.find(item=>item.description==='Synthetisches Nachtragshotel').gross=100;saved.settings.profileName='Synthetisches Altprofil';});
        // Baseline remains the paid V1 because V2 was explicitly cancelled: 220 versus 100.
        assert.match(await changes.innerText(),/\+120,00/);
        await mutate(saved=>{saved.expenses[0].gross=65;saved.expenses[0].net=65;saved.expenses.find(item=>item.description==='Synthetisches Nachtragshotel').status='storniert';});assert.match(await changes.innerText(),/-35,00/);assert.match(await changes.innerText(),/weder eine automatisch offene Auszahlung noch eine Rückforderung/);
        await mutate(saved=>{saved.expenses[0].gross=100;saved.expenses[0].net=100;});assert.match(await changes.locator('.correction-summary').first().innerText(),/Rechnerische Differenz\s+0,00/);await changes.getByText('Änderungen ansehen',{exact:true}).click();assert.match(await changes.innerText(),/Belegdatei \/ Dateiinhalt/);
      });
      await check(`${engine} ${viewport.width}: legacy historical gaps remain explicit and never export current files or profile`,async()=>{
        await mutate(saved=>{delete saved.statements[0].settingsSnapshot;delete saved.statements[0].expensesSnapshot;});assert.match(await changes.innerText(),/Historischer Vergleich eingeschränkt/);await report();await page.getByLabel('Abrechnungsversion',{exact:true}).selectOption(frozen.id);
        assert.match(await page.getByRole('status').filter({hasText:'Historischer Vergleich eingeschränkt'}).innerText(),/nicht aus aktuellen Daten ergänzt/);assert.match(await page.locator('.statement-profile').innerText(),/Nicht hinterlegt/);
        const legacyZip=await JSZip.loadAsync((await download(page,'ZIP + Belege')).bytes);assert.deepEqual(Object.keys(legacyZip.files).filter(name=>name.startsWith('Belege/')),[]);assert.deepEqual(JSON.parse(await legacyZip.file('Abrechnung_2026-06_V01.json').async('string')).data,JSON.parse(JSON.stringify(frozen.data)));
      });
      await check(`${engine} ${viewport.width}: offline reload retains history receipts and correction states at all viewport widths`,async()=>{
        const before=await state(page);await page.evaluate(()=>navigator.serviceWorker.ready);await reload();await context.setOffline(true);await reload();assert.deepEqual(await state(page),before);await changes.waitFor();assert.match(await changes.innerText(),/Historischer Vergleich eingeschränkt/);await fits();assert.deepEqual(errors,[]);await context.setOffline(false);
      });
    } catch(error){await page.screenshot({path:path.join(output,`${engine}-${viewport.width}-failure.png`),fullPage:true});throw error;}
    finally{await context.close();}
  }
  console.log(JSON.stringify({url,output,engine,checks:results.length,results},null,2));
} catch(error){console.error('Browser failure artifacts:',output);throw error;}
finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
