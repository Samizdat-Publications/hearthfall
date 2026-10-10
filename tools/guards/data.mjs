// Data guard: every data pack file parses and validates against its zod schema, cross references resolve.
import { listMods, loadAchievements, loadBasePack, loadLevels, loadUi } from "../harness/datapack.mjs";
import { isMain, report } from "./lib.mjs";

export function run() {
  const res = loadBasePack();
  const issues = res.issues.map((i) => ({ file: i.file.startsWith("data/") ? i.file : `data/base/${i.file}`, line: 0, msg: `${i.path || "(root)"}: ${i.message}` }));
  // M9: level files validate against the base pack
  if (res.pack) for (const i of loadLevels(res.pack.files).issues) issues.push({ file: i.file, line: 0, msg: `${i.path || "(root)"}: ${i.message}` });
  // BACKLOG 21: achievements validate against the base pack
  if (res.pack) for (const i of loadAchievements(res.pack.files).issues) issues.push({ file: i.file, line: 0, msg: `${i.path || "(root)"}: ${i.message}` });
  // BACKLOG 78: data/ui.json validates against the base pack
  if (res.pack) for (const i of loadUi(res.pack.files).issues) issues.push({ file: i.file, line: 0, msg: `${i.path || "(root)"}: ${i.message}` });
  // BACKLOG 18: every mod under mods/ validates on its own over the base pack (conflicts between mods
  // are a load-time report, `npm run mods`, not an error)
  for (const id of listMods()) for (const i of loadBasePack([id]).issues) issues.push({ file: i.file.startsWith("mods/") ? i.file : `mods/${id} (${i.file})`, line: 0, msg: `${i.path || "(root)"}: ${i.message}` });
  return { name: "data", issues, hash: res.pack?.hash, files: res.pack ? Object.keys(res.pack.files).length : 0 };
}

if (isMain(import.meta.url)) process.exitCode = report(run());
