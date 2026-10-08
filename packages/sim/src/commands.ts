// Commands: the only way players, AI, bots, replays and debug tools change the sim. Plain JSON:
// {tick, tribe, type, args}. Handlers live in a registry so new commands never touch a switch.
import type { TerrainOpSpec } from "./terrain.ts";
import { CAT } from "./entities.ts";
import { BSTATE } from "./economy.ts";
import type { World } from "./world.ts";

export interface Command {
  tick: number;
  tribe: number;
  type: string;
  args: Record<string, unknown>;
}

export interface CommandHandler {
  /** Return an error string to reject (logged as a commandRejected event), or null to accept. */
  validate(w: World, c: Command): string | null;
  apply(w: World, c: Command): void;
}

export const COMMANDS = new Map<string, CommandHandler>();

export function registerCommand(type: string, h: CommandHandler): void {
  COMMANDS.set(type, h);
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

const TERRAIN_OP_FIELDS: Record<string, string[]> = {
  raise: ["x", "y", "r", "amount"],
  lower: ["x", "y", "r", "amount"],
  set: ["x", "y", "r", "value"],
  flattenToAverage: ["x", "y", "r"],
  smooth: ["x", "y", "r", "strength"],
  crater: ["x", "y", "r", "height"],
  ridgeLine: ["x", "y", "x2", "y2", "width", "aboveSea"],
  noiseScar: ["x", "y", "r", "depth"],
  lowerTowardSea: ["x", "y", "r", "amount"],
  scar: ["x", "y", "r", "seconds"],
};

/** God-mode terrain edit (sandbox, scenarios, map editor). Spells queue ops through effects instead. */
registerCommand("terrainOp", {
  validate(w, c) {
    const op = c.args.op;
    if (typeof op !== "string" || !TERRAIN_OP_FIELDS[op]) return `unknown terrain op ${String(op)}`;
    for (const f of TERRAIN_OP_FIELDS[op]) if (!finite(c.args[f])) return `terrainOp ${op} needs numeric ${f}`;
    const half = w.terrain.size / 2 - 1;
    if (finite(c.args.r) && ((c.args.r as number) <= 0 || (c.args.r as number) >= half)) return "radius out of range";
    if (op === "ridgeLine" && ((c.args.width as number) <= 0 || (c.args.width as number) > 16)) return "ridge width out of range";
    if (op === "scar" && ((c.args.seconds as number) < 0 || (c.args.seconds as number) > 65535)) return "scar seconds out of range";
    if (c.tribe !== -1 && !w.godMode) return "terrainOp is god mode only (tribe -1 or sandbox)";
    return null;
  },
  apply(w, c) {
    const spec = { ...c.args } as unknown as TerrainOpSpec;
    if (spec.op === "noiseScar" && !finite((spec as { seed?: unknown }).seed)) (spec as { seed: number }).seed = w.rng.nextU32(0) | 0;
    if (spec.op === "crater" && (spec as { shape?: unknown }).shape !== "bowl") (spec as { shape: string }).shape = "cone";
    w.terrainQueue.push(spec);
  },
});

const isPoint = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && finite(v[0]) && finite(v[1]);

/** Move (or attack-move) units to a point. units: entity ids or a selector like "tribe0.settlers". */
registerCommand("move", {
  validate(w, c) {
    if (!isPoint(c.args.to)) return "move needs to: [x, y]";
    const idx = w.selectUnits(c.args.units);
    if (!idx.length) return "no units selected";
    if (c.tribe !== -1 && idx.some((i) => w.ents.tribe[i] !== c.tribe)) return "units belong to another tribe";
    return null;
  },
  apply(w, c) {
    const [x, y] = c.args.to as [number, number];
    const n = w.terrain.size;
    w.units.order(w.selectUnits(c.args.units), ((x % n) + n) % n, ((y % n) + n) % n, c.args.attack ? 2 : 1);
  },
});

/** God-mode displacement (knockback precursor, tests): units pushed into deep water drown. */
registerCommand("impulse", {
  validate(w, c) {
    if (c.tribe !== -1 && !w.godMode) return "impulse is god mode only";
    if (!isPoint(c.args.by)) return "impulse needs by: [dx, dy]";
    return w.selectUnits(c.args.units).length ? null : "no units selected";
  },
  apply(w, c) {
    const [dx, dy] = c.args.by as [number, number];
    const n = w.terrain.size;
    for (const i of w.selectUnits(c.args.units)) {
      w.ents.x[i] = (((w.ents.x[i] + dx) % n) + n) % n;
      w.ents.y[i] = (((w.ents.y[i] + dy) % n) + n) % n;
    }
  },
});

registerCommand("stop", {
  validate(w, c) {
    const idx = w.selectUnits(c.args.units);
    if (!idx.length) return "no units selected";
    if (c.tribe !== -1 && idx.some((i) => w.ents.tribe[i] !== c.tribe)) return "units belong to another tribe";
    return null;
  },
  apply(w, c) {
    for (const i of w.selectUnits(c.args.units)) w.units.stop(i);
  },
});

/** Place a building plan: args {building: id, at: [x, y]} (center of the footprint). */
registerCommand("placePlan", {
  validate(w, c) {
    if (c.tribe < 0) return "plans need a tribe";
    if (!isPoint(c.args.at)) return "placePlan needs at: [x, y]";
    const type = w.cfg.buildingIndex.get(String(c.args.building));
    if (type === undefined) return `unknown building ${String(c.args.building)}`;
    let open = 0;
    const E = w.ents;
    for (let i = 0; i < E.hi; i++) if (E.alive[i] && E.cat[i] === CAT.building && E.tribe[i] === c.tribe && E.state[i] !== BSTATE.done) open++;
    if (open >= w.cfg.pack.balance.economy.maxOpenPlansPerTribe) return "too many open plans";
    const [x, y] = c.args.at as [number, number];
    return w.economy.planBlocker(type, x, y);
  },
  apply(w, c) {
    const [x, y] = c.args.at as [number, number];
    w.economy.placePlan(c.tribe, w.cfg.buildingIndex.get(String(c.args.building))!, x, y);
  },
});

/** Cancel an unfinished plan of your own: args {id}. Delivered wood is lost. */
registerCommand("cancelPlan", {
  validate(w, c) {
    const i = w.ents.index(Number(c.args.id));
    if (i < 0 || w.ents.cat[i] !== CAT.building) return "no such plan";
    if (w.ents.tribe[i] !== c.tribe && c.tribe !== -1) return "not your plan";
    return w.ents.state[i] === BSTATE.done ? "already built" : null;
  },
  apply(w, c) {
    w.kill(w.ents.index(Number(c.args.id)), "planCancelled");
  },
});

/** Mana split slider: args {spellsPct: 0..100}. */
registerCommand("setSplit", {
  validate: (_w, c) => (c.tribe >= 0 && finite(c.args.spellsPct) && (c.args.spellsPct as number) >= 0 && (c.args.spellsPct as number) <= 100 ? null : "spellsPct 0..100 and a tribe"),
  apply(w, c) {
    w.tribes[c.tribe].eco.spellsPct = Math.round(c.args.spellsPct as number);
  },
});

/** Toggle auto-charge for a spell: args {spell: id, on: bool}. */
registerCommand("setAutoCharge", {
  validate(w, c) {
    const s = w.cfg.spellIndex.get(String(c.args.spell));
    if (c.tribe < 0 || s === undefined) return "unknown spell or no tribe";
    return w.tribes[c.tribe].eco.unlocked[s] ? null : "spell not unlocked";
  },
  apply(w, c) {
    w.tribes[c.tribe].eco.auto[w.cfg.spellIndex.get(String(c.args.spell))!] = c.args.on ? 1 : 0;
  },
});

/** Tribe-wide settler priorities: args {build, upgrade, breed} each 0..1. */
registerCommand("setPriorities", {
  validate: (_w, c) => (c.tribe >= 0 && ["build", "upgrade", "breed"].every((k) => finite(c.args[k]) && (c.args[k] as number) >= 0 && (c.args[k] as number) <= 1) ? null : "priorities 0..1 and a tribe"),
  apply(w, c) {
    const p = w.tribes[c.tribe].eco.priorities;
    p.build = c.args.build as number;
    p.upgrade = c.args.upgrade as number;
    p.breed = c.args.breed as number;
  },
});

registerCommand("noop", {
  validate: () => null,
  apply: () => {},
});
