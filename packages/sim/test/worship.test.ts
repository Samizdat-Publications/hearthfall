// Worship objects (M9, DESIGN 10): prayer speed, decay, contests, rewards, sinking, persistence.
import { describe, expect, it } from "vitest";
import type { SiteSpec } from "@hearthfall/data";
import { CAT } from "../src/entities.ts";
import { TASK } from "../src/economy.ts";
import { World } from "../src/world.ts";
import { basePack, world } from "./helpers.ts";

const SITE = [32, 32] as const;

function camp(spec: SiteSpec, kind = "shrine", tribes = 2) {
  const w = world({ generator: "flat", size: 64, tribes });
  w.spawnBuilding("hearth", 0, 10, 10);
  w.spawnBuilding("hearth", 1, 54, 54);
  w.spawnUnit("shaper", 0, 12, 12);
  w.spawnUnit("shaper", 1, 52, 52);
  w.worship.addSite(kind, SITE[0], SITE[1], spec);
  return w;
}

/** n settlers of `tribe` standing next to the site, ordered to worship it */
function pray(w: World, tribe: number, n: number, site = "s"): number[] {
  const ids: number[] = [];
  for (let k = 0; k < n; k++) ids.push(w.spawnUnit("settler", tribe, SITE[0] - 2 + k * 0.6, SITE[1] + (tribe ? 1.5 : -1.5)));
  w.step([{ tick: w.tick, tribe, type: "worship", args: { units: ids, site } }]);
  expect(w.events.find((e) => e.type === "commandRejected")).toBeUndefined();
  return ids;
}

function runUntil(w: World, type: string, max: number): number {
  for (let k = 0; k < max; k++) {
    w.step();
    if (w.events.some((e) => e.type === type)) return w.tick;
  }
  return -1;
}

const prayTicks = (w: World) => w.worship.sites[0].prayTicks;

