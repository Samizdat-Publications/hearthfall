// QoL part 2: under attack alerts (hits, the per place throttle, minimap pings), spell refusal reasons
// (kept in step with the sim's own cast validation), spell tooltips and idle troop groups.
import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { setStrings } from "@hearthfall/ui";
import { validateUi } from "@hearthfall/data";
import { world } from "../../../packages/sim/test/helpers.ts";
import { loadBasePack } from "../../../tools/harness/datapack.mjs";
import {
  ALERT_DEFAULTS,
  AlertThrottle,
  alertCfg,
  alertText,
  castBlock,
  castBlockText,
  castFailedText,
  castHint,
  hostileHits,
  idleGroups,
  idleTroops,
  nextIdleGroup,
  pingRing,
  rejectBlock,
  spellTip,
  spellTooltip,
  type Hit,
} from "../src/alerts.ts";

const root = new URL("../../../", import.meta.url);
const en = JSON.parse(readFileSync(new URL("data/strings/en.json", root), "utf8")) as Record<string, string>;
const spellsJson = JSON.parse(readFileSync(new URL("data/base/spells.json", root), "utf8")) as { spells: { id: string; range: number }[] };
/** the two long dashes, built from their code points so this file has none */
const DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);

beforeAll(() => setStrings(en));

function arena() {
  const w = world({ generator: "flat", size: 64, tribes: 2 });
  w.spawnBuilding("hearth", 0, 8, 8);
  w.spawnBuilding("hearth", 1, 44, 44);
  w.spawnUnit("shaper", 0, 12, 12);
  w.spawnUnit("shaper", 1, 48, 48);
  // followers keep a tribe alive while its Shaper is down
  w.spawnUnit("settler", 0, 6, 12);
  w.spawnUnit("settler", 1, 42, 48);
  for (let k = 0; k < 3; k++) w.step([]);
  return w;
}

/** hit entity index `i` for `amount` from `from`, then run the tick so hostileHits sees it */
function hitAndStep(w: ReturnType<typeof arena>, hits: [number, number][]) {
  for (const [i, from] of hits) w.damage(i, 5, from, false);
  w.step([]);
}

