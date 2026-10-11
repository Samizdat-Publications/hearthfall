// Stretch 3 (living world): wild beast dens. A den holds a pack of beast units (tribe -1, units.json
// `beast`) that bite any tribe's unit within aggroRadius while they stay within leashRadius of the den,
// and walk home when the prey leaves. A den with a living member regrows a lost one every respawnSeconds;
// a den whose last member dies is cleared for good (event denCleared). Tribes fight back through combat
// (beasts are valid targets for every fighter but Chanters). Step 9c, after living. Dens come from level
// setup (a beast unit with tribe -1 spawns a den of `count`) or, on skirmish maps, from WorldInit.wolfDens.
// No dens: nothing in the hash or snapshot, so older replays keep their hashes.
import { secondsToTicks } from "./config.ts";
import { cos, sin, TWO_PI } from "./dmath.ts";
import { CAT, NO_ENTITY } from "./entities.ts";
import type { Fnv } from "./hash.ts";
import { wrap, wrapDelta } from "./terrain.ts";
import { ORDER } from "./units.ts";
import type { World } from "./world.ts";

export interface Den {
  /** beast unit kind */
  kind: string;
  x: number;
  y: number;
  size: number;
  /** member entity ids (dead ones drop out) */
  members: number[];
  /** tick the next lost member regrows, -1 when the pack is whole */
  next: number;
  cleared: boolean;
}

export interface BeastState {
  dens: Den[];
}

