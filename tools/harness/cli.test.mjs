// Harness command routing (M11 regression): new cases once sat between `shot` and its shared handler, so
// `npm run shot` fell through into the static server and never returned. Each shot-family command must
// reach the shot code: with an unknown set it fails fast instead of serving.
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const ROOT = new URL("../../", import.meta.url);

describe("cli routing", () => {
  for (const cmd of ["shot", "shot-approve"]) {
    it(`${cmd} reaches the shot code`, () => {
      const r = spawnSync(process.execPath, ["tools/harness/cli.mjs", cmd, "--set", "__none__"], { cwd: ROOT, encoding: "utf8", timeout: 60000 });
      const text = r.stdout + r.stderr;
      expect(r.signal).toBeNull();
      expect(text).not.toMatch(/being served/);
      expect(text).toMatch(/no shot set __none__|shot:approve needs --reason/);
    }, 70000);
  }
});
