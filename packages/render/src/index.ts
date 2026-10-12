// @hearthfall/render: three.js renderer. Reads sim state, never writes it.
export { ThreeRenderer, type ModelStatus, type Renderer, type RenderStats, type RendererOptions } from "./renderer.ts";
export { CAMERA_PRESETS, CAMERA_RIG_DEFAULTS, cameraRig, rigParams, type CameraRig, type CameraState } from "./camera.ts";
export { bendY, type BendUniforms } from "./curve.ts";
export { CHUNK } from "./terrainMesh.ts";
export { resolveTilt, tiltUniforms, type TiltOrder, type TiltShiftOptions } from "./retro.ts";
export { aliasModels } from "./models.ts";
export { resolveLighting, type LightingLook, type LightingPreset, type RainLook } from "./weather.ts";
export { HEALTH_BAR_MODES, type HealthBarMode, type Relation } from "./overlays.ts";
export { AMBIENT_DEFAULTS, resolveAmbient, type AmbientLook } from "./ambient.ts";