const hashi = (i: number, salt: number) => {
  let h = Math.imul(i ^ salt, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
};

export class BeastSystem {
  dens: Den[] = [];
  private w: World;
  private readonly beast: boolean[];

  constructor(w: World) {
    this.w = w;
    this.beast = w.cfg.pack.units.units.map((u) => !!u.beast);
  }

  /** is this unit type a beast? */
  isBeast(type: number): boolean {
    return this.beast[type] === true;
  }

  /** Make a den of `size` beasts of `kind` at (x, y), spawned in a small ring. */
  addDen(kind: string, x: number, y: number, size: number): number {
    const den: Den = { kind, x: wrap(x, this.w.terrain.size), y: wrap(y, this.w.terrain.size), size, members: [], next: -1, cleared: false };
    this.dens.push(den);
    for (let k = 0; k < size; k++) this.spawnMember(den, k);
    return this.dens.length - 1;
  }

  private spawnMember(den: Den, k: number): void {
    const a = k * 2.399963;
    const r = 0.8 + 0.35 * k;
    const id = this.w.spawnUnit(den.kind, -1, den.x + cos(a) * r, den.y + sin(a) * r);
    den.members.push(id);
  }

  /** Could beast i bite unit j (alive, a tribe's, outside, not hidden, on the ground)? */
  private prey(j: number): boolean {
    const w = this.w;
    const E = w.ents;
    return j >= 0 && !!E.alive[j] && E.cat[j] === CAT.unit && E.tribe[j] >= 0 && E.inside[j] < 0 && E.veil[j] === 0 && !w.vehicles.isVehicle(j);
  }

  private distTo(i: number, x: number, y: number): number {
    const E = this.w.ents;
    const n = this.w.terrain.size;
    const dx = wrapDelta(x - E.x[i], n);
    const dy = wrapDelta(y - E.y[i], n);
    return Math.sqrt(dx * dx + dy * dy);
  }

  /** Step 9c: regrow, then hunt, bite or go home. */
  update(): void {
    if (!this.dens.length) return;
    const w = this.w;
    const E = w.ents;
    const hz = w.cfg.tickHz;
    const cfg = w.cfg.pack.balance.beasts;
    const units = w.cfg.pack.units.units;
    const scanEvery = Math.max(1, secondsToTicks(0.5, hz));
    this.dens.forEach((den, d) => {
      if (den.cleared) return;
      den.members = den.members.filter((id) => E.index(id) >= 0);
      if (!den.members.length) {
        den.cleared = true;
        w.emit("denCleared", { den: d, x: den.x, y: den.y, kind: den.kind });
        return;
      }
      if (den.members.length < den.size) {
        if (den.next < 0) den.next = w.tick + secondsToTicks(cfg?.respawnSeconds ?? 75, hz);
        if (w.tick >= den.next) {
          this.spawnMember(den, den.members.length);
          den.next = den.members.length < den.size ? w.tick + secondsToTicks(cfg?.respawnSeconds ?? 75, hz) : -1;
        }
      } else den.next = -1;
      for (const id of den.members) {
        const i = E.index(id);
        const def = units[E.type[i]];
        const b = def.beast;
        if (!b || E.trance[i] > 0) continue;
        let t = E.atk[i] === NO_ENTITY ? -1 : E.index(E.atk[i]);
        // a target that left the den's ground (or died, hid, boarded) is dropped
        if (t >= 0 && (!this.prey(t) || this.distTo(t, den.x, den.y) > b.leashRadius)) t = -1;
        if (t < 0 && (w.tick + i) % scanEvery === 0) {
          let best = -1;
          let bestD = b.aggroRadius;
          for (let j = 0; j < E.hi; j++) {
            if (!this.prey(j)) continue;
            const dj = this.distTo(i, E.x[j], E.y[j]);
            if (dj > bestD || (dj === bestD && best >= 0) || this.distTo(j, den.x, den.y) > b.leashRadius) continue;
            best = j;
            bestD = dj;
          }
          if (best >= 0) {
            t = best;
            if (E.atk[i] === NO_ENTITY && den.members.every((m) => E.atk[E.index(m)] === NO_ENTITY)) w.emit("beastHowl", { den: d, x: E.x[i], y: E.y[i], kind: den.kind });
          }
        }
        if (t >= 0) {
          E.atk[i] = E.idOf(t);
          const dt = this.distTo(i, E.x[t], E.y[t]);
          if (dt <= (def.melee?.range ?? 0.9) + 0.3) {
            if (E.order[i] !== ORDER.none) w.units.stop(i);
            if (E.cd[i] === 0 && def.melee) {
              w.damage(t, def.melee.dps * b.biteSeconds, -1, false, true);
              E.cd[i] = Math.max(1, secondsToTicks(b.biteSeconds, hz));
              w.emit("beastBite", { x: E.x[i], y: E.y[i], tx: E.x[t], ty: E.y[t], tribe: E.tribe[t] });
            }
          } else w.units.steer(i, E.x[t], E.y[t]);
          continue;
        }
        if (E.atk[i] !== NO_ENTITY) {
          E.atk[i] = NO_ENTITY;
          w.units.stop(i);
        }
        if (E.order[i] !== ORDER.none) continue;
        // home: walk back when strayed, else roam the den now and then
        const roam = cfg?.roamRadius ?? 3;
        if (this.distTo(i, den.x, den.y) > roam + 1) w.units.order([i], den.x, den.y);
        else if ((w.tick + i * 7) % (4 * hz) === 0) {
          const a = hashi(w.tick + i, 0x3b) * TWO_PI;
          const r = hashi(w.tick + i, 0x3c) * roam;
          const x = wrap(den.x + cos(a) * r, w.terrain.size);
          const y = wrap(den.y + sin(a) * r, w.terrain.size);
          if (w.terrain.walkable(Math.round(x), Math.round(y))) w.units.order([i], x, y);
        }
      }
    });
  }

  // ---------------------------------------------------------------- skirmish dens
  /** Scatter up to `count` dens (balance.beasts) on dry walkable land, clear of Hearths, sites and each other. */
  placeDens(hearths: readonly { x: number; y: number }[], count: number): void {
    const w = this.w;
    const cfg = w.cfg.pack.balance.beasts;
    if (!cfg || count <= 0) return;
    const n = w.terrain.size;
    const max = Math.min(count, Math.floor((n * n) / cfg.cellsPerDen));
    const far = (p: { x: number; y: number }, q: { x: number; y: number }, d: number) => {
      const dx = wrapDelta(p.x - q.x, n);
      const dy = wrapDelta(p.y - q.y, n);
      return dx * dx + dy * dy >= d * d;
    };
    const sites = w.worship.sites.map((s) => {
      const i = w.ents.index(s.ent);
      return { x: w.ents.x[i], y: w.ents.y[i] };
    });
    const placed: { x: number; y: number }[] = [];
    const off = ((w.seed >>> 0) % 991) + 487;
    for (let k = 0; k < max * 64 && placed.length < max; k++) {
      const m = k + off;
      // the same R2 lattice as ley stones, shifted, so dens and stones do not share points
      const fx = (0.25 + m * 0.7548776662466927) % 1;
      const fy = (0.75 + m * 0.5698402909980532) % 1;
      const p = { x: Math.floor(fx * n), y: Math.floor(fy * n) };
      if (!w.worship.dryRing(p.x, p.y)) continue;
      if (!hearths.every((h) => far(p, h, cfg.minHearthDistance))) continue;
      if (!placed.every((q) => far(p, q, cfg.minSpacing)) || !sites.every((q) => far(p, q, 8))) continue;
      placed.push(p);
    }
    for (const p of placed) this.addDen(cfg.kind, p.x, p.y, cfg.packSize);
  }

  // ---------------------------------------------------------------- hash and snapshot
  hashInto(f: Fnv): void {
    if (!this.dens.length) return;
    f.u32(0xbea5).u32(this.dens.length);
    for (const d of this.dens) {
      f.f64(d.x).f64(d.y).u32(d.size).u32(d.next + 1).u32(d.cleared ? 1 : 0).u32(d.members.length);
      for (const m of d.members) f.u32(m);
    }
  }

  save(): BeastState | null {
    return this.dens.length ? { dens: this.dens.map((d) => ({ ...d, members: d.members.slice() })) } : null;
  }

  load(st: BeastState): void {
    this.dens = st.dens.map((d) => ({ ...d, members: d.members.slice() }));
  }
}
