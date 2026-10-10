// Camera rig: orbits a focus point on the surface. Zoom 0 is a close-up, 1 is the globe view;
// pitch, distance, bend and fog all follow zoom. Map view is a flat top-down projection (k = 0).
import * as THREE from "three";

export interface CameraState {
  x: number;
  z: number;
  yaw: number;
  zoom: number;
  map: boolean;
}

export const CAMERA_PRESETS: Record<string, Partial<CameraState>> = {
  default: { zoom: 0.42, yaw: 0.6, map: false },
  close: { zoom: 0.06, yaw: 0.9, map: false },
  mid: { zoom: 0.58, yaw: 0.6, map: false },
  globe: { zoom: 1, yaw: 0.6, map: false },
  map: { map: true },
};

export interface RigOutput {
  distance: number;
  pitch: number;
  bendK: number;
  fogNear: number;
  fogFar: number;
}

/** BACKLOG 41: the rig curves against zoom (style.json render.camera). */
export interface CameraRig {
  distance: { base: number; linear: number; quad: number };
  pitch: { base: number; linear: number };
  bend: { base: number; quad: number };
  fog: { nearMul: number; farMul: number; farAdd: number; farQuad: number };
}

/** look v2: a steep, near top-down view with strong curvature so the planet limb and space show */
export const CAMERA_RIG_DEFAULTS: CameraRig = {
  distance: { base: 11, linear: 20, quad: 120 },
  pitch: { base: 0.78, linear: 0.62 },
  bend: { base: 0.004, quad: 0.026 },
  fog: { nearMul: 1.1, farMul: 2.6, farAdd: 40, farQuad: 400 },
};

/** The rig from a style block: each curve given there replaces the default one. */
export function cameraRig(o?: Partial<CameraRig>): CameraRig {
  const d = CAMERA_RIG_DEFAULTS;
  return { distance: o?.distance ?? d.distance, pitch: o?.pitch ?? d.pitch, bend: o?.bend ?? d.bend, fog: o?.fog ?? d.fog };
}

export function rigParams(s: CameraState, rig: CameraRig = CAMERA_RIG_DEFAULTS): RigOutput {
  const z = Math.min(1, Math.max(0, s.zoom));
  const distance = rig.distance.base + rig.distance.quad * z * z + rig.distance.linear * z;
  const pitch = rig.pitch.base + rig.pitch.linear * z;
  const bendK = rig.bend.base + rig.bend.quad * z * z;
  return { distance, pitch, bendK, fogNear: distance * rig.fog.nearMul, fogFar: distance * rig.fog.farMul + rig.fog.farAdd + rig.fog.farQuad * z * z };
}

/** Position `camera` for state `s` looking at the focus at height `focusY`. */
export function applyCamera(camera: THREE.PerspectiveCamera, s: CameraState, focusY: number, worldSize: number, rig: CameraRig = CAMERA_RIG_DEFAULTS): RigOutput {
  const r = rigParams(s, rig);
  if (s.map) {
    const h = worldSize * 1.05 / Math.tan((camera.fov * Math.PI) / 360) / 2;
    camera.position.set(s.x, focusY + h, s.z + 0.001);
    camera.up.set(0, 0, -1);
    camera.lookAt(s.x, focusY, s.z);
    camera.far = h * 3;
    camera.updateProjectionMatrix();
    return { ...r, bendK: 0, fogNear: 1e6, fogFar: 2e6 };
  }
  const cp = Math.cos(r.pitch);
  camera.up.set(0, 1, 0);
  camera.position.set(s.x + Math.sin(s.yaw) * cp * r.distance, focusY + Math.sin(r.pitch) * r.distance, s.z + Math.cos(s.yaw) * cp * r.distance);
  camera.lookAt(s.x, focusY, s.z);
  camera.far = r.distance * 4 + 200;
  camera.updateProjectionMatrix();
  return r;
}
