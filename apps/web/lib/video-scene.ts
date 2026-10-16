import type { LayerKeyframe, VideoScene, VideoSceneKeyframe } from "@relay/core";
import { animationEasings, normalizeAnimationCurve, animationExpressions, type AnimationScalar, scalarAdd as add, scalarMul as mul } from "./video-animation.ts";

export const defaultVideoScene: VideoScene = {
  version: 1, camera: { x: 0, y: 0, z: 0, rotateX: 0, rotateY: 0, rotateZ: 0, focalLength: 50 },
  environment: "studio", exposure: 1, roughness: .35, metallic: .75, shadow: .3,
  lightAngle: -35, focusDepth: 0, aperture: 0, motionBlur: 0,
};
export const sceneEnvironments = ["studio", "softbox", "sunset", "night"] as const;
export const sceneRanges = {
  exposure: [.1, 3], roughness: [0, 1], metallic: [0, 1], shadow: [0, 1], lightAngle: [-180, 180],
  focusDepth: [-2, 2], aperture: [0, 1], motionBlur: [0, 1],
} as const;
export const cameraRanges = { x: [-2, 2], y: [-2, 2], z: [-2, 2], rotateX: [-180, 180], rotateY: [-180, 180], rotateZ: [-180, 180], focalLength: [18, 120] } as const;
function number(value: unknown, fallback: number, range: readonly [number, number], name: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value < range[0] || value > range[1]) throw new Error(`${name} must be between ${range[0]} and ${range[1]}.`);
  return value;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Scene settings must be an object.");
  return value as Record<string, unknown>;
}
export function normalizeVideoScene(value: unknown): VideoScene | undefined {
  if (value === undefined || value === null) return undefined;
  const input = object(value), rawCamera = object(input.camera ?? {});
  if (input.version !== undefined && input.version !== 1) throw new Error("Unsupported scene version.");
  const result: VideoScene = { ...defaultVideoScene, camera: { ...defaultVideoScene.camera } };
  for (const key of Object.keys(sceneRanges) as Array<keyof typeof sceneRanges>) result[key] = number(input[key], result[key], sceneRanges[key], `Scene ${key}`);
  for (const key of Object.keys(cameraRanges) as Array<keyof typeof cameraRanges>) result.camera[key] = number(rawCamera[key], result.camera[key], cameraRanges[key], `Camera ${key}`);
  if (input.environment !== undefined) {
    if (!sceneEnvironments.includes(input.environment as VideoScene["environment"])) throw new Error("Choose a supported scene environment.");
    result.environment = input.environment as VideoScene["environment"];
  }
  if (rawCamera.keyframes !== undefined) {
    if (!Array.isArray(rawCamera.keyframes) || rawCamera.keyframes.length > 100) throw new Error("Camera supports up to 100 keyframes.");
    result.camera.keyframes = rawCamera.keyframes.map(value => {
      const key = object(value), parsed: VideoSceneKeyframe = { timeMs: number(key.timeMs, 0, [0, 86400000], "Camera keyframe time") };
      for (const field of ["x", "y", "z", "rotateX", "rotateY", "rotateZ", "focalLength"] as const) if (key[field] !== undefined) parsed[field] = number(key[field], 0, cameraRanges[field], `Camera keyframe ${field}`);
      // Layer keyframe scale animates the focal length multiplier.
      if (key.scale !== undefined) parsed.scale = number(key.scale, 1, [.25, 4], "Camera lens scale");
      if (key.easing !== undefined) {
        if (!animationEasings.includes(key.easing as NonNullable<LayerKeyframe["easing"]>)) throw new Error("Choose a supported camera easing.");
        parsed.easing = key.easing as LayerKeyframe["easing"];
      }
      if (key.curve !== undefined) parsed.curve = normalizeAnimationCurve(key.curve);
      return parsed;
    }).sort((a,b) => a.timeMs-b.timeMs);
    if (result.camera.keyframes.some((key,i,keys) => i > 0 && key.timeMs === keys[i-1].timeMs)) throw new Error("Camera keyframe times must be distinct.");
  }
  return result;
}
export interface ScenePoint<T = number> { x: T; y: T; z: T }
const neg = (v: AnimationScalar) => mul(-1, v);
const sin = (v: AnimationScalar): AnimationScalar => typeof v === "number" ? Math.sin(v) : `sin(${v})`;
const cos = (v: AnimationScalar): AnimationScalar => typeof v === "number" ? Math.cos(v) : `cos(${v})`;
const div = (a: AnimationScalar,b: AnimationScalar): AnimationScalar => typeof a === "number" && typeof b === "number" ? a/b : `(${a}/${b})`;
const lower = (v: AnimationScalar,n: number): AnimationScalar => typeof v === "number" ? Math.max(n,v) : `max(${n},${v})`;
export function rotateScenePoint(p: ScenePoint<AnimationScalar>, rx: AnimationScalar, ry: AnimationScalar, rz: AnimationScalar): ScenePoint<AnimationScalar> {
  const y = add(mul(p.y,cos(rx)),neg(mul(p.z,sin(rx)))), z = add(mul(p.y,sin(rx)),mul(p.z,cos(rx)));
  const x = add(mul(p.x,cos(ry)),mul(z,sin(ry))), depth = add(neg(mul(p.x,sin(ry))),mul(z,cos(ry)));
  return { x: add(mul(x,cos(rz)),neg(mul(y,sin(rz)))), y: add(mul(x,sin(rz)),mul(y,cos(rz))), z: depth };
}
export interface SceneCameraState {
  x:number; y:number; z:number; rotateX:number; rotateY:number; rotateZ:number; focalLength:number; scale:number;
}
export type SceneCameraExpressions = { [K in keyof SceneCameraState]:AnimationScalar };
/** Dedicated camera channels reuse the exact layer interpolation algebra. Z and
 * focal length map to independent x/y tracks so sparse values, custom curves
 * and symbolic FFmpeg clocks all follow the same interpolation rules. */
