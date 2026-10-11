// Real GLB models (M10): every v1 model parses in Node, splits into body and tint by the marker color,
// keeps every triangle, and every tribe-owned model ends up with a tint part (marker color or banner).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { aliasModels, applyModelFixes, fixModel, type ModelFix, type ModelParts, buildingModelIds, loadModels, modelTriangles, sceneGeometry, splitModel, trimBase, unitModelId, withBanner, worshipModelId, TREE_MODELS } from "../src/models.ts";

const ROOT = new URL("../../../", import.meta.url);
const style = JSON.parse(readFileSync(new URL("data/base/style.json", ROOT), "utf8"));
const buildings = JSON.parse(readFileSync(new URL("data/base/buildings.json", ROOT), "utf8"));
const units = JSON.parse(readFileSync(new URL("data/base/units.json", ROOT), "utf8"));
const AZURE = style.palette.azure as string;
const files = readdirSync(new URL("assets/models/", ROOT)).filter((f) => f.endsWith(".glb") && !f.includes("bakeoff"));
const urls = Object.fromEntries(files.map((f) => [f.replace(/\.glb$/, ""), f]));
const read = async (f: string) => {
  const b = readFileSync(new URL("assets/models/" + f, ROOT));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

describe("models", () => {
  it("splitModel moves only all-marker triangles to the tint part, recolored white", () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1], 3));
    const az = new THREE.Color(AZURE);
    const wood = new THREE.Color(style.palette.wood);
    // triangle 0 all azure, triangle 1 mixed (stays body)
    const cols = [az, az, az, az, wood, az].flatMap((c) => [c.r, c.g, c.b]);
    g.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
    const p = splitModel(g, AZURE);
    expect(p.tint!.getAttribute("position").count).toBe(3);
    expect(p.body!.getAttribute("position").count).toBe(3);
    expect(p.tintShare).toBe(0.5);
    expect(Array.from(p.tint!.getAttribute("color").array)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1]);
    const banner = withBanner({ ...p, tint: null, tintShare: 0 }, wood);
    expect(banner.tint!.getAttribute("position").count).toBeGreaterThan(0);
  });

  it("a scene with several meshes merges them all, transforms baked in (BACKLOG 93)", () => {
    const scene = new THREE.Group();
    const a = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    const b = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    b.position.set(5, 0, 0);
    scene.add(a, b);
    const g = sceneGeometry(scene)!;
    expect(g.getAttribute("position").count).toBe(2 * 36);
    g.computeBoundingBox();
    expect(g.boundingBox!.max.x).toBeCloseTo(5.5, 5);
    expect(g.getAttribute("color").count).toBe(2 * 36);
  });

  it("every v1 building, unit, worship and tree model loads; units carry the tribe color; nothing is lost", async () => {
    const { models, report } = await loadModels(urls, AZURE, read);
    expect(report.failed).toEqual([]);
    const want = [
      ...buildings.buildings.flatMap((b: { id: string; levels?: unknown[] }) => buildingModelIds(b.id, b.levels?.length ?? 0)),
      ...units.units.map((u: { id: string }) => unitModelId(u.id)),
      ...buildings.worship.kinds.map((k: { id: string }) => worshipModelId(k.id)),
      ...TREE_MODELS,
    ];
    // every model is in since BACKLOG 10 (the vehicles); a new content id without a model fails here
    const missing = want.filter((id) => !models.has(id));
    expect(missing.sort()).toEqual([]);
    for (const [id, m] of models) {
      // nothing lost in the split: every triangle of every mesh in the file (BACKLOG 93)
      const n = (m.body?.getAttribute("position").count ?? 0) + (m.tint?.getAttribute("position").count ?? 0);
      expect(n, id).toBe((await modelTriangles(await read(urls[id]))) * 3);
      expect(m.size.y, id).toBeGreaterThan(0.4);
    }
    for (const u of ["shaper", "settler", "warden", "firecaller", "chanter"]) expect(models.get(unitModelId(u))!.tintShare, u).toBeGreaterThan(0.03);
    const wood = new THREE.Color(style.palette.wood);
    for (const b of buildings.buildings) {
      for (const id of buildingModelIds(b.id, b.levels?.length ?? 0)) {
        const m = models.get(id);
        if (m) expect(withBanner(m, wood).tint, id).not.toBeNull();
      }
    }
    // tree_b ships with a wide root disc; trimBase removes it and keeps the trunk and crown
    const tb = models.get("prop.tree_b")!;
    const before = tb.body!.getAttribute("position").count;
    const after = trimBase(tb.body!, tb.size.y, 0.2, 0.45).getAttribute("position").count;
    expect(after).toBeLessThan(before);
    expect(after).toBeGreaterThan(before * 0.6);
  });
});

