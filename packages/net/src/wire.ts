// Leg 5: the wire check for messages from a socket. Anything that is not a well formed NetMsg is dropped
// before it reaches the lockstep core (a command's own args are checked later by the sim's validate).
import type { NetMsg } from "./lockstep.ts";

const int = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
const MAX_CMDS = 64;

/** The message in `raw` (JSON text or an already parsed value), or null when it is malformed. */
export function parseNetMsg(raw: unknown): NetMsg | null {
  let v: unknown = raw;
  if (typeof raw === "string") {
    try {
      v = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== "object") return null;
  const m = v as Record<string, unknown>;
  if (!int(m.peer) || !int(m.tick)) return null;
  if (m.t === "hash") return typeof m.hash === "string" && m.hash.length <= 64 ? { t: "hash", peer: m.peer, tick: m.tick, hash: m.hash } : null;
  if (m.t !== "batch" || !Array.isArray(m.cmds) || m.cmds.length > MAX_CMDS) return null;
  const cmds: NetMsg & { t: "batch" } = { t: "batch", peer: m.peer, tick: m.tick, cmds: [] };
  for (const c of m.cmds as unknown[]) {
    if (!c || typeof c !== "object") return null;
    const r = c as Record<string, unknown>;
    if (typeof r.tribe !== "number" || !Number.isInteger(r.tribe) || typeof r.type !== "string" || !r.args || typeof r.args !== "object" || Array.isArray(r.args)) return null;
    cmds.cmds.push({ tick: m.tick, tribe: r.tribe, type: r.type, args: r.args as Record<string, unknown> });
  }
  return cmds;
}
