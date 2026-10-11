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