export function sceneCameraExpressions(scene:VideoScene|undefined,timeMs:AnimationScalar=0):SceneCameraExpressions {
  const camera=scene?.camera ?? defaultVideoScene.camera;
  const standard=animationExpressions({keyframes:camera.keyframes},timeMs,86400000,{...camera,scale:1},"device");
  const extraKeys=(camera.keyframes ?? []).map(key=>({timeMs:key.timeMs,easing:key.easing,curve:key.curve,...(key.z===undefined?{}:{x:key.z}),...(key.focalLength===undefined?{}:{y:key.focalLength})}));
  const extra=animationExpressions({keyframes:extraKeys},timeMs,86400000,{x:camera.z,y:camera.focalLength},"device");
  return {x:standard.x,y:standard.y,z:extra.x,rotateX:standard.rotateX,rotateY:standard.rotateY,rotateZ:standard.rotateZ,focalLength:lower(extra.y,1),scale:standard.scale};
}
export function sceneCameraState(scene:VideoScene|undefined,timeMs=0):SceneCameraState {
  return sceneCameraExpressions(scene,Math.max(0,timeMs)) as SceneCameraState;
}

/** Coordinates are in canvas pixels with +Z toward the viewer. Camera x/y/z are
 * offsets in max(canvas) units. sceneTimeMs is GLOBAL timeline time, independent
 * of the device's local animation time. Preview and FFmpeg share this algebra. */
export function sceneCameraPoint(p: ScenePoint<AnimationScalar>, width: number, height: number, scene: VideoScene | undefined, sceneTimeMs: AnimationScalar = 0): ScenePoint<AnimationScalar> {
  if (!scene) return p;
  const c = sceneCameraExpressions(scene,sceneTimeMs), unit = Math.max(width,height);
  return rotateScenePoint({ x: add(p.x,neg(mul(c.x,unit))), y: add(p.y,neg(mul(c.y,unit))), z: add(p.z,neg(mul(c.z,unit))) },mul(c.rotateX,-Math.PI/180),mul(c.rotateY,-Math.PI/180),mul(c.rotateZ,-Math.PI/180));
}
export function sceneProjectPoint(p: ScenePoint<AnimationScalar>, width: number, height: number, scene: VideoScene | undefined, sceneTimeMs: AnimationScalar = 0): ScenePoint<AnimationScalar> {
  const q = sceneCameraPoint(p,width,height,scene,sceneTimeMs), unit = Math.max(width,height);
  const c=sceneCameraExpressions(scene,sceneTimeMs);
  const lens = mul(mul(unit*3/50,c.focalLength),c.scale);
  // Near-plane guard keeps every projection finite.
  const perspective = div(lens,lower(add(unit*3,neg(q.z)),unit*.06));
  return {x:add(width/2,mul(q.x,perspective)),y:add(height/2,mul(q.y,perspective)),z:q.z};
}
export function sceneFocusBlur(scene: VideoScene | undefined, depth: number, width: number, height: number): number {
  return scene ? Math.min(Math.max(width,height)*.035, Math.abs(depth-scene.focusDepth)*scene.aperture*Math.max(width,height)*.012) : 0;
}
/** These same temporal sample offsets should be applied to body AND media during
 * export. Sampling only the mesh would leave a crisp screen inside a blurred body. */
export function sceneShutterSamples(scene: VideoScene | undefined, timeMs: number, fps = 30): Array<{ timeMs: number; weight: number }> {
  if (!scene?.motionBlur) return [{timeMs,weight:1}];
  const shutter = 1000/fps * scene.motionBlur;
  return Array.from({length:5},(_,i)=>({timeMs:Math.max(0,timeMs+(i/4-.5)*shutter),weight:1/5}));
}
/** Painter order for independent scene layers; positive depth is nearer. */
export function sortSceneLayers<T extends { deviceFrame?: { depth?: number } }>(layers: T[]): T[] {
  return [...layers].sort((a,b)=>(a.deviceFrame?.depth ?? 0)-(b.deviceFrame?.depth ?? 0));
}
