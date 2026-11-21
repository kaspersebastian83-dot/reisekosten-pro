// Nur für die CI (E9, Audit Lauf 5): wird von tests/run-browser-checks.mjs als PLAYWRIGHT_MODULE eingesetzt, wenn
// BROWSER_ARTEFAKTE_DIR gesetzt ist. Reicht das echte Playwright (PLAYWRIGHT_ECHT) durch und macht ein Bildschirmfoto
// jeder offenen Seite, bevor ein Kontext oder der Browser geschlossen wird – bei einem Fehlschlag also vom Stand,
// an dem die Prüfung abbrach (die Prüfungen schließen im finally). Die Prüfungen selbst bleiben unverändert;
// der Runner löscht die Fotos wieder, wenn die Prüfung grün war.
const fs = require('node:fs');
const path = require('node:path');
const echt = require(process.env.PLAYWRIGHT_ECHT || 'playwright');
const dir = process.env.BROWSER_ARTEFAKTE;
let n = 0;

async function fotos(context, wann) {
  if (!dir) return;
  for (const page of context.pages()) {
    if (page.isClosed()) continue;
    const name = `${String(++n).padStart(3, '0')}-${wann}.png`;
    try {
      fs.mkdirSync(dir, { recursive: true });
      await page.screenshot({ path: path.join(dir, name), fullPage: true, timeout: 5000 });
      fs.appendFileSync(path.join(dir, 'seiten.txt'), `${name}  ${page.url()}\n`);
    } catch (e) {
      try { fs.appendFileSync(path.join(dir, 'seiten.txt'), `${name}  (kein Foto: ${String(e && e.message || e).split('\n')[0]})\n`); } catch { /* egal */ }
    }
  }
}

function browserMitFotos(browser) {
  const newContext = browser.newContext.bind(browser), close = browser.close.bind(browser);
  browser.newContext = async (...a) => {
    const context = await newContext(...a), zu = context.close.bind(context);
    context.close = async (...x) => { await fotos(context, 'kontext'); return zu(...x); };
    return context;
  };
  browser.close = async (...a) => { for (const c of browser.contexts()) await fotos(c, 'ende'); return close(...a); };
  return browser;
}

function engineMitFotos(engine) {
  if (!engine || typeof engine.launch !== 'function') return engine;
  return new Proxy(engine, {
    get(ziel, name) {
      if (name === 'launch') return async (...a) => browserMitFotos(await ziel.launch(...a));
      const v = Reflect.get(ziel, name);
      return typeof v === 'function' ? v.bind(ziel) : v;
    },
  });
}

module.exports = new Proxy(echt, {
  get(ziel, name) {
    const v = Reflect.get(ziel, name);
    return ['chromium', 'firefox', 'webkit'].includes(name) ? engineMitFotos(v) : v;
  },
});
