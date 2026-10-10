// @hearthfall/render: three.js renderer. Reads sim state, never writes it.
export { ThreeRenderer, type ModelStatus, type Renderer, type RenderStats, type RendererOptions } from "./renderer.ts";
export { CAMERA_PRESETS, rigParams, type CameraState } from "./camera.ts";
export { bendY, type BendUniforms } from "./curve.ts";
export { CHUNK } from "./terrainMesh.ts";
export { resolveTilt, tiltUniforms, type TiltOrder, type TiltShiftOptions } from "./retro.ts";
export { aliasModels } from "./models.ts";
