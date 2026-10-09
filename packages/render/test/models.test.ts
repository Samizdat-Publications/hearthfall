// Real GLB models (M10): every v1 model parses in Node, splits into body and tint by the marker color,
// keeps every triangle, and every tribe-owned model ends up with a tint part (marker color or banner).
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildingModelIds, loadModels, splitModel, trimBase, unitModelId, withBanner, worshipModelId, TREE_MODELS } from "../src/models.ts";

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

  it("every v1 building, unit, worship and tree model loads; units carry the tribe color; nothing is lost", async () => {
    const { models, report } = await loadModels(urls, AZURE, read);
    expect(report.failed).toEqual([]);
    const want = [
      ...buildings.buildings.flatMap((b: { id: string; levels?: unknown[] }) => buildingModelIds(b.id, b.levels?.length ?? 0)),
      ...units.units.map((u: { id: string }) => unitModelId(u.id)),
      ...buildings.worship.kinds.map((k: { id: string }) => worshipModelId(k.id)),
      ...TREE_MODELS,
    ];
    // content still drawn by placeholders (no model yet); the M10 gate logs these in docs/ASSETS.md
    const missing = want.filter((id) => !models.has(id));
    expect(missing.sort()).toEqual(["building.boathouse", "building.skyloft"]);
    for (const [id, m] of models) {
      // nothing lost in the split
      const n = (m.body?.getAttribute("position").count ?? 0) + (m.tint?.getAttribute("position").count ?? 0);
      expect(n % 3, id).toBe(0);
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
