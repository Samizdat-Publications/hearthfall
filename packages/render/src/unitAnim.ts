// BACKLOG 5 (ADR-012): procedural unit animation. Every unit mesh carries a per-vertex rig attribute
// (model height and sideways offset as a share of it) and every instance a pose (leg swing, torso pitch,
// right arm raise, both arms raise). The vertex shader bends the static mesh by region: legs below the
// hip swing in opposite phase, outer vertices between waist and shoulder are arms, everything above the
// waist pitches about it. The CPU picks a clip from sim state and evaluates its pose each frame, so
// clips are plain functions of (clip, time, unit) and never touch the sim. Render only: no determinism
// needed, but poses are pure so tests can check them.
import * as THREE from "three";
import { CAT, NO_ENTITY, TASK, type World } from "@hearthfall/sim";

export const CLIP = { idle: 0, walk: 1, work: 2, attack: 3, shoot: 4, cast: 5, pray: 6, panic: 7 } as const;
export type Pose = [leg: number, pitch: number, arm: number, arms: number];

/** The clip a unit plays now, from its sim state (movement, combat target, job, channel, status). */
export function unitClip(w: World, i: number): number {
  const E = w.ents;
  const def = w.cfg.pack.units.units[E.type[i]];
  const moving = E.vx[i] !== 0 || E.vy[i] !== 0;
  if (E.panic[i] > 0) return CLIP.panic;
  if (def.isCaster && E.tribe[i] >= 0) {
    const t = w.tribes[E.tribe[i]];
    if (t?.casting && t.shaper === E.idOf(i)) return CLIP.cast;
  }
  if (E.chant[i] > 0) return CLIP.cast;
  if (E.trance[i] > 0) return CLIP.pray;
  if (moving) return CLIP.walk;
  if (E.atk[i] !== NO_ENTITY && w.ents.index(E.atk[i]) >= 0) return def.ranged ? CLIP.shoot : CLIP.attack;
  const task = E.task[i];
  if (task === TASK.chop || task === TASK.mine || task === TASK.work) return CLIP.work;
  if (task === TASK.worship) return CLIP.pray;
  return CLIP.idle;
}

/** Pose of a clip at visual time t (seconds) for unit slot i (offsets the phase so crowds do not march in step). */
export function unitPose(clip: number, t: number, i: number, out: Pose = [0, 0, 0, 0]): Pose {
  const o = i * 1.7;
  out[0] = 0;
  out[1] = 0;
  out[2] = 0;
  out[3] = 0;
  switch (clip) {
    case CLIP.walk:
      out[0] = Math.sin(t * 9 + o);
      out[1] = 0.06;
      break;
    case CLIP.work: {
      // a chop: raise the tool, then a quick downward swing with a bow
      const s = Math.max(0, Math.sin(t * 5 + o));
      out[1] = 0.1 + 0.4 * s * s;
      out[2] = 0.8 * (1 - s);
      break;
    }
    case CLIP.attack: {
      const s = Math.max(0, Math.sin(t * 7 + o));
      out[1] = -0.08 + 0.55 * s * s * s;
      out[2] = 0.9 * (1 - s);
      break;
    }
    case CLIP.shoot:
      out[1] = 0.08;
      out[2] = 0.9 * Math.max(0, Math.sin(t * 4 + o));
      break;
    case CLIP.cast:
      out[1] = -0.12;
      out[3] = 0.85 + 0.15 * Math.sin(t * 6 + o);
      break;
    case CLIP.pray:
      out[1] = 0.45 + 0.15 * Math.sin(t * 1.5 + o);
      out[3] = 0.3;
      break;
    case CLIP.panic:
      out[0] = Math.sin(t * 14 + o);
      out[3] = 0.7 + 0.3 * Math.sin(t * 11 + o);
      break;
    default:
      // idle breathing
      out[1] = 0.025 * Math.sin(t * 1.8 + o);
  }
  return out;
}

/** Death ghost pose: tips backward over `dur` seconds (a drowned unit flails and sinks instead). */
export function deathPose(age: number, dur: number, drowned: boolean, out: Pose = [0, 0, 0, 0]): { tip: number; sink: number; pose: Pose } {
  const k = Math.min(1, Math.max(0, age / dur));
  out[0] = drowned ? Math.sin(age * 16) : 0;
  out[1] = 0;
  out[2] = 0;
  out[3] = drowned ? 1 : 0;
  const tip = drowned ? 0 : (Math.PI / 2) * Math.min(1, k * 2.2) * 0.92;
  const sink = drowned ? k * 1.1 : Math.max(0, k - 0.6) * 0.5;
  return { tip, sink, pose: out };
}

/** Add the rig attribute (model height, x as a share of it) that the anim shader reads. */
export function rigGeometry(g: THREE.BufferGeometry, height: number): THREE.BufferGeometry {
  const p = g.getAttribute("position");
  if (!p) return g;
  const h = Math.max(1e-3, height);
  const rig = new Float32Array(p.count * 2);
  for (let k = 0; k < p.count; k++) {
    rig[k * 2] = h;
    rig[k * 2 + 1] = p.getX(k) / h;
  }
  g.setAttribute("aRig", new THREE.BufferAttribute(rig, 2));
  return g;
}

/** Is this entity drawn by the unit layer at all (alive unit outside buildings). */
export const isDrawnUnit = (w: World, i: number): boolean => w.ents.alive[i] === 1 && w.ents.cat[i] === CAT.unit && w.ents.inside[i] < 0;

export const UNIT_ANIM_PARS = /* glsl */ `
attribute vec2 aRig;
attribute vec4 instanceAnim;
`;

/** Runs right after three's begin_vertex: bends `transformed` (local, +y up, +z forward). Meshes without aRig are untouched. */
export const UNIT_ANIM_VERTEX = /* glsl */ `
if ( aRig.x > 0.0 ) {
  float hfH = aRig.x;
  float hfX = aRig.y;
  float hfY01 = transformed.y / hfH;
  float hfLegSide = clamp( hfX / 0.05, -1.0, 1.0 );
  float hfLeg = 1.0 - smoothstep( 0.26, 0.4, hfY01 );
  transformed.z += hfLeg * ( 0.4 * hfH - transformed.y ) * 0.7 * instanceAnim.x * hfLegSide;
  float hfArmW = smoothstep( 0.42, 0.55, hfY01 ) * ( 1.0 - smoothstep( 0.8, 0.9, hfY01 ) ) * smoothstep( 0.1, 0.17, abs( hfX ) );
  float hfRaise = max( instanceAnim.z * step( 0.0, hfX ), instanceAnim.w );
  transformed.y += hfArmW * hfRaise * max( 0.0, 0.95 * hfH - transformed.y ) * 1.1;
  transformed.z += hfArmW * ( hfRaise * 0.14 * hfH - 0.12 * hfH * instanceAnim.x * sign( hfX ) );
  float hfA = instanceAnim.y * smoothstep( 0.33, 0.48, hfY01 );
  float hfC = cos( hfA );
  float hfS = sin( hfA );
  float hfYw = transformed.y - 0.42 * hfH;
  float hfZ = transformed.z;
  transformed.y = 0.42 * hfH + hfYw * hfC - hfZ * hfS;
  transformed.z = hfZ * hfC + hfYw * hfS;
}
`;
