// Static server hardening (M11 review): a request must never escape the served folder (a sibling
// folder whose name starts with the same prefix was reachable) and a malformed escape must answer
// 400 instead of crashing the server.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { startStatic } from "./serve.mjs";

const get = (url, path) =>
  new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = request({ host: u.hostname, port: u.port, path, method: "GET" }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode));
    });
    req.on("error", reject);
    req.end();
  });

describe("static server", () => {
  it("serves files inside the folder only and survives malformed escapes", async () => {
    const root = mkdtempSync(join(tmpdir(), "hf-serve-"));
    mkdirSync(join(root, "dist"));
    mkdirSync(join(root, "dist-test"));
    writeFileSync(join(root, "dist", "index.html"), "ok");
    writeFileSync(join(root, "dist-test", "index.html"), "secret");
    const s = await startStatic(join(root, "dist"), 0);
    try {
      expect(await get(s.url, "/")).toBe(200);
      expect(await get(s.url, "/%2e%2e/dist-test/index.html")).toBe(404);
      expect(await get(s.url, "/..%2fdist-test/index.html")).toBe(404);
      expect(await get(s.url, "/%E0%A4%A")).toBe(400);
      expect(await get(s.url, "/")).toBe(200);
    } finally {
      await s.close();
    }
  });

  it("a taken port rejects with EADDRINUSE, which serve turns into a readable message (BACKLOG 96)", async () => {
    const root = mkdtempSync(join(tmpdir(), "hf-serve-"));
    const s = await startStatic(root, 0);
    try {
      const port = Number(new URL(s.url).port);
      await expect(startStatic(root, port)).rejects.toMatchObject({ code: "EADDRINUSE" });
    } finally {
      await s.close();
    }
  });
});
