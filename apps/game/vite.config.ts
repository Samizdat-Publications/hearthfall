import { defineConfig } from "vite";

// Root is apps/game. `--mode test` keeps the window.__game debug API (dev keeps it too).
export default defineConfig(({ mode }) => ({
  root: "apps/game",
  base: "./",
  define: { __DEBUG_API__: JSON.stringify(mode !== "production") },
  oxc: { jsx: { runtime: "automatic", importSource: "preact" } },
  server: { host: "127.0.0.1", strictPort: true, port: 5180 },
  preview: { host: "127.0.0.1", strictPort: true, port: 5181 },
  build: { outDir: mode === "test" ? "dist-test" : "dist", emptyOutDir: true, chunkSizeWarningLimit: 2000 },
}));
