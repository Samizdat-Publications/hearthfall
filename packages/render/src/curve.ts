// Curved world: every world material is patched so vertices bend down with the squared horizontal
// distance from the camera focus, in world space after the instance matrix
// (worldPos.y -= k * |worldPos.xz - focus|^2). A radial fade to the horizon color past `fadeStart`
// hides the nearest-copy wrap jump of the torus (docs/ARCHITECTURE.md section 7).
import * as THREE from "three";

export interface BendUniforms {
  uBendK: { value: number };
  uBendFocus: { value: THREE.Vector2 };
  uFadeStart: { value: number };
  uFadeEnd: { value: number };
  uHorizon: { value: THREE.Color };
}

export function makeBendUniforms(): BendUniforms {
  return {
    uBendK: { value: 0.004 },
    uBendFocus: { value: new THREE.Vector2() },
    uFadeStart: { value: 50 },
    uFadeEnd: { value: 60 },
    uHorizon: { value: new THREE.Color("#f3d9b1") },
  };
}

export const BEND_VERTEX_PARS = /* glsl */ `
uniform float uBendK;
uniform vec2 uBendFocus;
varying float vBendDist;
`;

/** Replaces three's project_vertex chunk; `transformed` is the local position. */
export const BEND_PROJECT_VERTEX = /* glsl */ `
vec4 hfWorld = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
  hfWorld = batchingMatrix * hfWorld;
#endif
#ifdef USE_INSTANCING
  hfWorld = instanceMatrix * hfWorld;
#endif
hfWorld = modelMatrix * hfWorld;
vec2 hfD = hfWorld.xz - uBendFocus;
float hfR2 = dot( hfD, hfD );
vBendDist = sqrt( hfR2 );
hfWorld.y -= uBendK * hfR2;
vec4 mvPosition = viewMatrix * hfWorld;
gl_Position = projectionMatrix * mvPosition;
`;

export const BEND_FRAGMENT_PARS = /* glsl */ `
uniform float uFadeStart;
uniform float uFadeEnd;
uniform vec3 uHorizon;
varying float vBendDist;
`;

export const BEND_FRAGMENT_FADE = /* glsl */ `
if ( vBendDist > uFadeEnd ) discard;
gl_FragColor.rgb = mix( gl_FragColor.rgb, uHorizon, smoothstep( uFadeStart, uFadeEnd, vBendDist ) );
`;

/**
 * Patch a built-in material (Lambert, Standard, Basic...) in place to bend and fade. With a detail
 * uniform, surfaces get world-anchored pixel noise (sand grains, grass tufts) at detailCells per unit.
 */
export function bendMaterial<T extends THREE.Material>(mat: T, u: BendUniforms, detail?: { amount: { value: number }; cells: { value: number } }): T {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    let vs = BEND_VERTEX_PARS + shader.vertexShader.replace("#include <project_vertex>", BEND_PROJECT_VERTEX);
    let fs = BEND_FRAGMENT_PARS + shader.fragmentShader.replace("#include <fog_fragment>", "#include <fog_fragment>\n" + BEND_FRAGMENT_FADE);
    if (detail) {
      shader.uniforms.uDetail = detail.amount;
      shader.uniforms.uDetailCells = detail.cells;
      vs = "varying vec2 vDetailXZ;\n" + vs.replace("vBendDist = sqrt( hfR2 );", "vBendDist = sqrt( hfR2 );\nvDetailXZ = ( modelMatrix * vec4( transformed, 1.0 ) ).xz;");
      fs =
        "uniform float uDetail;\nuniform float uDetailCells;\nvarying vec2 vDetailXZ;\n" +
        fs.replace(
          "#include <color_fragment>",
          "#include <color_fragment>\n{ vec2 cell = floor( vDetailXZ * uDetailCells ); float hn = fract( sin( dot( cell, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ); diffuseColor.rgb *= 1.0 + uDetail * ( hn - 0.5 ) * 2.0; }",
        );
    }
    shader.vertexShader = vs;
    shader.fragmentShader = fs;
  };
  mat.customProgramCacheKey = () => (detail ? "hf-bend-detail" : "hf-bend");
  return mat;
}

/** CPU version of the bend (picking, previews, unit culling). */
export function bendY(u: BendUniforms, x: number, z: number, y: number): number {
  const dx = x - u.uBendFocus.value.x;
  const dz = z - u.uBendFocus.value.y;
  return y - u.uBendK.value * (dx * dx + dz * dz);
}
