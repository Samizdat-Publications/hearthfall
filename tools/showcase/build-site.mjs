// Landing page build (docs/SHOWCASE.md): copies site/ into site-dist/ and finishes it for Cloudflare Pages
// with the showcase kit (headers, byte-range routes for the clips, 25 MiB check).
//   node tools/showcase/build-site.mjs
// The game itself is not bundled: Play links to the Workers deployment (docs/DEPLOY.md).
import { cpSync, existsSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { ROOT } from "../harness/lib.mjs";

const KIT = "C:/Users/stewa/Documents/Claude/Github Hub/kit/tools/finish-site.mjs";
const out = ROOT + "site-dist";
rmSync(out, { recursive: true, force: true });
cpSync(ROOT + "site", out, { recursive: true });
if (existsSync(KIT)) execFileSync(process.execPath, [KIT, out, "--root", ROOT], { stdio: "inherit" });
else console.log("showcase kit not found: site-dist is not finished (no _headers or _routes.json)");
console.log("RESULT: PASS site-dist built");
