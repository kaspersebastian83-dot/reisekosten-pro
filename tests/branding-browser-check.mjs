// Rename-upgrade regression: LEGACY_DIST must point to an unchanged pre-rename production build.
// All data is synthetic; this never opens the user browser profile.
// PLAYWRIGHT_MODULE=/absolute/path/to/playwright BROWSER_EXECUTABLE=/path/to/browser LEGACY_DIST=/path/to/old/dist node tests/branding-browser-check.mjs
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
const currentRoot = path.resolve('dist');
assert.ok(process.env.LEGACY_DIST,'Provide LEGACY_DIST with a pre-rename production build');
let root = path.resolve(process.env.LEGACY_DIST);
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
const {context,page}=await open();
try {
  await page.goto(url);await page.getByRole('heading',{name:'Reisen',exact:true}).waitFor();
  assert.equal(await page.title(),'Reisekosten Pro','fixture must really be the old app');
  const oldManifest=await (await page.request.get(url+'manifest.webmanifest')).json();
  await nav(page,'Datensicherung');await page.getByRole('button',{name:'Demo-Daten laden',exact:true}).click();
  await waitState(page,s=>s?.trips.length>0);
  await page.locator('input[type=month]').fill('2026-07');
  await page.getByRole('button',{name:'Ausgabe',exact:true}).click();
  const quick=page.locator('.quick-sheet');await quick.locator('.quick-amount input').fill('7.50');
  const png=Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=16;c.height=16;return c.toDataURL('image/png').split(',')[1];}),'base64');
  await quick.locator('input[type=file]').setInputFiles({name:'synthetic-existing-receipt.png',mimeType:'image/png',buffer:png});
  await quick.getByText('synthetic-existing-receipt.png',{exact:true}).waitFor();
  await quick.getByRole('button',{name:'Speichern',exact:true}).click();
  await waitState(page,s=>s?.expenses.some(e=>e.receipt));
  await nav(page,'Monatsabrechnungen');await page.getByRole('button',{name:'Abrechnung erstellen',exact:true}).click();
  await waitState(page,s=>s?.statements.length===1);
  await page.locator('.statement-actions select').selectOption('freigegeben');
  const before=await waitState(page,s=>s?.statements[0].locked);
  assert.ok(before.statements[0].expensesSnapshot.some(e=>e.receipt));
  await page.evaluate(async()=>{localStorage.setItem('synthetic-existing-setting','keep');await navigator.serviceWorker.ready;});
  await nav(page,'Datensicherung');const backup=await download(page,'Sicherung herunterladen');
  assert.deepEqual(JSON.parse(backup.bytes),JSON.parse(JSON.stringify(before)));
  await check('existing installation updates from Reisekosten Pro to SpesenKit without changing stored data',async()=>{
    root=currentRoot;
    await page.evaluate(async()=>{await(await navigator.serviceWorker.ready).update();});
    await page.getByRole('button',{name:'Jetzt aktualisieren',exact:true}).waitFor();
    await page.getByRole('button',{name:'Jetzt aktualisieren',exact:true}).click();
    await page.waitForFunction(()=>document.title==='SpesenKit');
    await page.getByRole('heading',{name:'Monatsübersicht',exact:true}).waitFor();
    assert.deepEqual(await state(page),before);
    assert.equal(await page.evaluate(()=>localStorage.getItem('synthetic-existing-setting')),'keep');
    const databases=await page.evaluate(()=>indexedDB.databases());
    assert.deepEqual(databases.map(db=>({name:db.name,version:db.version})),[{name:'reisekosten-pro',version:1}]);
    assert.deepEqual(await page.evaluate(()=>new Promise(resolve=>{const r=indexedDB.open('reisekosten-pro');r.onsuccess=()=>{const db=r.result;resolve([...db.objectStoreNames]);db.close();};})),['state']);
    const manifest=await (await page.request.get(url+'manifest.webmanifest')).json();
    for(const key of ['id','scope','start_url'])assert.equal(manifest[key],oldManifest[key]);
    assert.equal(manifest.name,'SpesenKit');assert.equal(manifest.short_name,'SpesenKit');
    assert.equal(await page.locator('.brand b').innerText(),'SpesenKit');
    await page.locator('input[type=month]').fill('2026-07');await nav(page,'Monatsübersicht');await page.getByRole('button',{name:'Abrechnung ansehen',exact:true}).click();
    const pdf=await download(page,'PDF');assert.match(pdf.bytes.toString('latin1'),/Reisekostenabrechnung/);
    const excel=await download(page,'Excel');const {Workbook}=require('exceljs');const workbook=new Workbook();await workbook.xlsx.load(excel.bytes);
    assert.equal(workbook.creator,'SpesenKit');assert.equal(workbook.getWorksheet('Übersicht').getCell('A1').value,'Reisekostenabrechnung');
    assert.deepEqual(await state(page),before,'export must not change frozen statements');
    await nav(page,'Einstellungen');assert.match(await page.locator('.app-version').innerText(),/SpesenKit/);
  });
  await check('existing backup, frozen receipt snapshot and offline startup survive the rename',async()=>{
    await nav(page,'Datensicherung');const after=await download(page,'Sicherung herunterladen');
    assert.deepEqual(JSON.parse(after.bytes),JSON.parse(backup.bytes));
    page.once('dialog',dialog=>void dialog.accept());await page.locator('.backup-grid input[type=file]').setInputFiles({name:'synthetic-old-backup.json',mimeType:'application/json',buffer:backup.bytes});
    await page.getByText('Datensicherung wiederhergestellt',{exact:true}).waitFor();
    // JSON backups omit undefined properties; compare the serialized backup contract.
    const restored=JSON.parse(backup.bytes);
    assert.deepEqual(JSON.parse(JSON.stringify(await state(page))),restored);
    await context.setOffline(true);await page.reload();await page.getByRole('heading',{name:'Monatsübersicht',exact:true}).waitFor();
    assert.equal(await page.title(),'SpesenKit');assert.deepEqual(JSON.parse(JSON.stringify(await state(page))),restored);
    await nav(page,'Fahrten importieren');await page.getByRole('heading',{name:'Fahrtenbuch auswählen'}).waitFor();
    await context.setOffline(false);
  });
  console.log(JSON.stringify({url,output,engine,checks:results.length,results},null,2));
} catch(error) {await page.screenshot({path:path.join(output,'rename-failure.png'),fullPage:true});console.error('Browser failure artifacts:',output);throw error;}
finally {await context.close();await browser.close();await new Promise(resolve=>server.close(resolve));}
