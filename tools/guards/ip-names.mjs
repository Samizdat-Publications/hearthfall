// Original-IP guard: Hearthfall never uses the inspiring game's title, tribe, unit, building, spell
// or level names (CLAUDE.md, docs/DESIGN.md section 2). Scans code, data, tools, scenarios and assets.
// docs/ is human-written design reference and may cite the research file; it is not scanned.
import { isMain, lineOf, read, rel, report, walk } from "./lib.mjs";

// Distinctive names only; generic English words that our own design uses (lightning, flatten,
// erode, volcano, convert) are deliberately absent.
const BANNED = [
  "populous", "bullfrog productions", "dakini", "chumara", "matak", "shaman", "braves", "firewarrior", "fire warrior",
  "preacher", "landbridge", "hypnoti[sz]e", "angel of death", "armageddon", "magical shield", "firestorm",
  "insect plague", "bloodlust", "ghost army", "stone head", "vault of knowledge", "reincarnation site",
  "warrior training", "boat hut", "balloon hut", "guard tower", "spy training", "undiscovered worlds",
  "the journey begins", "night falls", "crisis of faith", "combined forces", "death from above", "building bridges",
  "unseen enemy", "continental divide", "fire in the mist", "from the depths", "treacherous souls", "an easy target",
  "aerial bombardment", "attacked from all sides", "incarcerated", "middle ground", "head hunter", "unlikely allies",
  "fractured earth", "journey's end",
];
const RE = new RegExp(`\\b(${BANNED.join("|")})\\b`, "gi");
const SELF = "tools/guards/ip-names.mjs";

export function run() {
  const issues = [];
  const files = walk(["packages", "apps", "data", "tools", "scenarios", "replays", "assets", "index.html"], [".ts", ".tsx", ".mjs", ".js", ".json", ".html", ".css", ".py", ".md", ".txt"]);
  for (const abs of files) {
    const file = rel(abs);
    if (file === SELF) continue;
    const src = read(abs);
    for (const m of src.matchAll(RE)) issues.push({ file, line: lineOf(src, m.index), msg: `original-IP name "${m[1]}" (use our names, DESIGN section 2)` });
  }
  return { name: "ip-names", issues, files: files.length };
}

if (isMain(import.meta.url)) process.exitCode = report(run());
