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

export function rigParams(s: CameraState): RigOutput {
  const z = Math.min(1, Math.max(0, s.zoom));
  const distance = 11 + 120 * z * z + 20 * z;
  // look v2: a steep, near top-down view with strong curvature so the planet limb and space show
  const pitch = 0.78 + 0.62 * z;
  const bendK = 0.004 + 0.026 * z * z;
  return { distance, pitch, bendK, fogNear: distance * 1.1, fogFar: distance * 2.6 + 40 + 400 * z * z };
}

/** Position `camera` for state `s` looking at the focus at height `focusY`. */
export function applyCamera(camera: THREE.PerspectiveCamera, s: CameraState, focusY: number, worldSize: number): RigOutput {
  const r = rigParams(s);
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
