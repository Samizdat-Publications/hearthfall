// BACKLOG 5: procedural unit animation: sim state picks a clip, clips are pure poses, the unit layer
// writes a pose per instance and keeps a short toppling ghost for units that died.
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { TASK, World, type SimEvent } from "@hearthfall/sim";
import { basePack } from "../../sim/test/helpers.ts";
import { CLIP, deathPose, rigGeometry, unitClip, unitPose } from "../src/unitAnim.ts";
import { DEATH_SECONDS, UnitLayer } from "../src/unitsLayer.ts";

const make = () => {
  const pack = basePack();
  const w = new World({ pack: pack.files, packHash: pack.hash, seed: 3, map: { generator: "flat", size: 64, tribes: 2 } });
  const layer = new UnitLayer(new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial(), pack.files.units.units.map((u) => u.id), { azure: "#2e6fd8", crimson: "#d83a2e" }, ["azure", "crimson"]);
  return { w, layer };
};

describe("unit animation (BACKLOG 5)", () => {
  it("picks clips from sim state", () => {
    const { w } = make();
    const E = w.ents;
    const s = E.index(w.spawnUnit("settler", 0, 10, 10));
    expect(unitClip(w, s)).toBe(CLIP.idle);
    E.vx[s] = 0.1;
    expect(unitClip(w, s)).toBe(CLIP.walk);
    E.vx[s] = 0;
    E.task[s] = TASK.chop;
    expect(unitClip(w, s)).toBe(CLIP.work);
    E.task[s] = TASK.worship;
    expect(unitClip(w, s)).toBe(CLIP.pray);
    E.panic[s] = 5;
    expect(unitClip(w, s)).toBe(CLIP.panic);
    const f = E.index(w.spawnUnit("firecaller", 0, 12, 10));
    const foe = w.spawnUnit("warden", 1, 14, 10);
    E.atk[f] = foe;
    expect(unitClip(w, f)).toBe(CLIP.shoot);
    const wd = E.index(w.spawnUnit("warden", 0, 12, 12));
    E.atk[wd] = foe;
    expect(unitClip(w, wd)).toBe(CLIP.attack);
    const c = E.index(w.spawnUnit("chanter", 0, 12, 14));
    E.chant[c] = 10;
    expect(unitClip(w, c)).toBe(CLIP.cast);
  });

  it("poses stay in range and move over time; walking legs swing both ways", () => {
    let lo = 0;
    let hi = 0;
    for (const clip of Object.values(CLIP)) {
      for (let k = 0; k < 40; k++) {
        const p = unitPose(clip, k * 0.05, 3);
        for (const v of p) expect(Math.abs(v)).toBeLessThanOrEqual(1.0001);
        if (clip === CLIP.walk) {
          lo = Math.min(lo, p[0]);
          hi = Math.max(hi, p[0]);
        }
      }
    }
    expect(lo).toBeLessThan(-0.9);
    expect(hi).toBeGreaterThan(0.9);
    expect(unitPose(CLIP.work, 0.1, 1)).not.toEqual(unitPose(CLIP.work, 0.4, 1));
    expect(unitPose(CLIP.cast, 0, 0)[3]).toBeGreaterThan(0.6);
    // death: a killed unit ends nearly flat, a drowned one sinks upright
    expect(deathPose(DEATH_SECONDS, DEATH_SECONDS, false).tip).toBeGreaterThan(1.3);
    const dr = deathPose(DEATH_SECONDS, DEATH_SECONDS, true);
    expect(dr.tip).toBe(0);
    expect(dr.sink).toBeGreaterThan(0.9);
  });

  it("rigs geometry with the model height and sideways share", () => {
    const g = rigGeometry(new THREE.BoxGeometry(0.4, 1, 0.2).translate(0, 0.5, 0), 1.25);
    const r = g.getAttribute("aRig");
    expect(r.count).toBe(g.getAttribute("position").count);
    expect(r.getX(0)).toBeCloseTo(1.25);
    expect(Math.abs(r.getY(0))).toBeCloseTo(0.2 / 1.25);
  });

  it("writes a pose per drawn unit and topples a unit that died for a moment", () => {
    const { w, layer } = make();
    const E = w.ents;
    const s = E.index(w.spawnUnit("settler", 0, 10, 10));
    E.vx[s] = 0.1;
    const cam = new THREE.PerspectiveCamera();
    layer.update(w, 1, 10, 10, 1, 0.3, 1000, cam, 0, 100, 100, new Set());
    const settler = w.cfg.unitIndex.get("settler")!;
    const anim = (layer as unknown as { kinds: { body: THREE.InstancedMesh; anim: THREE.InstancedBufferAttribute }[] }).kinds[settler];
    expect(anim.body.count).toBe(1);
    expect(anim.anim.getX(0)).toBeCloseTo(unitPose(CLIP.walk, 0.3, s)[0]);
    // it dies: the next frames still draw it, toppling, until DEATH_SECONDS pass
    const id = E.idOf(s);
    w.kill(s, "killed");
    const ev = w.events.filter((e) => e.type === "killed") as SimEvent[];
    expect(ev.length).toBe(1);
    expect(Number(ev[0].id)).toBe(id);
    layer.consume(ev, () => 1);
    layer.update(w, 1, 10, 10, 1, 1.5, 1000, cam, 0, 100, 100, new Set());
    expect(anim.body.count).toBe(1);
    const m = new THREE.Matrix4();
    anim.body.getMatrixAt(0, m);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion().setFromRotationMatrix(m));
    expect(up.y).toBeLessThan(0.5);
    layer.update(w, 1, 10, 10, 1, 1 + DEATH_SECONDS + 0.1, 1000, cam, 0, 100, 100, new Set());
    expect(anim.body.count).toBe(0);
    expect(layer.ghosts.length).toBe(0);
  });
});
