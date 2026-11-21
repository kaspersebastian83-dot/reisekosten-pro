// Alle Browserprüfungen nacheinander (vorher `npm run build`). In GitHub Actions erscheint ein Fehler zusätzlich als Annotation.
// Nicht dabei: branding-browser-check.mjs – braucht eine alte Produktionsversion (LEGACY_DIST) und prüft nur die einmalige Umbenennung.
// Mit BROWSER_ARTEFAKTE_DIR (in der CI, E9 Audit Lauf 5): je roter Prüfung ein Ordner mit dem vollen Protokoll (protokoll.txt) und
// Bildschirmfotos der offenen Seiten beim Schließen (tests/helpers/playwright-fotos.cjs) plus die Fotos, die eine Prüfung selbst ablegt;
// grüne Prüfungen hinterlassen nichts.
import { spawn } from 'node:child_process';
import { readdir, mkdir, rm, writeFile, cp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
const ARTEFAKTE = process.env.BROWSER_ARTEFAKTE_DIR ? path.resolve(process.env.BROWSER_ARTEFAKTE_DIR) : '';
const echtesPlaywright = () => process.env.PLAYWRIGHT_MODULE || createRequire(import.meta.url).resolve('playwright');
const AUSGENOMMEN = new Set(['branding-browser-check.mjs']);
const dateien = (await readdir('tests')).filter((f) => /browser.*\.mjs$/.test(f) && f !== 'run-browser-checks.mjs' && !AUSGENOMMEN.has(f)).sort();
const nur = process.argv.slice(2);
let fehler = 0;
for (const datei of nur.length ? dateien.filter((f) => nur.some((n) => f.includes(n))) : dateien) {
  console.log(`\n=== ${datei} ===`);
  let ausgabe = '';
  const ablage = ARTEFAKTE && path.join(ARTEFAKTE, datei.replace(/\.mjs$/, ''));
  const env = ablage ? { ...process.env, PLAYWRIGHT_ECHT: echtesPlaywright(), PLAYWRIGHT_MODULE: path.resolve('tests/helpers/playwright-fotos.cjs'), BROWSER_ARTEFAKTE: ablage } : process.env;
  if (ablage) await rm(ablage, { recursive: true, force: true });
  const code = await new Promise((resolve, reject) => {
    const c = spawn(process.execPath, [`tests/${datei}`], { stdio: ['ignore', 'pipe', 'pipe'], env });
    for (const [s, d] of [[c.stdout, process.stdout], [c.stderr, process.stderr]]) s.on('data', (x) => { ausgabe += x; d.write(x); });
    c.once('error', reject); c.once('exit', resolve);
  });
  if (ablage) {
    if (code === 0) await rm(ablage, { recursive: true, force: true });
    else {
      await mkdir(ablage, { recursive: true }); await writeFile(path.join(ablage, 'protokoll.txt'), `Exit-Code ${code}\n\n${ausgabe}`);
      // Viele Prüfungen legen bei Rot schon selbst Fotos in einen Temp-Ordner („Browser failure artifacts: …“) – mitnehmen, sonst gehen sie in der CI verloren.
      for (const [, quelle] of ausgabe.matchAll(/Browser failure artifacts:\s*(\S+)/g)) await cp(quelle, path.join(ablage, 'eigene-' + path.basename(quelle)), { recursive: true }).catch(() => {});
    }
  }
  if (code !== 0) {
    fehler++;
    if (process.env.GITHUB_ACTIONS) {
      const rest = ausgabe.replace(/\u001b\[[0-9;]*m/g, '').split('\n').filter((l) => !/^(PASS|OK) /.test(l) && !/^\s+at /.test(l) && !/^\[pid=/.test(l)).join('\n').trim().slice(-1500);
      console.log(`::error title=${datei}::${rest.replace(/%/g, '%25').replace(/\r/g, '').replace(/\n/g, '%0A')}`);
    }
  }
}
console.log(`\n${fehler ? `${fehler} Browserprüfung(en) fehlgeschlagen${ARTEFAKTE ? ` – Protokolle und Bildschirmfotos in ${ARTEFAKTE}` : ''}` : 'Alle Browserprüfungen bestanden'}`);
process.exitCode = fehler ? 1 : 0;
