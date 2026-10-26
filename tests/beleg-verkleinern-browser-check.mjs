// Optional browser checks: existing Playwright installation, no project dependency.
// PLAYWRIGHT_MODULE=/absolute/path/to/playwright BROWSER_EXECUTABLE=/path/to/browser node tests/beleg-verkleinern-browser-check.mjs
// Optional BROWSER_ENGINE=webkit for Safari-engine coverage.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
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
const state=page=>storedState(page);   // Belegbilder aus der Bilddatenbank wieder eingesetzt (seit 1.9 getrennt gespeichert)
const waitState=async(page,fn)=>{for(let i=0;i<60;i++){const s=await state(page);if(s&&fn(s))return s;await page.waitForTimeout(100);}throw Error('Saved state condition timed out');};
// SpesenKit 1.8.1: „Bisher: …“ im Feld „Verwendetes Fahrzeug“ ließ schon im einzelnen Tab jedes weitere Speichern
// SpesenKit 1.8.3: Belegfotos werden beim Erfassen verkleinert (längste Seite ≤ 2000 px, JPEG); PDFs bleiben unverändert.
// Synthetisches „Handyfoto“ 4032 × 3024 mit Rauschen, damit es wirklich mehrere MB groß ist.
const browser=await engines[engine].launch({headless:true,...(process.env.BROWSER_EXECUTABLE ? {executablePath:process.env.BROWSER_EXECUTABLE}: {})});
try {
  const context=await browser.newContext({viewport:{width:390,height:844}});
  await context.route(/https?:\/\/(?!127\.0\.0\.1)/,r=>r.abort());   // OCR-Dateien bewusst blockiert
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);await page.getByRole('heading',{name:'Monatsübersicht',exact:true}).waitFor();
  const foto=Buffer.from(await page.evaluate(()=>{
    const c=document.createElement('canvas');c.width=4032;c.height=3024;const g=c.getContext('2d');
    const d=g.createImageData(c.width,c.height);for(let i=0;i<d.data.length;i+=4){const v=(Math.random()*255)|0;d.data[i]=v;d.data[i+1]=(v*7)&255;d.data[i+2]=(v*13)&255;d.data[i+3]=255;}
    g.putImageData(d,0,0);g.fillStyle='#000';g.font='120px sans-serif';g.fillText('SUMME 12,50 EUR',300,1500);
    return c.toDataURL('image/jpeg',0.95).split(',')[1];
  }),'base64');
  assert.ok(foto.length>3_000_000,`Testfoto groß genug (${foto.length} Bytes)`);
  const erfasse=async(file)=>{
    await page.locator('.month-entry-workspace').getByRole('button',{name:'Beleg fotografieren / OCR',exact:true}).click();
    await page.locator('.receipt-capture input[type=file]').first().setInputFiles(file);
    await page.locator('.receipt-capture').getByLabel('Datum',{exact:true}).waitFor({timeout:30000});await page.waitForTimeout(500);
    await page.locator('.receipt-capture').getByLabel('Datum',{exact:true}).fill('2026-03-09');await page.locator('.receipt-capture').getByLabel('Betrag (€)',{exact:true}).fill('12.50');
    await page.getByRole('button',{name:'Nur im Eingang speichern',exact:true}).click();
  };
  await erfasse({name:'IMG_4711.JPG',mimeType:'image/jpeg',buffer:foto});
  let s=await waitState(page,s=>s.receiptInbox.length===1);
  const r=s.receiptInbox[0].receipt;
  assert.equal(r.type,'image/jpeg');assert.equal(r.name,'IMG_4711.jpg');
  assert.ok(r.size<foto.length/3,`deutlich kleiner: ${r.size} statt ${foto.length} Bytes`);
  const groesse=await page.evaluate(async(src)=>{const i=new Image();i.src=src;await i.decode();return [i.naturalWidth,i.naturalHeight];},r.dataUrl);
  assert.deepEqual(groesse,[2000,1500]);
  const sha=(await import('node:crypto')).createHash('sha256').update(foto).digest('hex');
  assert.equal(r.hash,sha,'Fingerabdruck der Originaldatei – Duplikate werden weiter erkannt');
  console.log(`PASS Handyfoto ${(foto.length/1e6).toFixed(1)} MB → ${(r.size/1e6).toFixed(2)} MB, 2000 × 1500`);
  // PDF bleibt unverändert
  const pdf=Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
  await erfasse({name:'Rechnung.pdf',mimeType:'application/pdf',buffer:pdf});
  s=await waitState(page,s=>s.receiptInbox.length===2);
  const p=s.receiptInbox.find(x=>x.receipt.name==='Rechnung.pdf').receipt;
  assert.equal(p.type,'application/pdf');assert.equal(p.size,pdf.length);
  assert.equal(Buffer.from(p.dataUrl.split(',')[1],'base64').toString(),pdf.toString());
  console.log('PASS PDF bleibt unverändert');
  assert.deepEqual(errors.filter(e=>!/importScripts|tesseract/i.test(e)),[],'keine Fehler außer der bewusst blockierten Texterkennung');
  // 1.8.4: Speichern wartet auf die Texterkennung; hängt sie, lässt sie sich abbrechen.
  {
    const ctx2=await browser.newContext({viewport:{width:390,height:844}});
    await ctx2.route(/https?:\/\/(?!127\.0\.0\.1)/,()=>{});            // Texterkennung lädt nie fertig
    const p2=await ctx2.newPage();await p2.goto(url);await p2.getByRole('heading',{name:'Monatsübersicht',exact:true}).waitFor();
    await p2.locator('.month-entry-workspace').getByRole('button',{name:'Beleg fotografieren / OCR',exact:true}).click();
    await p2.locator('.receipt-capture input[type=file]').first().setInputFiles({name:'IMG_1.JPG',mimeType:'image/jpeg',buffer:foto});
    const save=p2.getByRole('button',{name:'Nur im Eingang speichern',exact:true});
    await p2.getByRole('button',{name:'Erkennung abbrechen',exact:true}).waitFor({timeout:30000});
    assert.equal(await save.isDisabled(),true,'Speichern wartet auf die Erkennung');
    await p2.getByRole('button',{name:'Erkennung abbrechen',exact:true}).click();
    await p2.getByText('Erkennung abgebrochen',{exact:false}).waitFor();
    assert.equal(await save.isDisabled(),false,'nach dem Abbrechen speicherbar');
    await ctx2.close();
    console.log('PASS Speichern wartet auf die Texterkennung, Abbrechen möglich');
  }
} finally { await browser.close(); server.close(); }