describe("under attack alerts (QoL 2)", () => {
  it("data/ui.json alerts validate, and missing or bad values fall back to the defaults", () => {
    const pack = loadBasePack();
    const ui = JSON.parse(readFileSync(new URL("data/ui.json", root), "utf8"));
    const res = validateUi(ui, pack.pack!.files);
    expect(res.issues).toEqual([]);
    expect(alertCfg(res.file!.alerts)).toEqual({ seconds: 15, radius: 14, pingSeconds: 4, idleGroupRadius: 8 });
    expect(alertCfg(undefined)).toEqual(ALERT_DEFAULTS);
    expect(alertCfg({ seconds: 0, radius: -1 })).toEqual(ALERT_DEFAULTS);
  });

  it("finds own units and buildings an enemy hit this tick, the Hearth and the Shaper first, not own or allied fire", () => {
    const w = arena();
    const E = w.ents;
    const warden = E.index(w.spawnUnit("warden", 0, 20, 20));
    const lodge = E.index(w.spawnBuilding("warden_lodge", 0, 24, 24));
    const hearth = E.index(w.tribes[0].hearth);
    const shaper = E.index(w.tribes[0].shaper);
    w.step([]);
    expect(hostileHits(w, 0)).toEqual([]);
    hitAndStep(w, [[warden, 1], [lodge, 1], [hearth, 1], [shaper, 1]]);
    expect(hostileHits(w, 0).map((h) => h.kind)).toEqual(["hearth", "shaper", "building", "units"]);
    expect(hostileHits(w, 1)).toEqual([]);
    // the next tick has no fresh hits
    w.step([]);
    expect(hostileHits(w, 0)).toEqual([]);
    // the tribe's own fire is not an attack; a hit with no tribe (wolves, a neutral hazard) is
    const w2 = arena();
    const u = w2.ents.index(w2.spawnUnit("warden", 0, 20, 20));
    w2.step([]);
    hitAndStep(w2, [[u, 0]]);
    expect(hostileHits(w2, 0)).toEqual([]);
    const v = w2.ents.index(w2.spawnUnit("warden", 0, 30, 30));
    w2.step([]);
    hitAndStep(w2, [[v, -1]]);
    expect(hostileHits(w2, 0)).toEqual([{ kind: "units", x: w2.ents.x[v], y: w2.ents.y[v] }]);
  });

  it("throttles to one alert per place every 15 s; the Hearth and the Shaper have their own slots", () => {
    const hz = 20;
    const th = new AlertThrottle(ALERT_DEFAULTS, 128, hz);
    const at = (kind: Hit["kind"], x: number, y: number): Hit => ({ kind, x, y });
    expect(th.offer([at("units", 10, 10)], 100).length).toBe(1);
    // same place (within 14 cells), a building this time, 5 s later: quiet
    expect(th.offer([at("building", 18, 14)], 200)).toEqual([]);
    // across the map wrap counts as near too
    const th2 = new AlertThrottle(ALERT_DEFAULTS, 128, hz);
    th2.offer([at("units", 1, 64)], 0);
    expect(th2.offer([at("units", 126, 64)], 10)).toEqual([]);
    // another place speaks at once
    expect(th.offer([at("units", 60, 60)], 200).map((a) => a.x)).toEqual([60]);
    // the Hearth and the Shaper next to that place still get their own note, once
    expect(th.offer([at("hearth", 11, 11), at("shaper", 12, 12)], 210).map((a) => a.kind)).toEqual(["hearth", "shaper"]);
    expect(th.offer([at("hearth", 11, 11), at("shaper", 40, 40)], 220)).toEqual([]);
    // several hits in one place in one tick make one alert
    expect(th.offer([at("units", 90, 90), at("units", 91, 90), at("units", 92, 91)], 230).length).toBe(1);
    // 15 s after the first alert the place speaks again
    expect(th.offer([at("units", 10, 10)], 100 + 15 * hz - 1)).toEqual([]);
    expect(th.offer([at("units", 10, 10)], 100 + 15 * hz).length).toBe(1);
    th.clear();
    expect(th.recent).toEqual([]);
  });

  it("alert notes are plain words, and minimap pings pulse and fade out", () => {
    for (const k of ["hearth", "shaper", "building", "units"] as const) {
      expect(alertText(k)).toMatch(/under attack!$/);
      expect(alertText(k)).not.toMatch(DASHES);
    }
    expect(alertText("hearth")).toContain("Hearth");
    expect(alertText("shaper")).toContain("Shaper");
    const hz = 20;
    const life = 4 * hz;
    const a = pingRing(0, life, hz)!;
    const b = pingRing(10, life, hz)!;
    expect(b.r).toBeGreaterThan(a.r);
    // a second later the ring starts small again, fainter
    const c = pingRing(hz, life, hz)!;
    expect(c.r).toBe(a.r);
    expect(c.alpha).toBeLessThan(a.alpha);
    expect(pingRing(life, life, hz)).toBeNull();
    expect(pingRing(-1, life, hz)).toBeNull();
  });
});

describe("spell refusal reasons (QoL 2)", () => {
  const cast = (w: ReturnType<typeof arena>, spell: string, x = 14, y = 14) => {
    w.step([{ tick: w.tick, tribe: 0, type: "cast", args: { spell, target: [x, y] } }]);
    return w.events.filter((e) => e.type === "commandRejected").map((e) => String(e.reason));
  };

  it("castBlock agrees with the sim's own cast validation, reason by reason", () => {
    const w = arena();
    const eco = w.tribes[0].eco;
    const bolt = w.cfg.spellIndex.get("bolt")!;
    const volcano = w.cfg.spellIndex.get("volcano")!;
    eco.unlocked[bolt] = 1;
    eco.charges[bolt] = 0;
    eco.unlocked[volcano] = 0;
    eco.charges[volcano] = 0;
    // locked
    expect(castBlock(w, 0, "volcano")).toBe("locked");
    expect(cast(w, "volcano").map(rejectBlock)).toEqual(["locked"]);
    // no charge
    expect(castBlock(w, 0, "bolt")).toBe("noCharge");
    expect(cast(w, "bolt").map(rejectBlock)).toEqual(["noCharge"]);
    // with charges the cast goes ahead; while it resolves the Shaper is busy
    eco.charges[bolt] = 2;
    expect(castBlock(w, 0, "bolt")).toBeNull();
    expect(cast(w, "bolt")).toEqual([]);
    expect(w.tribes[0].casting).not.toBeNull();
    expect(castBlock(w, 0, "bolt")).toBe("busy");
    expect(cast(w, "bolt").map(rejectBlock)).toEqual(["busy"]);
    // dead Shaper
    for (let k = 0; k < 60 && w.tribes[0].casting; k++) w.step([]);
    w.kill(w.ents.index(w.tribes[0].shaper), "killed");
    w.step([]);
    expect(castBlock(w, 0, "bolt")).toBe("dead");
    expect(cast(w, "bolt").map(rejectBlock)).toEqual(["dead"]);
    // a reason with no plain words maps to null (shown as "could not be cast: <reason>")
    expect(rejectBlock("cast needs target: [x, y]")).toBeNull();
    // no living tribe: nothing to say
    expect(castBlock(w, 5, "bolt")).toBeNull();
  });

  it("the reasons read as plain words that say what to do", () => {
    expect(castBlockText("noCharge", "raise_land", 650, -1)).toBe("No Raise Land charge yet. Praying followers fill it: 650 mana a charge.");
    expect(castBlockText("locked", "volcano", 8000, -1)).toContain("Volcano");
    expect(castBlockText("busy", "bolt", 100, -1)).toContain("busy");
    expect(castBlockText("dead", "bolt", 100, 12)).toContain("12 s");
    expect(castBlockText("dead", "bolt", 100, -1)).toContain("fallen");
    expect(castFailedText("bolt", "unreachable")).toMatch(/cannot reach.*Water or a cliff/);
    expect(castFailedText("bolt", "odd")).toBe("Bolt could not be cast: odd.");
    expect(castHint(null, true, true)).toBe("");
    expect(castHint(null, false, true)).toContain("out of range");
    expect(castHint(null, false, true)).toContain("walks closer");
    expect(castHint(null, true, false)).toContain("ground");
    expect(castHint("noCharge", false, true)).toBe("no charge yet");
    expect(castHint("dead", true, true)).toContain("dead");
    for (const s of [castBlockText("noCharge", "bolt", 1, 1), castFailedText("bolt", "unreachable"), castHint(null, false, true)]) expect(s).not.toMatch(DASHES);
  });
});

