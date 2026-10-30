import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("creates a GitHub Pages compatible static build", async () => {
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  const manifest = JSON.parse(
    await readFile(new URL("../dist/manifest.webmanifest", import.meta.url), "utf8"),
  );
  const worker = await readFile(new URL("../dist/sw.js", import.meta.url), "utf8");

  assert.match(html, /id="startup-status"/);
  assert.match(html, /\.\/assets\/[^"']+\.js/);
  assert.equal(manifest.start_url, ".");
  assert.equal(manifest.scope, ".");
  assert.match(worker, /self\.registration\.scope/);
  assert.doesNotMatch(worker, /__BUILD_ID__|BUILD_ASSETS/);
  const entry = html.match(/src="\.\/(assets\/[^"']+\.js)"/)[1];
  assert.ok(worker.includes(entry), "Worker precaches the production entry module");
  assert.match(worker, /key\.startsWith\(CACHE_PREFIX\)/);
  assert.doesNotMatch(html, /(?:href|src)=["']\/(?!\/)/);
});

test("Demo-Daten stecken nur in einem nachgeladenen Teil", async () => {
  const { readdir } = await import("node:fs/promises");
  const assets = new URL("../dist/assets/", import.meta.url);
  const mitDemo = [], mitKnopf = [];
  for (const name of await readdir(assets)) {
    if (!name.endsWith(".js")) continue;
    const js = await readFile(new URL(name, assets), "utf8");
    if (js.includes("K-RK 2026")) mitDemo.push(name);
    if (js.includes("Demo-Daten laden")) mitKnopf.push(name);
  }
  assert.equal(mitDemo.length, 1, "erfundene Demo-Fahrten in genau einem Teil");
  assert.match(mitDemo[0], /^demo-/);
  assert.ok(mitKnopf.length && !mitKnopf.includes(mitDemo[0]), "Knopf (nur mit ?demo) lädt die Daten erst beim Klick");
});

test("SpesenKit branding preserves PWA identity, repository paths and icon sizes", async () => {
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  const manifest = JSON.parse(await readFile(new URL("../dist/manifest.webmanifest", import.meta.url), "utf8"));
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.match(html, /<title>SpesenKit<\/title>/);
  assert.match(html, /apple-mobile-web-app-title" content="SpesenKit"/);
  assert.doesNotMatch(html, /Reisekosten Pro/);
  assert.equal(pkg.name, "reisekosten-pro");
  assert.equal(pkg.displayName, "SpesenKit");
  assert.equal(manifest.name, "SpesenKit");
  assert.equal(manifest.short_name, "SpesenKit");
  assert.equal(manifest.description, "Dienstreisen · Spesen · Abrechnungen");
  for (const key of ["id", "start_url", "scope"]) assert.equal(manifest[key], ".");
  assert.match(html, /rel="apple-touch-icon" href="\.\/icon-192.png"/);
  for (const size of [192, 512]) {
    const png = await readFile(new URL(`../dist/icon-${size}.png`, import.meta.url));
    assert.equal(png.subarray(1, 4).toString(), "PNG");
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
    assert.ok(manifest.icons.some(icon => icon.src === `./icon-${size}.png` && icon.sizes === `${size}x${size}` && icon.purpose === "any maskable"));
  }
  assert.match(await readFile(new URL("../dist/favicon.svg", import.meta.url), "utf8"), /<title id="title">SpesenKit<\/title>/);
});

test("Handbuch-Link zeigt auf eine feste AidKit-Adresse", async () => {
  const { readdir } = await import("node:fs/promises");
  const assets = new URL("../dist/assets/", import.meta.url);
  let found = "";
  for (const name of await readdir(assets)) {
    if (!name.endsWith(".js")) continue;
    const js = await readFile(new URL(name, assets), "utf8");
    const m = js.match(/\.\.\/aidkit\/#([a-z0-9-]+)/);
    if (m) { found = m[1]; assert.ok(/target:\s*["'`]aidkit["'`]/.test(js), "öffnet AidKit im eigenen Fenster"); break; }
  }
  assert.equal(found, "app-spesenkit");
  // Liegt AidKit daneben (lokal), mit dessen Liste der festen Adressen prüfen
  try {
    const anker = JSON.parse(await readFile(new URL("../../aidkit/hilfe-anker.json", import.meta.url), "utf8")).anker;
    assert.ok(anker[found], `AidKit kennt #${found}`);
  } catch (error) { if (error.code !== "ENOENT") throw error; }
});