describe("worship sites", () => {
  it("a full prayer grants the shrine's reward, idles the worshippers and sinks the shrine", () => {
    const w = camp({ tag: "s", rewards: [{ type: "charges", spell: "veil", n: 2 }] });
    const veil = w.cfg.spellIndex.get("veil")!;
    expect(w.tribes[0].eco.unlocked[veil]).toBe(0);
    const ids = pray(w, 0, 4);
    const start = w.tick;
    const done = runUntil(w, "worshipComplete", prayTicks(w) * 2);
    expect(done).toBeGreaterThan(start + prayTicks(w) - 1);
    // walking in takes a few seconds, praying takes prayTicks at full count
    expect(done - start).toBeLessThan(prayTicks(w) + 8 * w.cfg.tickHz);
    expect(w.events).toContainEqual(expect.objectContaining({ type: "worshipComplete", tribe: 0, site: "s", kind: "shrine" }));
    expect(w.events).toContainEqual(expect.objectContaining({ type: "siteSank", site: "s" }));
    expect(w.tribes[0].eco.charges[veil]).toBe(2);
    for (const id of ids) expect(w.ents.task[w.ents.index(id)]).toBe(TASK.idle);
    expect(w.count((i) => w.ents.cat[i] === CAT.worship)).toBe(0);
    // a locked spell casts from its one-shot charges
    w.step([{ tick: w.tick, tribe: 0, type: "cast", args: { spell: "veil", target: [14, 14] } }]);
    expect(w.events.find((e) => e.type === "commandRejected")).toBeUndefined();
  });

  it("each missing worshipper multiplies prayer speed by missingWorshipperSpeedFactor", () => {
    const factor = basePack().files.buildings.worship.missingWorshipperSpeedFactor;
    const full = camp({ tag: "s", rewards: [] });
    pray(full, 0, 4);
    const half = camp({ tag: "s", rewards: [] });
    pray(half, 0, 2);
    for (let k = 0; k < 10 * full.cfg.tickHz; k++) {
      full.step();
      half.step();
    }
    const pf = full.worship.sites[0].progress[0];
    const ph = half.worship.sites[0].progress[0];
    expect(pf).toBeGreaterThan(0);
    // both groups arrive at about the same time; two missing worshippers is factor squared
    expect(ph / pf).toBeCloseTo(factor * factor, 1);
  });

  it("progress decays while nobody prays and a new order cancels the prayer", () => {
    const w = camp({ tag: "s", rewards: [] });
    const ids = pray(w, 0, 4);
    for (let k = 0; k < 15 * w.cfg.tickHz; k++) w.step();
    const before = w.worship.sites[0].progress[0];
    expect(before).toBeGreaterThan(0);
    w.step([{ tick: w.tick, tribe: 0, type: "move", args: { units: ids, to: [12, 20] } }]);
    for (const id of ids) expect(w.ents.task[w.ents.index(id)]).toBe(TASK.idle);
    for (let k = 0; k < 5 * w.cfg.tickHz; k++) w.step();
    expect(w.worship.sites[0].progress[0]).toBeLessThan(before);
  });

  it("in a contest the faster tribe wins and the loser's prayer stops", () => {
    const w = camp({ tag: "s", uses: 2, rewards: [{ type: "charges", spell: "bolt", n: 1 }] });
    pray(w, 0, 4);
    const slow = pray(w, 1, 2);
    runUntil(w, "worshipComplete", prayTicks(w) * 2);
    const ev = w.events.find((e) => e.type === "worshipComplete")!;
    expect(ev.tribe).toBe(0);
    expect(w.worship.sites[0].usesLeft).toBe(1);
    expect(w.worship.sites[0].progress).toEqual([0, 0]);
    for (const id of slow) expect(w.ents.task[w.ents.index(id)]).toBe(TASK.idle);
  });

  it("a reliquary grants a permanent unlock and stays as a spent landmark", () => {
    const w = camp({ tag: "s", worshippers: 2, prayerSeconds: 5, rewards: [{ type: "unlockBuilding", building: "fire_lodge" }, { type: "unlockSpell", spell: "ward" }] }, "reliquary");
    const lodge = w.cfg.buildingIndex.get("fire_lodge")!;
    expect(w.economy.buildingLock(0, lodge)).toMatch(/needs/);
    pray(w, 0, 2);
    expect(runUntil(w, "worshipComplete", 30 * w.cfg.tickHz)).toBeGreaterThan(0);
    expect(w.economy.buildingLock(0, lodge)).toBeNull();
    expect(w.economy.buildingLock(1, lodge)).toMatch(/needs/);
    expect(w.tribes[0].eco.unlocked[w.cfg.spellIndex.get("ward")!]).toBe(1);
    expect(w.count((i) => w.ents.cat[i] === CAT.worship)).toBe(1);
    w.step([{ tick: w.tick, tribe: 0, type: "worship", args: { units: "tribe0.settlers", site: "s" } }]);
    expect(w.events).toContainEqual(expect.objectContaining({ type: "commandRejected", reason: "this site has nothing left to give" }));
  });

  it("a totem listens only to the Shaper, and its spell reward lands in the same tick", () => {
    const w = camp({ tag: "s", rewards: [{ type: "spell", spell: "raise_land", at: [42, 42] }, { type: "spawn", unit: "wild", n: 3 }] }, "totem");
    // a strait to bridge: the ridge runs from the totem toward `at`
    const n = w.terrain.size;
    for (let y = 36; y <= 46; y++) for (let x = 36; x <= 46; x++) w.terrain.heights[x + y * n] = 100;
    pray(w, 0, 3);
    for (let k = 0; k < 20 * w.cfg.tickHz; k++) w.step();
    expect(w.worship.sites[0].progress[0]).toBe(0);
    const h0 = w.terrain.heightAt(38, 38);
    w.step([{ tick: w.tick, tribe: 0, type: "worship", args: { units: [w.tribes[0].shaper], site: "s" } }]);
    expect(runUntil(w, "worshipComplete", 30 * w.cfg.tickHz)).toBeGreaterThan(0);
    expect(w.terrain.heightAt(38, 38)).toBeGreaterThan(h0);
    expect(w.events).toContainEqual(expect.objectContaining({ type: "rewardSpawn", unit: "wild", n: 3 }));
    expect(() => w.snapshot()).not.toThrow();
  });

  it("buildings may not be planned on a worship site's prayer ring", () => {
    const w = camp({ tag: "s", rewards: [] });
    const dwelling = w.cfg.buildingIndex.get("dwelling")!;
    expect(w.economy.planBlocker(dwelling, SITE[0] + 2, SITE[1])).toBe("too close to a worship site");
    expect(w.economy.planBlocker(dwelling, SITE[0] + 12, SITE[1])).toBeNull();
  });

  it("snapshot and restore mid-prayer reproduce the same future, and sites change the hash", () => {
    const w = camp({ tag: "s", rewards: [{ type: "charges", spell: "bolt", n: 1 }] });
    const bare = world({ generator: "flat", size: 64, tribes: 2 });
    expect(w.hash().meta).not.toBe(bare.hash().meta);
    pray(w, 0, 3);
    for (let k = 0; k < 10 * w.cfg.tickHz; k++) w.step();
    const p = basePack();
    const r = World.restore({ pack: p.files, packHash: p.hash, seed: 1, map: { generator: "flat", size: 64, tribes: 2 } }, w.snapshot());
    expect(r.hash().all).toBe(w.hash().all);
    // three of four worshippers pray at half speed
    for (let k = 0; k < 2 * prayTicks(w); k++) {
      w.step();
      r.step();
    }
    expect(r.hash().all).toBe(w.hash().all);
    expect(r.eventCounts.get("worshipComplete")).toBe(1);
  });

  it("generated skirmish maps place Reliquaries on dry land equally far from each pair of Hearths (BACKLOG 1)", () => {
    for (const [generator, size, tribes, seed] of [["continents", 128, 2, 3], ["islands", 96, 2, 8], ["continents", 128, 4, 5]] as const) {
      const w = world({ generator, size, tribes }, seed);
      const n = w.terrain.size;
      const hearths = w.tribes.map((t) => w.ents.index(t.hearth));
      const sites = w.worship.sites;
      expect(sites.length, `${generator} ${tribes}`).toBeGreaterThan(0);
      expect(sites.length).toBeLessThanOrEqual(4);
      for (const s of sites) {
        const i = w.ents.index(s.ent);
        expect(w.terrain.drowns(w.ents.x[i], w.ents.y[i])).toBe(false);
        const d = hearths.map((h) => {
          const dx = Math.abs(w.ents.x[i] - w.ents.x[h]);
          const dy = Math.abs(w.ents.y[i] - w.ents.y[h]);
          return Math.hypot(Math.min(dx, n - dx), Math.min(dy, n - dy));
        });
        expect(Math.min(...d)).toBeGreaterThanOrEqual(12);
        if (tribes === 2) expect(Math.abs(d[0] - d[1])).toBeLessThan(2 * 10 * Math.SQRT2 + 1);
      }
      expect(sites[0].rewards.map((r) => (r.type === "unlockSpell" ? r.spell : "")).join()).toBe("veil,ward,beguile,whirlwind");
    }
    // handmade test maps (scenarios, levels) have no generated Hearths, so they never get skirmish sites
    expect(world({ generator: "flat", size: 64, tribes: 2 }).worship.sites.length).toBe(0);
  });
});
