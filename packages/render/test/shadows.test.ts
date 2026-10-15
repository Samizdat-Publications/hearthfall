// S4 Look v4: contact shadows resolve from style.json and the tree layer lays one blob per tree and rock.
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { CAT, World } from "@hearthfall/sim";
import { basePack } from "../../sim/test/helpers.ts";
import { TreeLayer } from "../src/props.ts";
import { CONTACT_SHADOWS_DEFAULT, ContactShadows, resolveContactShadows } from "../src/shadows.ts";

describe("contact shadows", () => {
  const pack = basePack();
  const world = () => new World({ pack: pack.files, packHash: pack.hash, seed: 3, map: { generator: "continents", size: 96, tribes: 2 } });

  it("style.json turns them on; omitted means off", () => {
    expect(resolveContactShadows(undefined).enabled).toBe(false);
    const look = resolveContactShadows(pack.files.style.render!.contactShadows);
    expect(look.enabled).toBe(true);
    expect(look.strength).toBeGreaterThan(0);
    expect(look.skip).toContain("prop.reeds");
  });

  it("lays one blob per tree and rock, offset away from the sun, and honors the cap", () => {
    const w = world();
    const layer = new TreeLayer(new THREE.MeshBasicMaterial(), {}, null, 8192);
    const look = { ...CONTACT_SHADOWS_DEFAULT, enabled: true };
    layer.shadows = new ContactShadows(new THREE.MeshBasicMaterial(), 8192, look);
    layer.update(w, 48, 48, 1);
    let casters = 0;
    for (let i = 0; i < w.ents.hi; i++) if (w.ents.alive[i] && (w.ents.cat[i] === CAT.tree || w.ents.cat[i] === CAT.rock)) casters++;
    expect(casters).toBeGreaterThan(10);
    expect(layer.shadows.count()).toBe(casters);
    const small = new ContactShadows(new THREE.MeshBasicMaterial(), 5, look);
    small.begin();
    for (let k = 0; k < 9; k++) small.add(w.terrain, 10, 10, 10, 10, 1, 1, 2, 1);
    small.end();
    expect(small.count()).toBe(5);
    // the default sun sits at +x +z, so the blob center moves toward -x -z
    const m = new THREE.Matrix4();
    small.mesh.getMatrixAt(0, m);
    const p = new THREE.Vector3().setFromMatrixPosition(m);
    expect(p.x).toBeLessThan(10);
    expect(p.z).toBeLessThan(10);
  });

  it("draws nothing when disabled", () => {
    const off = new ContactShadows(new THREE.MeshBasicMaterial(), 16, CONTACT_SHADOWS_DEFAULT);
    off.begin();
    off.add(world().terrain, 10, 10, 10, 10, 1, 1, 2, 1);
    off.end();
    expect(off.count()).toBe(0);
  });
});
