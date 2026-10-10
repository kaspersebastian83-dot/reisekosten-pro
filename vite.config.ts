import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Relative URLs make one build work at both user.github.io and
  // user.github.io/repository-name without knowing the repository in advance.
  base: "./",
  plugins: [react()],
  server: {
    host: "localhost",
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
