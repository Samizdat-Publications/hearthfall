// Data guard: every data pack file parses and validates against its zod schema, cross references resolve.
import { loadAchievements, loadBasePack, loadLevels } from "../harness/datapack.mjs";
import { isMain, report } from "./lib.mjs";

export function run() {
  const res = loadBasePack();
  const issues = res.issues.map((i) => ({ file: i.file.startsWith("data/") ? i.file : `data/base/${i.file}`, line: 0, msg: `${i.path || "(root)"}: ${i.message}` }));
  // M9: level files validate against the base pack
  if (res.pack) for (const i of loadLevels(res.pack.files).issues) issues.push({ file: i.file, line: 0, msg: `${i.path || "(root)"}: ${i.message}` });
  // BACKLOG 21: achievements validate against the base pack
  if (res.pack) for (const i of loadAchievements(res.pack.files).issues) issues.push({ file: i.file, line: 0, msg: `${i.path || "(root)"}: ${i.message}` });
  return { name: "data", issues, hash: res.pack?.hash, files: res.pack ? Object.keys(res.pack.files).length : 0 };
}

if (isMain(import.meta.url)) process.exitCode = report(run());