describe("spell tooltips (QoL 2)", () => {
  it("every spell in spells.json has a one line description in en.json", () => {
    for (const s of spellsJson.spells) {
      const tip = spellTip(s.id);
      expect(tip, s.id).not.toBe("");
      expect(tip, s.id).not.toContain("spellTip.");
      expect(tip, s.id).not.toMatch(DASHES);
      expect(tip.length, s.id).toBeLessThan(130);
    }
    expect(spellTip("not_a_spell")).toBe("");
  });

  it("the tooltip has the name, hotkey, description, cost and charges", () => {
    const tip = spellTooltip({ id: "bolt", name: "Bolt", hotkey: "Z", cost: 100, charges: 2, max: 4 });
    expect(tip).toBe(`Bolt (Z): ${spellTip("bolt")} 100 mana a charge, 2/4 charges. Click to cast, right click to toggle auto-charge.`);
    // a spell past the last hotkey, or one without a description, still reads cleanly
    expect(spellTooltip({ id: "deluge", name: "Deluge", hotkey: "", cost: 1, charges: 0, max: 2 })).toMatch(/^Deluge: A wave/);
    expect(spellTooltip({ id: "modded", name: "Modded", hotkey: "Q", cost: 5, charges: 0, max: 1 })).toMatch(/^Modded \(Q\): 5 mana/);
  });
});

describe("idle troops (QoL 2)", () => {
  it("finds troops standing about, groups the near ones and cycles through the groups", () => {
    const w = arena();
    const E = w.ents;
    const a = E.index(w.spawnUnit("warden", 0, 20, 20));
    const b = E.index(w.spawnUnit("firecaller", 0, 22, 21));
    const c = E.index(w.spawnUnit("warden", 0, 50, 10));
    // settlers and the Shaper are not troops; rival troops are not ours
    w.spawnUnit("settler", 0, 21, 21);
    w.spawnUnit("warden", 1, 52, 12);
    expect(idleTroops(w, 0)).toEqual([a, b, c]);
    const groups = idleGroups(w, idleTroops(w, 0), 8);
    expect(groups).toEqual([[a, b], [c]]);
    const id = (i: number) => E.idOf(i);
    const first = nextIdleGroup(groups, id, -1)!;
    expect(first.group).toEqual([a, b]);
    const second = nextIdleGroup(groups, id, first.id)!;
    expect(second.group).toEqual([c]);
    // and back to the first
    expect(nextIdleGroup(groups, id, second.id)!.group).toEqual([a, b]);
    expect(nextIdleGroup([], id, -1)).toBeNull();
    // a troop with a move order is busy
    w.step([{ tick: w.tick, tribe: 0, type: "move", args: { units: [E.idOf(c)], to: [56, 30] } }]);
    expect(w.events.filter((e) => e.type === "commandRejected")).toEqual([]);
    expect(idleTroops(w, 0)).toEqual([a, b]);
  });
});
