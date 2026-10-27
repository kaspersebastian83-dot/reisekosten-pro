// Alle Browserprüfungen nacheinander (vorher `npm run build`). In GitHub Actions erscheint ein Fehler zusätzlich als Annotation.
// Nicht dabei: branding-browser-check.mjs – braucht eine alte Produktionsversion (LEGACY_DIST) und prüft nur die einmalige Umbenennung.
import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
const AUSGENOMMEN = new Set(['branding-browser-check.mjs']);
const dateien = (await readdir('tests')).filter((f) => /browser.*\.mjs$/.test(f) && f !== 'run-browser-checks.mjs' && !AUSGENOMMEN.has(f)).sort();
const nur = process.argv.slice(2);
let fehler = 0;
for (const datei of nur.length ? dateien.filter((f) => nur.some((n) => f.includes(n))) : dateien) {
  console.log(`\n=== ${datei} ===`);
  let ausgabe = '';
  const code = await new Promise((resolve, reject) => {
    const c = spawn(process.execPath, [`tests/${datei}`], { stdio: ['ignore', 'pipe', 'pipe'] });
    for (const [s, d] of [[c.stdout, process.stdout], [c.stderr, process.stderr]]) s.on('data', (x) => { ausgabe += x; d.write(x); });
    c.once('error', reject); c.once('exit', resolve);
  });
  if (code !== 0) {
    fehler++;
    if (process.env.GITHUB_ACTIONS) {
      const rest = ausgabe.replace(/\u001b\[[0-9;]*m/g, '').split('\n').filter((l) => !/^(PASS|OK) /.test(l) && !/^\s+at /.test(l) && !/^\[pid=/.test(l)).join('\n').trim().slice(-1500);
      console.log(`::error title=${datei}::${rest.replace(/%/g, '%25').replace(/\r/g, '').replace(/\n/g, '%0A')}`);
    }
  }
}
console.log(`\n${fehler ? `${fehler} Browserprüfung(en) fehlgeschlagen` : 'Alle Browserprüfungen bestanden'}`);
process.exitCode = fehler ? 1 : 0;
