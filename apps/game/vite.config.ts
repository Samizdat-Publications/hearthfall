import { execSync } from "node:child_process";
import { defineConfig } from "vite";

/** BACKLOG 17: the build tag on the main menu (date and commit); empty in test builds so shots stay stable */
export function buildTag(mode: string): string {
  if (mode === "test") return "";
  let sha = "";
  try {
    sha = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    sha = "";
  }
  return `${new Date().toISOString().slice(0, 10)}${sha ? " " + sha : ""}`;
}

// Root is apps/game. `--mode test` keeps the window.__game debug API (dev keeps it too).
export default defineConfig(({ mode }) => ({
  root: "apps/game",
  base: "./",
  define: { __DEBUG_API__: JSON.stringify(mode !== "production"), __BUILD_TAG__: JSON.stringify(buildTag(mode)) },
  oxc: { jsx: { runtime: "automatic", importSource: "preact" } },
  server: { host: "127.0.0.1", strictPort: true, port: 5180 },
  preview: { host: "127.0.0.1", strictPort: true, port: 5181 },
  build: { outDir: mode === "test" ? "dist-test" : "dist", emptyOutDir: true, chunkSizeWarningLimit: 2000 },
}));
