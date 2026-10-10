// BACKLOG 42: terrain mesh units: dirty rect to chunk selection, wrap placement, faceColor bands, seam continuity.
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { Terrain } from "../../sim/src/terrain.ts";
import { basePack } from "../../sim/test/helpers.ts";
import { CHUNK, chunksTouched, faceColor, TerrainChunk, type TerrainPalette } from "../src/terrainMesh.ts";

const pal = (): TerrainPalette => {
  const s = basePack().files.style;
  const C = (k: string) => new THREE.Color(s.palette[k]);
  return {
    sand: C("sand"), sandWet: C("sand"), meadow: C("meadow"), moss: C("moss"), forest: C("forest"), rock: C("rock"), rockDark: C("rockDark"),
    snow: C("snow"), scar: C("scar"), water: C("water"), waterShallow: C("waterShallow"), foam: C("foam"), cliff: C("cliff"), cliffDark: C("cliffDark"),
    bands: { ...basePack().files.balance.terrain.bands },
    heightScale: 0.06,
    maxWalkSlope: 20,
  };
};
const dist = (a: THREE.Color, b: THREE.Color) => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
const SIZE = 128;
const N = SIZE / CHUNK;

/** A rolling heightmap with no flat runs so any seam mismatch shows. */
function rolling(): Terrain {
  const h = new Int16Array(SIZE * SIZE);
  for (let z = 0; z < SIZE; z++)
    for (let x = 0; x < SIZE; x++) h[z * SIZE + x] = 200 + Math.round(60 * Math.sin((x * 2 * Math.PI) / SIZE) + 40 * Math.cos((z * 4 * Math.PI) / SIZE) + ((x * 7 + z * 13) % 11));
  return new Terrain({ size: SIZE, seaLevel: 120, heightMax: 1023, drownDepth: 8, maxWalkSlope: 20, maxBuildSlope: 6 }, h);
}

describe("BACKLOG 42: dirty rects pick chunks", () => {
  it("an interior edit touches only its chunk, an edit on a chunk's last cell also touches the next", () => {
    expect([...chunksTouched([{ x: 5, y: 5, w: 3, h: 3 }], SIZE)]).toEqual([0]);
    // the rect's far vertex row and column (x 31 + 1 = 32) belong to the neighbors
    expect([...chunksTouched([{ x: 31, y: 0, w: 1, h: 1 }], SIZE)].sort()).toEqual([0, 1]);
    expect([...chunksTouched([{ x: 0, y: 31, w: 1, h: 1 }], SIZE)].sort()).toEqual([0, N]);
  });

  it("edits across the map edge wrap to the chunks on the other side", () => {
    const got = [...chunksTouched([{ x: SIZE - 2, y: SIZE - 2, w: 4, h: 4 }], SIZE)].sort((a, b) => a - b);
    expect(got).toEqual([0, N - 1, (N - 1) * N, N * N - 1]);
    expect([...chunksTouched([{ x: -3, y: 40, w: 2, h: 0 }], SIZE)]).toEqual([N + N - 1]);
  });

  it("no rects, no chunks", () => {
    expect(chunksTouched([], SIZE).size).toBe(0);
  });
});

describe("BACKLOG 42: wrap placement", () => {
  const mat = new THREE.MeshBasicMaterial();
  it("each chunk sits at the copy nearest the focus, so neighbors across the seam stay adjacent", () => {
    const last = new TerrainChunk(N - 1, 0, mat, mat);
    const first = new TerrainChunk(0, 0, mat, mat);
    for (const f of [0, 3, SIZE - 3]) {
      last.place(f, 0, SIZE);
      first.place(f, 0, SIZE);
      expect(first.mesh.position.x - last.mesh.position.x).toBe(CHUNK);
      expect(last.water.position.x).toBe(last.mesh.position.x);
      for (const c of [last, first]) expect(Math.abs(c.mesh.position.x + CHUNK / 2 - f)).toBeLessThanOrEqual(SIZE / 2);
    }
    last.place(0, 0, SIZE);
    expect(last.mesh.position.x).toBe(-CHUNK);
    last.place(SIZE / 2 + 10, 0, SIZE);
    expect(last.mesh.position.x).toBe(SIZE - CHUNK);
  });
});

describe("BACKLOG 42: faceColor bands", () => {
  const p = pal();
  const at = (h: number, span = 0, scar = 0) => faceColor(p, 120, h, h, h, scar, 3, new THREE.Color(), span);
  it("deep water, beach, meadow and rock bands climb in order", () => {
    const b = p.bands;
    expect(dist(at(20), p.water)).toBeLessThan(dist(at(20), p.meadow));
    expect(dist(at(b.shore - 5), p.sand)).toBeLessThan(dist(at(b.shore - 5), p.meadow));
    expect(dist(at(b.grass + 5), p.meadow)).toBeLessThan(dist(at(b.grass + 5), p.rock));
    expect(dist(at(b.rock + 5), p.rock)).toBeLessThan(dist(at(b.rock + 5), p.meadow));
  });

  it("steep faces turn to cliff and scars darken toward the scar color", () => {
    const h = p.bands.grass + 5;
    expect(dist(at(h, 40), p.cliff) + dist(at(h, 40), p.cliffDark)).toBeLessThan(dist(at(h), p.cliff) + dist(at(h), p.cliffDark));
    expect(dist(at(h, 0, 60), p.scar)).toBeLessThan(dist(at(h), p.scar));
  });

  it("is a pure function of its inputs", () => {
    expect(at(300).getHex()).toBe(at(300).getHex());
  });
});

describe("BACKLOG 42: seam continuity", () => {
  it("vertices on both sides of every chunk seam, the map wrap included, agree in height", () => {
    const t = rolling();
    const p = pal();
    const mat = new THREE.MeshBasicMaterial();
    const chunks = [];
    for (let cz = 0; cz < N; cz++) for (let cx = 0; cx < N; cx++) {
      const c = new TerrainChunk(cx, cz, mat, mat);
      c.build(t, p);
      chunks.push(c);
    }
    // local edge vertex heights per chunk: (side, along) -> y
    const edge = (c: TerrainChunk, side: "left" | "right" | "top" | "bottom") => {
      const pos = c.mesh.geometry.getAttribute("position").array as Float32Array;
      const m = new Map<number, number>();
      for (let i = 0; i < pos.length; i += 3) {
        const [x, y, z] = [pos[i], pos[i + 1], pos[i + 2]];
        if (side === "left" && x === 0) m.set(z, y);
        if (side === "right" && x === CHUNK) m.set(z, y);
        if (side === "top" && z === 0) m.set(x, y);
        if (side === "bottom" && z === CHUNK) m.set(x, y);
      }
      return m;
    };
    let checked = 0;
    for (let cz = 0; cz < N; cz++) for (let cx = 0; cx < N; cx++) {
      const c = chunks[cz * N + cx];
      const right = chunks[cz * N + ((cx + 1) % N)];
      const below = chunks[((cz + 1) % N) * N + cx];
      const a = edge(c, "right"), b = edge(right, "left");
      expect(a.size).toBe(CHUNK + 1);
      for (const [k, y] of a) { expect(b.get(k)).toBe(y); checked++; }
      const d = edge(c, "bottom"), e = edge(below, "top");
      for (const [k, y] of d) { expect(e.get(k)).toBe(y); checked++; }
    }
    expect(checked).toBe(N * N * 2 * (CHUNK + 1));
  });
});
