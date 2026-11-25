import { defineConfig } from "vite";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import react from "@vitejs/plugin-react";

const version = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version;
// Belegerkennung (tesseract.js): Arbeitsskript, Rechenkern und Sprachdateien liegen in der App selbst unter ./tesseract/,
// statt beim ersten Lesen von cdn.jsdelivr.net geladen zu werden. Nur die „lstm“-Kerne: gelesen wird mit OEM 1.
const packageFile = (name: string) => new URL(`./node_modules/${name}`, import.meta.url);
const packageVersion = (name: string) => JSON.parse(readFileSync(packageFile(`${name}/package.json`), "utf8")).version as string;
const ocrFiles: Record<string, string> = {
  "worker.min.js": "tesseract.js/dist/worker.min.js",
  "tesseract-core-lstm.wasm.js": "tesseract.js-core/tesseract-core-lstm.wasm.js",
  "tesseract-core-simd-lstm.wasm.js": "tesseract.js-core/tesseract-core-simd-lstm.wasm.js",
  "tesseract-core-relaxedsimd-lstm.wasm.js": "tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js",
  "deu.traineddata.gz": "@tesseract.js-data/deu/4.0.0_best_int/deu.traineddata.gz",
  "eng.traineddata.gz": "@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz",
};
// Ändert sich nur mit den Paketversionen: Der OCR-Cache des Service Workers übersteht damit App-Updates.
const ocrId = createHash("sha256").update(["tesseract.js", "tesseract.js-core", "@tesseract.js-data/deu", "@tesseract.js-data/eng"].map((name) => `${name}@${packageVersion(name)}`).join("|") + Object.keys(ocrFiles).join("|")).digest("hex").slice(0, 16);
let commit = process.env.GITHUB_SHA || "";
if (!commit) { try { commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch { /* Source archive build. */ } }
export default defineConfig({
  define: { __APP_RELEASE__: JSON.stringify({ version, commit: commit.slice(0, 7) }) },
  // Relative URLs make one build work at both user.github.io and
  // user.github.io/repository-name without knowing the repository in advance.
  base: "./",
  plugins: [react(), {
    name: "reisekosten-offline-shell",
    generateBundle(_, bundle) {
      const assets = Object.keys(bundle).filter((name) => /\.(js|css)$/.test(name)).sort();
      const template = readFileSync(new URL("./public/sw.js", import.meta.url), "utf8");
      const id = createHash("sha256").update(JSON.stringify(assets) + template + readFileSync(new URL("./index.html", import.meta.url), "utf8")).digest("hex").slice(0, 16);
      const source = template
        .replace("__BUILD_ID__", id)
        .replace("__OCR_ID__", ocrId)
        .replace("/* BUILD_ASSETS */", assets.map((name) => JSON.stringify(`./${name}`)).join(", "));
      this.emitFile({ type: "asset", fileName: "sw.js", source });
      for (const [name, file] of Object.entries(ocrFiles)) this.emitFile({ type: "asset", fileName: `tesseract/${name}`, source: readFileSync(packageFile(file)) });
    },
    // npm run dev: dieselben Dateien unter /tesseract/ ausliefern.
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const file = ocrFiles[(request.url || "").split("?")[0].replace(/^\/tesseract\//, "")];
        if (!file || !request.url?.startsWith("/tesseract/")) return next();
        response.setHeader("Content-Type", file.endsWith(".gz") ? "application/gzip" : "text/javascript");
        response.end(readFileSync(packageFile(file)));
      });
    },
  }],
  server: {
    host: "localhost",
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