describe("BACKLOG 14a-4 model alias", () => {
  it("points an id at the replacement file and drops the replacement id", () => {
    const urls = { "building.dwelling_small": "old.glb", "building.dwelling_small_v3": "new.glb", "unit.warden": "w.glb" };
    expect(aliasModels(urls, { "building.dwelling_small": "building.dwelling_small_v3" })).toEqual({ "building.dwelling_small": "new.glb", "unit.warden": "w.glb" });
    // a missing target keeps the original; no alias is a no-op
    expect(aliasModels(urls, { "unit.warden": "unit.warden_v9" })["unit.warden"]).toBe("w.glb");
    expect(aliasModels(urls, undefined)).toBe(urls);
  });

  it("every alias in style.json targets a model file that exists", () => {
    const alias: Record<string, string> = style.render.modelAlias ?? {};
    for (const to of Object.values(alias)) expect(existsSync(new URL(`assets/models/${to}.glb`, ROOT))).toBe(true);
  });
});

describe("L6-B model fixes", () => {
  const tri = (pos: number[], hex: string) => {
    const c = new THREE.Color(hex);
    return { pos, col: [c.r, c.g, c.b, c.r, c.g, c.b, c.r, c.g, c.b] };
  };
  const build = (tris: { pos: number[]; col: number[] }[], height: number): ModelParts => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(tris.flatMap((t) => t.pos), 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(tris.flatMap((t) => t.col), 3));
    return { body: g, tint: null, tintShare: 0, size: new THREE.Vector3(2, height, 2) };
  };
  const hexAt = (g: THREE.BufferGeometry, tri: number) => {
    const c = g.getAttribute("color");
    return new THREE.Color().setRGB(c.getX(tri * 3), c.getY(tri * 3), c.getZ(tri * 3), THREE.LinearSRGBColorSpace).getHexString(THREE.SRGBColorSpace);
  };

  it("recolor remaps only matching triangles above minY, leaving the source geometry untouched", () => {
    const roof = tri([0, 1.5, 0, 0.5, 1.5, 0, 0, 1.8, 0.5], "#B98058");
    const lowSkin = tri([0, 0.1, 0, 0.5, 0.1, 0, 0, 0.3, 0.5], "#B98058");
    const wood = tri([0, 1.5, 0, 0.5, 1.5, 0, 0, 1.8, 0.5], "#8B5A2B");
    const src = build([roof, lowSkin, wood], 2);
    const fixed = fixModel(src, { recolor: [{ from: "#B98058", to: "#DDB85E", minY: 0.3 }] });
    expect(hexAt(fixed.body!, 0).toLowerCase()).toBe("ddb85e");
    expect(hexAt(fixed.body!, 1).toLowerCase()).toBe("b98058");
    expect(hexAt(fixed.body!, 2).toLowerCase()).toBe("8b5a2b");
    expect(hexAt(src.body!, 0).toLowerCase()).toBe("b98058");
  });

  it("dropPlate removes low wide triangles and keeps the walls", () => {
    const plate = tri([0.9, 0, 0, 0, 0, 0.9, -0.9, 0.1, 0], "#5E3A1A");
    const wall = tri([0.5, 0, 0, 0, 0, 0.5, 0, 0.9, 0], "#E2B48C");
    const fixed = fixModel(build([plate, wall], 2), { dropPlate: { yFrac: 0.15, rMax: 0.8 } });
    expect(fixed.body!.getAttribute("position").count).toBe(3);
  });

  it("the small v3 hut ships fixed by style.json: golden roofs (no skin2 above 30 percent) and no wide plate triangles", async () => {
    const fix: Record<string, ModelFix> = style.render.modelFix;
    const { models } = await loadModels({ "building.dwelling_small": "building.dwelling_small_v3.glb" }, AZURE, read);
    const m = models.get("building.dwelling_small")!;
    const before = m.body!.getAttribute("position").count;
    applyModelFixes(models, fix);
    const g = models.get("building.dwelling_small")!.body!;
    expect(g.getAttribute("position").count).toBeLessThan(before);
    const p = g.getAttribute("position");
    const skin2 = new THREE.Color(style.palette.skin2).getHex(THREE.SRGBColorSpace);
    const c = g.getAttribute("color");
    const sc = new THREE.Color();
    let golden = 0;
    for (let t = 0; t < p.count / 3; t++) {
      const i = t * 3;
      const cy = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3;
      sc.setRGB(c.getX(i), c.getY(i), c.getZ(i), THREE.LinearSRGBColorSpace);
      const hex = sc.getHex(THREE.SRGBColorSpace);
      if (cy >= 0.3 * m.size.y) {
        expect(hex).not.toBe(skin2);
        if (hex === new THREE.Color(fix["building.dwelling_small"].recolor![0].to).getHex(THREE.SRGBColorSpace)) golden++;
      }
      let low = true;
      let wide = false;
      for (let v = 0; v < 3; v++) {
        if (p.getY(i + v) > m.size.y * 0.15) low = false;
        if (Math.hypot(p.getX(i + v), p.getZ(i + v)) > 0.8) wide = true;
      }
      expect(low && wide).toBe(false);
    }
    expect(golden).toBeGreaterThan(50);
  });

  it("every modelFix id in style.json names a model the game loads", () => {
    const alias: Record<string, string> = style.render.modelAlias ?? {};
    const ids = new Set([...Object.keys(urls), ...Object.keys(alias)]);
    for (const id of Object.keys(style.render.modelFix ?? {})) expect(ids.has(id), id).toBe(true);
  });
});
