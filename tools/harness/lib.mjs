// Harness plumbing: short console output with a final RESULT line, full logs in reports/latest/,
// child processes with hard timeouts (never left running).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { ROOT } from "../guards/lib.mjs";

export { ROOT };
export const LATEST = ROOT + "reports/latest/";
mkdirSync(LATEST, { recursive: true });

export function writeReport(name, data) {
  writeFileSync(LATEST + name, typeof data === "string" ? data : JSON.stringify(data, null, 2) + "\n");
  return `reports/latest/${name}`;
}

export function readJson(path, fallback = undefined) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

/** Machine-local environment facts recorded by the doctor (screenshot mode, renderer string). */
export const ENV_FILE = ROOT + "reports/doctor-env.json";
export function doctorEnv() {
  return readJson(ENV_FILE, null);
}

/**
 * Run `node <args>` with a timeout; output goes to reports/latest/<log>. Returns {code, out, timedOut}.
 */
export function runNode(args, { timeoutMs = 120000, log, env } = {}) {
  const r = spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: "utf8",
    timeout: timeoutMs,
    killSignal: "SIGKILL",
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", ...env },
    windowsHide: true,
  });
  const out = (r.stdout ?? "") + (r.stderr ?? "");
  if (log) writeReport(log, out);
  const timedOut = r.error?.code === "ETIMEDOUT" || r.signal === "SIGKILL";
  return { code: timedOut ? 124 : (r.status ?? 1), out, timedOut };
}

export function gitSha() {
  const r = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8", windowsHide: true });
  const dirty = spawnSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8", windowsHide: true });
  const sha = r.status === 0 ? r.stdout.trim() : "nogit";
  return { sha, dirty: dirty.status === 0 && dirty.stdout.trim().length > 0 };
}

/** Collects short lines; prints at most `max` of them, then the RESULT line. Returns the exit code. */
export class Out {
  constructor(max = 14) {
    this.max = max;
    this.lines = [];
  }
  line(s) {
    this.lines.push(s);
  }
  finish(status, detail = "") {
    const shown = this.lines.slice(0, this.max);
    for (const l of shown) console.log(l);
    if (this.lines.length > shown.length) console.log(`... ${this.lines.length - shown.length} more lines in reports/latest/`);
    console.log(`RESULT: ${status}${detail ? " " + detail : ""}`);
    return status === "FAIL" ? 1 : 0;
  }
}

export function fileExists(p) {
  return existsSync(ROOT + p);
}

/** Parse `--key value` and `--flag` pairs. */
export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) out[k] = true;
      else {
        out[k] = v;
        i++;
      }
    } else out._.push(a);
  }
  return out;
}
