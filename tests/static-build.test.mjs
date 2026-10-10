import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("creates a GitHub Pages compatible static build", async () => {
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  const manifest = JSON.parse(
    await readFile(new URL("../dist/manifest.webmanifest", import.meta.url), "utf8"),
  );
  const worker = await readFile(new URL("../dist/sw.js", import.meta.url), "utf8");

  assert.match(html, /<div id="root"><\/div>/);
  assert.match(html, /\.\/assets\/[^"']+\.js/);
  assert.equal(manifest.start_url, ".");
  assert.equal(manifest.scope, ".");
  assert.match(worker, /self\.registration\.scope/);
  assert.doesNotMatch(html, /(?:href|src)=["']\/(?!\/)/);
});
