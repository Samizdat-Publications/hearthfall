// M0 bootstrap scene: proves three.js WebGL, the data pack import, the Preact HUD and the
// window.__game debug API all work in dev, test builds and headless capture.
import * as THREE from "three";
import style from "../../../data/base/style.json";
import { mountHud } from "./hud.tsx";

const canvas = document.getElementById("view") as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const pal = style.palette as Record<string, string>;
const scene = new THREE.Scene();
scene.background = new THREE.Color(style.lighting.skyTop);
scene.fog = new THREE.Fog(style.lighting.fogColor, 30, 80);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 500);
camera.position.set(14, 12, 18);
camera.lookAt(0, 0, 0);

scene.add(new THREE.HemisphereLight(style.lighting.skyHorizon, pal.moss, 1.1));
const sun = new THREE.DirectionalLight(style.lighting.keyColor, style.lighting.keyIntensity);
sun.position.set(10, 20, 8);
scene.add(sun);

// Banded ground: a small bumpy island in sea water, colored by height band.
const ground = new THREE.PlaneGeometry(40, 40, 64, 64);
ground.rotateX(-Math.PI / 2);
const posAttr = ground.getAttribute("position");
const colors: number[] = [];
const bands: [number, string][] = [[-0.2, pal.sand], [0.6, pal.meadow], [1.6, pal.moss], [2.6, pal.rock], [99, pal.snow]];
const c = new THREE.Color();
for (let i = 0; i < posAttr.count; i++) {
  const x = posAttr.getX(i);
  const z = posAttr.getZ(i);
  const r = Math.hypot(x, z);
  const h = Math.max(-1.5, 3.2 - r * 0.28 + Math.sin(x * 0.7) * 0.4 + Math.cos(z * 0.5) * 0.4);
  posAttr.setY(i, h);
  c.set(bands.find(([top]) => h < top)![1]);
  colors.push(c.r, c.g, c.b);
}
ground.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
ground.computeVertexNormals();
scene.add(new THREE.Mesh(ground, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })));

const water = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshLambertMaterial({ color: pal.water, transparent: true, opacity: 0.85 }));
water.rotation.x = -Math.PI / 2;
water.position.y = -0.1;
scene.add(water);

// Four tribe-colored totems so color and shading are visible in captures.
const tribes = ["azure", "crimson", "amber", "jade"];
tribes.forEach((t, i) => {
  const m = new THREE.Mesh(new THREE.ConeGeometry(0.8, 2.4, 6), new THREE.MeshLambertMaterial({ color: pal[t], flatShading: true }));
  const a = (i / tribes.length) * Math.PI * 2;
  m.position.set(Math.cos(a) * 4, 3.4, Math.sin(a) * 4);
  scene.add(m);
});

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

let frames = 0;
function frame() {
  renderer.render(scene, camera);
  frames++;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

mountHud(document.getElementById("hud")!);

if (__DEBUG_API__) {
  const gl = renderer.getContext();
  const dbg = gl.getExtension("WEBGL_debug_renderer_info");
  (window as unknown as { __game: unknown }).__game = {
    frames: () => frames,
    getSummary: () => ({ milestone: "M0", frames, scene: "bootstrap" }),
    webgl: () => ({
      version: gl.getParameter(gl.VERSION) as string,
      renderer: dbg ? (gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) as string) : "unknown",
    }),
  };
}
