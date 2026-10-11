import { defineConfig } from "vite";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";

export default defineConfig({
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
        .replace("/* BUILD_ASSETS */", assets.map((name) => JSON.stringify(`./${name}`)).join(", "));
      this.emitFile({ type: "asset", fileName: "sw.js", source });
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
