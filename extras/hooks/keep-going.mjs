// Optional Stop hook: keeps an unattended Claude Code run going until it is done.
// Allows the stop when: a STOP file exists in the project root, the run sentinel is the first
// line under "## Now" in docs/PROGRESS.md, or the project showed no progress (same git HEAD,
// same working tree, same PROGRESS.md mtime) across 10 consecutive stop attempts.
// On unexpected errors it blocks; Claude Code's own consecutive-block cap ends a truly stuck loop.
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";

const SENTINEL = ["HEARTHFALL", "RUN", "DONE", "7Q"].join("-");
const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const allow = () => process.exit(0);
const block = (reason) => { process.stdout.write(JSON.stringify({ decision: "block", reason })); process.exit(0); };
const git = (args) => { try { return execSync("git " + args, { cwd: root, stdio: ["ignore", "pipe", "ignore"] }).toString(); } catch { return ""; } };

try {
  if (existsSync(join(root, "STOP"))) allow();
  const progressPath = join(root, "docs", "PROGRESS.md");
  const progress = readFileSync(progressPath, "utf8").replace(/\r\n/g, "\n");
  const nowSection = progress.split("\n## Now\n")[1] || "";
  const firstLine = (nowSection.split("\n").find((l) => l.trim() !== "") || "").replace(/^[-*]\s*/, "").trim();
  if (firstLine === SENTINEL) allow();

  const signature = createHash("sha1")
    .update(git("rev-parse HEAD"))
    .update(git("status --porcelain"))
    .update(String(statSync(progressPath).mtimeMs))
    .digest("hex");
  const stateDir = join(root, "reports");
  mkdirSync(stateDir, { recursive: true });
  const statePath = join(stateDir, ".keep-going.json");
  const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : { same: 0, signature: "" };
  state.same = state.signature === signature ? state.same + 1 : 0;
  state.signature = signature;
  if (state.same >= 10) { state.same = 0; writeFileSync(statePath, JSON.stringify(state)); allow(); }
  writeFileSync(statePath, JSON.stringify(state));
  block("The run is not done. Re-read docs/PROGRESS.md (Now, Next 3 actions) and continue with the next task. If the current milestone is fully blocked, log it under Blocked and take the next independent task or the next docs/BACKLOG.md item. Commit when green.");
} catch {
  block("Keep-going hook hit an error; continue working from docs/PROGRESS.md.");
}
