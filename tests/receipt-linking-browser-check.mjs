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
// Synthetic fixtures only, in isolated contexts. No user files or browser profile.
const writeState=(page,value)=>page.evaluate(value=>new Promise((resolve,reject)=>{const r=indexedDB.open('reisekosten-pro',1);r.onsuccess=()=>{const tx=r.result.transaction('state','readwrite');tx.objectStore('state').put(value,'main');tx.oncomplete=()=>{r.result.close();resolve();};tx.onabort=()=>reject(tx.error);};}),value);
const fakePdf=n=>({name:`synthetic-hotel-${n}.pdf`,mimeType:'application/pdf',buffer:Buffer.from(`%PDF-1.4\nSynthetic receipt ${n} only`)});
try {
  for(const viewport of [{width:1440,height:1000},{width:820,height:1180},{width:390,height:844}].filter(v=>!process.env.VIEWPORT_WIDTH || v.width===Number(process.env.VIEWPORT_WIDTH))) {
    const {context,page}=await open({viewport});const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await context.route(/https?:\/\/(?!127\.0\.0\.1)/,r=>r.abort());
    const modal=page.locator('.receipt-capture');
    const begin=async n=>{await page.locator(await page.locator('.camera-fab').isVisible()?'.camera-fab':'.receipt-top').click();await modal.locator('input[type=file]').first().setInputFiles(fakePdf(n));await modal.getByLabel('Betrag (€)',{exact:true}).waitFor();};
    const fields=async({amount=115,project='26.0123',start='2026-10-20',end='2026-10-21',payment='Unternehmen',invoice='INV-001'}={})=>{
      await modal.getByLabel('Kategorie',{exact:true}).selectOption('Hotel');
      await modal.getByLabel('Datum',{exact:true}).fill('2026-10-29');
      await modal.getByLabel('Betrag (€)',{exact:true}).fill(String(amount));
      await modal.getByLabel('Händler',{exact:true}).fill('Musterhotel');
      await modal.getByLabel('Rechnungsnummer',{exact:true}).fill(invoice);
      await modal.getByLabel('Projekt',{exact:true}).fill(project);
      if(start)await modal.getByLabel('Übernachtungsbeginn',{exact:true}).fill(start);
      if(end)await modal.getByLabel('Übernachtungsende',{exact:true}).fill(end);
      await modal.getByLabel('Zahlungsart',{exact:true}).selectOption(payment);
    };
    const save=()=>modal.getByRole('button',{name:'Bestätigen & Ausgabe anlegen',exact:true}).click();
    const fits=async()=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'viewport overflow');
    try {
      await page.goto(url);await page.getByRole('heading',{name:'Monatsübersicht',exact:true}).waitFor();
      await nav(page,'Datensicherung');await page.getByRole('button',{name:'Demo-Daten laden',exact:true}).click();
      const seed=await waitState(page,s=>s?.trips.length>0);const base={...seed.trips[0],date:'2026-10-20',endDate:'2026-10-21',startTime:'07:00',endTime:'18:00',order:'26.0123 Musterstadt',destination:'Musterstadt',purpose:'Synthetischer Ortstermin',businessKm:0,privateKm:0,manualAbsenceMinutes:undefined,overnight:true,absenceConfirmed:true,tripType:'dienstlich',status:'ungeprüft',warnings:[],meals:{breakfast:false,lunch:false,dinner:false},dailyMeals:{'2026-10-21':{breakfast:true,lunch:false,dinner:false}}};
      seed.trips=[{...base,id:'trip-a'},{...base,id:'trip-b',date:'2026-11-20',endDate:'2026-11-21',dailyMeals:{}},{...base,id:'trip-c',order:'26.0124 Köln',endDate:'2026-10-23',dailyMeals:{}},{...base,id:'trip-d',order:'26.0124 Köln',endDate:'2026-10-22',dailyMeals:{}}];
      seed.expenses=[];seed.receiptInbox=[];seed.statements=[];seed.changes=[];seed.merchantRules=[];
      await writeState(page,seed);await page.reload();await page.getByRole('heading',{name:'Monatsübersicht',exact:true}).waitFor();await page.locator('input[type=month]').fill('2026-10');
      let frozen,baseline,hotelId;
      await check(`${engine} ${viewport.width}: late hotel invoice, explicit project+stay confirmation and breakfast hint`,async()=>{
        await begin(1);await fields();
        assert.equal(await modal.getByLabel('Passende Reise',{exact:true}).inputValue(),'');
        assert.equal(await modal.locator('.trip-candidate').count(),1);
        assert.match(await modal.innerText(),/Passende Dienstreise gefunden/);
        await modal.getByLabel('Frühstück enthalten',{exact:true}).selectOption('yes');
        assert.match(await modal.innerText(),/Prüfen, ob das Frühstück/);
        await modal.getByRole('button',{name:'Zuordnung bestätigen',exact:true}).click();
        assert.equal(await modal.getByLabel('Passende Reise',{exact:true}).inputValue(),'trip-a');
        await fits();await page.screenshot({path:path.join(output,`${engine}-${viewport.width}-hotel.png`),fullPage:false});
        await save();const s=await waitState(page,s=>s?.expenses.length===1);hotelId=s.expenses[0].id;
        assert.equal(s.expenses[0].date,'2026-10-29');assert.equal(s.expenses[0].stayStart,'2026-10-20');assert.equal(s.expenses[0].tripId,'trip-a');assert.equal(s.expenses[0].paymentType,'Unternehmen');
        assert.deepEqual(s.trips,seed.trips);
        await nav(page,'Monatsübersicht');await page.getByRole('button',{name:'Spesenabrechnung erstellen',exact:true}).click();await waitState(page,s=>s?.statements.length===1);
        await page.locator('.statement-actions select').selectOption('freigegeben');
        const locked=await waitState(page,s=>s?.statements[0].locked);frozen=locked.statements[0];baseline=frozen.data.totals.openAmount;
        assert.equal(frozen.data.totals.companyPaid,115);
      });
      await check(`${engine} ${viewport.width}: quick parking, multiple receipts per trip and ambiguous hotel candidates`,async()=>{
        await page.locator(await page.locator('.quick-fab').isVisible()?'.quick-fab':'.quick-top').click();const quick=page.locator('.quick-sheet');
        await quick.locator('.quick-amount input').fill('12');
        await quick.getByRole('button',{name:'Datum, Zahlungsart oder Reise ändern',exact:true}).click();await quick.getByLabel('Datum',{exact:true}).fill('2026-10-20');
        await quick.getByLabel('Projekt',{exact:true}).fill('26.0123');await quick.getByRole('button',{name:'Zuordnung bestätigen',exact:true}).click();
        const png=Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=8;c.height=8;return c.toDataURL('image/png').split(',')[1];}),'base64');
        await quick.locator('input[type=file]').setInputFiles({name:'synthetic-parking.png',mimeType:'image/png',buffer:png});await quick.getByText('synthetic-parking.png',{exact:true}).waitFor();
        await quick.getByRole('button',{name:'Speichern',exact:true}).click();await waitState(page,s=>s?.expenses.length===2);
        await begin(2);await fields({amount:80,project:'26.0124',payment:'privat vorgestreckt',invoice:'INV-002'});
        assert.equal(await modal.locator('.trip-candidate').count(),2);assert.equal(await modal.getByLabel('Passende Reise',{exact:true}).inputValue(),'');
        await modal.locator('.trip-candidate').first().getByRole('button',{name:'Zuordnung bestätigen',exact:true}).click();await save();
        const s=await waitState(page,s=>s?.expenses.length===3);assert.equal(s.expenses[1].tripId,'trip-a');assert.equal(s.expenses[2].tripId,'trip-c');assert.deepEqual(s.statements[0],frozen);
      });
      await check(`${engine} ${viewport.width}: unassigned expense and inbox retains company payment and stay data`,async()=>{
        await begin(3);await fields({amount:60,project:'26.9999',payment:'privat vorgestreckt',invoice:'INV-003'});assert.equal(await modal.locator('.trip-candidate').count(),0);await save();
        let s=await waitState(page,s=>s?.expenses.length===4);assert.equal(s.expenses[3].tripId,undefined);
        await begin(4);await fields({amount:75,start:'2026-11-20',end:'2026-11-21',invoice:'INV-004'});await modal.getByRole('button',{name:'Nur im Eingang speichern',exact:true}).click();
        await waitState(page,s=>s?.receiptInbox.some(i=>i.status!=='zugeordnet'&&i.paymentType==='Unternehmen'));
        await nav(page,'Kosten & Belege');await page.locator('.receipt-inbox').getByRole('button',{name:'Prüfen',exact:true}).click();
        assert.equal(await modal.getByLabel('Zahlungsart',{exact:true}).inputValue(),'Unternehmen');assert.equal(await modal.getByLabel('Übernachtungsbeginn',{exact:true}).inputValue(),'2026-11-20');
        await modal.getByRole('button',{name:'Zuordnung bestätigen',exact:true}).click();await save();s=await waitState(page,s=>s?.expenses.length===5);assert.equal(s.expenses[4].tripId,'trip-b');assert.deepEqual(s.statements[0],frozen);
      });
      await check(`${engine} ${viewport.width}: exact file and invoice duplicates cannot create a second expense`,async()=>{
        await begin(1);await fields({project:'',start:'',end:''});await save();await page.getByText('Diese Rechnung ist bereits als Ausgabe erfasst.',{exact:false}).waitFor();assert.equal((await state(page)).expenses.length,5);await modal.getByRole('button',{name:'Schließen',exact:true}).click();
        await begin(6);await fields({project:'',start:'',end:''});await save();await page.getByText('Diese Rechnung ist bereits als Ausgabe erfasst.',{exact:false}).waitFor();assert.equal((await state(page)).expenses.length,5);await modal.getByRole('button',{name:'Schließen',exact:true}).click();
      });
      await check(`${engine} ${viewport.width}: trip costs, local receipt view, reassign/detach and stable references`,async()=>{
        await nav(page,'Reisen');const details=page.locator('.trip-linked-expenses').first();await details.locator(':scope > summary').click();
        assert.match(await details.innerText(),/Vom Unternehmen bezahlt/);assert.match(await details.innerText(),/Privat bezahlt/);
        await details.locator('.receipt-attachment').first().locator('summary').click();assert.equal(await details.locator('a[download]:visible').count(),1);
        await details.getByRole('button',{name:'Kosten / Zuordnung bearbeiten',exact:true}).first().click();const editor=page.locator('.modal');
        await editor.getByLabel('Reisezuordnung',{exact:true}).selectOption('trip-b');await editor.getByRole('button',{name:'Speichern & fertig',exact:true}).click();
        let s=await waitState(page,s=>s?.expenses.find(e=>e.id===hotelId)?.tripId==='trip-b');assert.equal(s.receiptInbox.find(i=>i.expenseId===hotelId).tripId,'trip-b');assert.deepEqual(s.statements[0],frozen);
        const card=page.locator('.expense-card').filter({hasText:'115,00'});await card.getByRole('button',{name:'Bearbeiten',exact:true}).click();await editor.getByRole('button',{name:'Zuordnung lösen',exact:true}).click();await editor.getByRole('button',{name:'Speichern & fertig',exact:true}).click();
        s=await waitState(page,s=>s?.expenses.find(e=>e.id===hotelId)?.tripId===undefined);assert.equal(s.receiptInbox.find(i=>i.expenseId===hotelId).tripId,undefined);
        await card.getByRole('button',{name:'Bearbeiten',exact:true}).click();await editor.getByLabel('Reisezuordnung',{exact:true}).selectOption('trip-a');await editor.getByRole('button',{name:'Speichern & fertig',exact:true}).click();await waitState(page,s=>s?.expenses.find(e=>e.id===hotelId)?.tripId==='trip-a');await fits();
      });
      await check(`${engine} ${viewport.width}: frozen report, personal payout, exports, backup and offline reload`,async()=>{
        await nav(page,'Monatsübersicht');await page.getByRole('button',{name:'Abrechnung ansehen',exact:true}).click();assert.deepEqual((await state(page)).statements[0],frozen);
        assert.equal((await download(page,'PDF')).bytes.subarray(0,4).toString(),'%PDF');assert.equal((await download(page,'Excel')).bytes.subarray(0,2).toString(),'PK');
        await page.getByRole('button',{name:'Neue Version erstellen',exact:true}).click();let s=await waitState(page,s=>s?.statements.length===2);
        assert.equal(s.statements[1].data.totals.openAmount,Math.round((baseline+152)*100)/100);assert.equal(s.statements[1].data.totals.companyPaid,190);assert.deepEqual(s.statements[0],frozen);assert.deepEqual(s.trips,seed.trips);
        await nav(page,'Datensicherung');const backup=await download(page,'Sicherung herunterladen');const serialized=JSON.parse(backup.bytes);assert.equal(serialized.expenses[0].breakfastIncluded,'yes');
        await page.locator('.backup-grid input[type=file]').setInputFiles({name:'synthetic-linking-backup.json',mimeType:'application/json',buffer:backup.bytes});await page.getByText('Datensicherung wiederhergestellt',{exact:true}).waitFor();
        await page.evaluate(()=>navigator.serviceWorker.ready);await page.reload();await page.getByRole('heading',{name:'Monatsübersicht',exact:true}).waitFor();await context.setOffline(true);await page.reload();await page.getByRole('heading',{name:'Monatsübersicht',exact:true}).waitFor();
        assert.deepEqual(JSON.parse(JSON.stringify(await state(page))),serialized);await context.setOffline(false);await fits();assert.deepEqual(errors,[]);
      });
      await check(`${engine} ${viewport.width}: ambiguous suggestions stay unassigned without explicit confirmation`,async()=>{
        const before=await state(page);await begin(7);await fields({amount:15,project:'26.0124',invoice:'INV-007'});
        assert.equal(await modal.locator('.trip-candidate').count(),2);await save();
        const saved=await waitState(page,s=>s?.expenses.length===before.expenses.length+1);
        assert.equal(saved.expenses.at(-1).tripId,undefined);assert.deepEqual(saved.statements,before.statements);assert.deepEqual(saved.trips,before.trips);
      });
      await check(`${engine} ${viewport.width}: legacy inbox without payment remains unknown and non-reimbursable`,async()=>{
        const before=await state(page);const legacy={id:'legacy-inbox',receipt:{...before.receiptInbox[0].receipt,id:'legacy-file',hash:'legacy-unique-hash',name:'synthetic-legacy.pdf'},capturedAt:'2026-10-30',status:'neu',suggestion:{date:'2026-10-30',gross:20,category:'Parken',confidence:0},notes:''};
        await writeState(page,{...before,receiptInbox:[...before.receiptInbox,legacy]});await page.reload();await page.getByRole('heading',{name:'Monatsübersicht',exact:true}).waitFor();await page.locator('input[type=month]').fill('2026-10');await nav(page,'Kosten & Belege');
        await page.locator('.receipt-inbox').getByRole('button',{name:'Prüfen',exact:true}).click();
        assert.equal(await modal.getByLabel('Zahlungsart',{exact:true}).inputValue(),'unbekannt');await save();
        const saved=await waitState(page,s=>s?.expenses.length===before.expenses.length+1);
        assert.equal(saved.expenses.at(-1).paymentType,'unbekannt');assert.equal(saved.expenses.at(-1).paidBy,'');assert.equal(saved.expenses.at(-1).reimbursementStatus,'nicht erstattungsfähig');
        assert.deepEqual(saved.expenses.slice(0,-1),before.expenses);assert.deepEqual(saved.statements,before.statements);
      });
    } catch(e) {await page.screenshot({path:path.join(output,`${engine}-${viewport.width}-failure.png`),fullPage:true});console.error('Browser failure artifacts:',output);throw e;} finally {await context.close();}
  }
  console.log(JSON.stringify({url,output,checks:results.length,results},null,2));
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
