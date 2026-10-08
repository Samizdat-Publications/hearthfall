// Data guard: every data pack file parses and validates against its zod schema, cross references resolve.
import { loadBasePack } from "../harness/datapack.mjs";
import { isMain, report } from "./lib.mjs";

export function run() {
  const res = loadBasePack();
  const issues = res.issues.map((i) => ({ file: i.file.startsWith("data/") ? i.file : `data/base/${i.file}`, line: 0, msg: `${i.path || "(root)"}: ${i.message}` }));
  return { name: "data", issues, hash: res.pack?.hash };
}

if (isMain(import.meta.url)) process.exitCode = report(run());
