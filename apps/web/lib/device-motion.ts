import type { DeviceFrame, VideoClip } from "@relay/core";
import { animationExpressions, animationEase } from "./video-animation.ts";
import { deviceBackgroundCss, deviceFrameGeometry, type DeviceFrameGeometry } from "./device-frames.ts";

export interface DevicePoint { x: number; y: number }
export interface DevicePanelRect { x: number; y: number; width: number; height: number }
export interface DevicePanel {
  /** Region in the untransformed full canvas, including the source screen. */
  rect: DevicePanelRect;
  /** Destination corners, in TL, TR, BL, BR order. */
  corners: [DevicePoint, DevicePoint, DevicePoint, DevicePoint];
  /** CSS matrix mapping panel-local coordinates to the output canvas. Origin must be 0 0. */
  transform: string;
  /** Hide back-facing and near-edge-on screen surfaces. */
  visible: boolean;
}
export interface DeviceScene {
  geometry: DeviceFrameGeometry;
  panels: DevicePanel[];
  background: string;
  opacity: number;
}

// Numeric preview and symbolic FFmpeg coordinates share this single projection.
// Constants are folded to keep the export filter small and cheap to evaluate.
type Scalar = number | string;
const add = (a: Scalar, b: Scalar): Scalar => typeof a === "number" && typeof b === "number" ? a + b : a === 0 ? b : b === 0 ? a : `(${a}+${b})`;
const mul = (a: Scalar, b: Scalar): Scalar => typeof a === "number" && typeof b === "number" ? a * b : a === 0 || b === 0 ? 0 : a === 1 ? b : b === 1 ? a : `(${a}*${b})`;
const neg = (a: Scalar): Scalar => mul(-1, a);
const sin = (a: Scalar): Scalar => typeof a === "number" ? Math.sin(a) : `sin(${a})`;
const cos = (a: Scalar): Scalar => typeof a === "number" ? Math.cos(a) : `cos(${a})`;
const div = (a: Scalar, b: Scalar): Scalar => typeof a === "number" && typeof b === "number" ? a / b : `(${a}/${b})`;
const clamp = (a: Scalar): Scalar => typeof a === "number" ? Math.min(1, Math.max(0, a)) : `min(1,max(0,${a}))`;
const degrees = (a: Scalar): Scalar => mul(a, Math.PI / 180);

function pose(frame: DeviceFrame, timeMs: Scalar, height: number, durationMs = frame.motionDurationMs ?? 4000) {
  const animated = animationExpressions(frame.animation,timeMs,durationMs,frame,"device");
  const progress = div(timeMs, frame.motionDurationMs ?? 4000);
  const cycle = typeof progress === "number" ? progress - Math.floor(progress) : `(${progress}-floor(${progress}))`;
  const phase = mul(frame.motionEasing ? animationEase(cycle,frame.motionEasing) : progress, Math.PI * 2);
  let rx: Scalar = animated.rotateX, ry: Scalar = animated.rotateY, rz: Scalar = animated.rotateZ;
  let fold: Scalar = animated.foldAngle, dy: Scalar = 0;
  const amount = frame.foldAngle || 150;
  // Authored hinge keyframes take precedence over the canned hinge motions;
  // other presets still add their movement to the authored pose.
  const hingeKeyframes = frame.animation?.keyframes?.some(k => k.foldAngle !== undefined);
  const motion = hingeKeyframes && ["fold", "unfold", "fold-cycle"].includes(frame.motion ?? "none") ? "none" : frame.motion;
  switch (motion) {
    case "orbit": rx = add(rx, mul(12, sin(phase))); ry = add(ry, mul(24, sin(phase))); rz = add(rz, mul(6, cos(phase))); break;
    case "float": dy = mul(-height * .025, sin(phase)); rz = add(rz, mul(3, sin(phase))); break;
    case "fold": fold = mul(amount, mul(.5, add(1, neg(cos(mul(Math.PI, animationEase(clamp(progress),frame.motionEasing))))))); break;
    case "unfold": fold = mul(amount, mul(.5, add(1, cos(mul(Math.PI, animationEase(clamp(progress),frame.motionEasing)))))); break;
    case "fold-cycle": fold = mul(amount, mul(.5, add(1, neg(cos(phase))))); break;
  }
  return { rx: degrees(rx), ry: degrees(ry), rz: degrees(rz), fold: degrees(frame.device === "iphone-duo" ? fold : 0), dy, animated };
}

function project(width: number, height: number, frame: DeviceFrame, geometry: DeviceFrameGeometry, timeMs: Scalar, point: DevicePoint, side: number, durationMs?: number): { x: Scalar; y: Scalar } {
  const p = pose(frame, timeMs, height, durationMs), scale = p.animated.scale;
  const localX = mul(point.x - geometry.outer.x - geometry.outer.width / 2, scale);
  const localY = mul(point.y - geometry.outer.y - geometry.outer.height / 2, scale);
  // Each half rotates around the same center hinge; video remains on the two planes.
  const foldedX = mul(localX, cos(mul(.5, p.fold)));
  const foldedZ = mul(mul(localX,side), sin(mul(.5, p.fold)));
  const y = add(mul(localY, cos(p.rx)), neg(mul(foldedZ, sin(p.rx))));
  const z = add(mul(localY, sin(p.rx)), mul(foldedZ, cos(p.rx)));
  const x = add(mul(foldedX, cos(p.ry)), mul(z, sin(p.ry)));
  const depth = add(neg(mul(foldedX, sin(p.ry))), mul(z, cos(p.ry)));
  const rotatedX = add(mul(x, cos(p.rz)), neg(mul(y, sin(p.rz))));
  const rotatedY = add(mul(x, sin(p.rz)), mul(y, cos(p.rz)));
  const camera = Math.max(width, height) * 3;
  const perspective = div(camera, add(camera, neg(depth)));
  return { x: add(mul(width, p.animated.x), mul(rotatedX, perspective)), y: add(add(mul(height, p.animated.y), p.dy), mul(rotatedY, perspective)) };
}

function facing(frame: DeviceFrame, timeMs: Scalar, height: number, side: number, durationMs?: number): Scalar {
  const p = pose(frame, timeMs, height,durationMs);
  return add(mul(side, mul(sin(mul(.5, p.fold)), sin(p.ry))), mul(cos(mul(.5, p.fold)), mul(cos(p.rx), cos(p.ry))));
}

export function devicePanelRects(geometry: DeviceFrameGeometry, frame: DeviceFrame): DevicePanelRect[] {
  const { x, y, width, height } = geometry.outer;
  if (frame.device !== "iphone-duo") return [{ x, y, width, height }];
  const left = Math.floor(width / 2);
  return [{ x, y, width: left, height }, { x: x + left, y, width: width - left, height }];
}
const rectCorners = (r: DevicePanelRect): [DevicePoint, DevicePoint, DevicePoint, DevicePoint] => [{ x: r.x, y: r.y }, { x: r.x + r.width, y: r.y }, { x: r.x, y: r.y + r.height }, { x: r.x + r.width, y: r.y + r.height }];

/** Homography embedded in CSS matrix3d, for a rectangle's four projected corners. */
export function devicePanelTransform(rect: Pick<DevicePanelRect, "width" | "height">, corners: DevicePanel["corners"]): string {
  const [p0, p1, p2, p3] = corners;
  const dx1 = p1.x - p3.x, dx2 = p2.x - p3.x, dx3 = p0.x - p1.x - p2.x + p3.x;
  const dy1 = p1.y - p3.y, dy2 = p2.y - p3.y, dy3 = p0.y - p1.y - p2.y + p3.y;
  const determinant = dx1 * dy2 - dx2 * dy1;
  const g = Math.abs(determinant) < 1e-10 ? 0 : (dx3 * dy2 - dx2 * dy3) / determinant;
  const h = Math.abs(determinant) < 1e-10 ? 0 : (dx1 * dy3 - dx3 * dy1) / determinant;
  const a = p1.x - p0.x + g * p1.x, b = p2.x - p0.x + h * p2.x;
  const d = p1.y - p0.y + g * p1.y, e = p2.y - p0.y + h * p2.y;
  return `matrix3d(${[a / rect.width, d / rect.width, 0, g / rect.width, b / rect.height, e / rect.height, 0, h / rect.height, 0, 0, 1, 0, p0.x, p0.y, 0, 1].join(",")})`;
}

export function deviceScene(width: number, height: number, frame: DeviceFrame, timeMs = 0, durationMs = frame.motionDurationMs ?? 4000): DeviceScene {
  const geometry = deviceFrameGeometry(width, height, frame.device);
  const panels = devicePanelRects(geometry, frame).map(rect => {
    const side = rect.x + rect.width / 2 < geometry.outer.x + geometry.outer.width / 2 ? -1 : 1;
    const corners = rectCorners(rect).map(point => project(width, height, frame, geometry, Math.max(0, timeMs), point, side,durationMs)) as DevicePanel["corners"];
    return { rect, corners, transform: devicePanelTransform(rect, corners), visible: (facing(frame, Math.max(0, timeMs), height, side,durationMs) as number) > .015 };
  });
  return { geometry, panels, background: deviceBackgroundCss(frame), opacity: pose(frame,Math.max(0,timeMs),height,durationMs).animated.opacity as number };
}

/** The panel input is stretched to the canvas before this warp. An alpha-zero
 * guard pixel around the panel prevents FFmpeg's edge extension filling the canvas.
 * FFmpeg's perspective on counter starts at one, after fps=30. Subtracting one
 * makes the first exported frame match preview local time zero. */
export function devicePerspectiveFilter(width: number, height: number, frame: DeviceFrame, panel: DevicePanelRect, fps = 30, guard = 1, viewport: DevicePanelRect = { x: 0, y: 0, width, height }, durationMs = frame.motionDurationMs ?? 4000): string {
  const geometry = deviceFrameGeometry(width, height, frame.device);
  const expanded = { x: panel.x - guard, y: panel.y - guard, width: panel.width + guard * 2, height: panel.height + guard * 2 };
  const side = panel.x + panel.width / 2 < geometry.outer.x + geometry.outer.width / 2 ? -1 : 1;
  const points = rectCorners(expanded).map(point => project(width, height, frame, geometry, `((on-1)/${fps}*1000)`, point, side,durationMs));
  return `perspective=${points.map((point, index) => `x${index}='${add(point.x, -viewport.x)}':y${index}='${add(point.y, -viewport.y)}'`).join(":")}:sense=destination:eval=frame:interpolation=linear`;
}

/** Conservative output bounds for a complete preset cycle. Perspective maps are
 * generated only for this region, avoiding two full-HD warps for small panels.
 * Fixed dense sampling plus a guard covers the smooth, bounded preset curves. */
export function devicePanelViewport(width: number, height: number, frame: DeviceFrame, panel: DevicePanelRect, durationMs = frame.motionDurationMs ?? 4000): DevicePanelRect {
  const geometry = deviceFrameGeometry(width, height, frame.device);
  const moving = (frame.motion && frame.motion !== "none") || !!frame.animation;
  const side = panel.x + panel.width / 2 < geometry.outer.x + geometry.outer.width / 2 ? -1 : 1;
  let minX = width, minY = height, maxX = 0, maxY = 0;
  const times = moving ? Array.from({length:129},(_,i)=>i/128*durationMs) : [0];
  // Sample each keyframe/effect interval separately so short entrances and
  // keyframes on a long clip do not disappear between whole-clip samples.
  const boundaries = frame.animation ? [0,durationMs,...(frame.animation?.keyframes ?? []).map(k=>k.timeMs),Math.min(durationMs/2,frame.animation?.entrance?.durationMs ?? 0),durationMs-Math.min(durationMs/2,frame.animation?.exit?.durationMs ?? 0)].filter(t=>t>=0&&t<=durationMs).sort((a,b)=>a-b) : [];
  for(let i=0;i<boundaries.length-1;i++) for(let n=0;n<=128;n++) times.push(boundaries[i]+(boundaries[i+1]-boundaries[i])*n/128);
  // Very long clips can contain many preset cycles. A full-canvas viewport
  // guarantees coverage where bounded sampling would alias repeated motion.
  if(moving && durationMs / (frame.motionDurationMs ?? 4000) > 32) return {x:0,y:0,width,height};
  for (const t of times) {
    for (const corner of rectCorners(panel)) {
      const p = project(width, height, frame, geometry, t, corner, side,durationMs);
      minX = Math.min(minX, p.x as number); minY = Math.min(minY, p.y as number);
      maxX = Math.max(maxX, p.x as number); maxY = Math.max(maxY, p.y as number);
    }
  }
  const guard = Math.ceil(Math.max(width, height) * .008) + 4;
  const x = Math.max(0, Math.min(width - 1, Math.floor(minX - guard)));
  const y = Math.max(0, Math.min(height - 1, Math.floor(minY - guard)));
  return { x, y, width: Math.max(1, Math.min(width, Math.ceil(maxX + guard)) - x), height: Math.max(1, Math.min(height, Math.ceil(maxY + guard)) - y) };
}

/** Complete visual filter for one clip. Input 0 is the source; input 1 is the
 * transparent frame layer when framed; backgroundInput is a canvas PNG. The
 * transparent mode clears that canvas alpha and returns RGBA for layer export.
 * Source and frame are composited before splitting/warping, so screen media
 * follows exactly the same geometry as the bezel in both preview and export. */
export function deviceVideoSceneFilter(width: number, height: number, clip: VideoClip, backgroundInput: number, durationMs = clip.outMs-clip.inMs, transparent = false): string {
  const geometry = clip.deviceFrame ? deviceFrameGeometry(width, height, clip.deviceFrame.device) : undefined;
  const tw = geometry?.screen.width ?? width, th = geometry?.screen.height ?? height;
  const sw = Math.ceil(tw * clip.zoom / 2) * 2, sh = Math.ceil(th * clip.zoom / 2) * 2;
  const fit = clip.fit === "cover"
    ? `scale=${sw}:${sh}:force_original_aspect_ratio=increase,crop=${tw}:${th}:(iw-ow)*${clip.x}:(ih-oh)*${clip.y}`
    : `scale=${tw}:${th}:force_original_aspect_ratio=decrease,pad=${tw}:${th}:(ow-iw)*${clip.x}:(oh-ih)*${clip.y}:color=${geometry ? "black" : "black@0"}`;
  const filters = [`[0:v]format=rgba,${fit},setsar=1,fps=30,setpts=PTS-STARTPTS${geometry ? `,pad=${width}:${height}:${geometry.screen.x}:${geometry.screen.y}:color=black@0` : ""}[screen]`, `[${backgroundInput}:v]format=rgba${transparent ? ",colorchannelmixer=aa=0" : ""},loop=loop=-1:size=1:start=0,settb=1/30,setpts=N,fps=30[background]`];
  if (!clip.deviceFrame || !geometry) {
    filters.push(`[background][screen]overlay=0:0:format=auto,format=${transparent ? "rgba" : "yuv420p"}[framed]`);
    return filters.join(";");
  }
  filters.push("[1:v]format=rgba,loop=loop=-1:size=1:start=0,settb=1/30,setpts=N,fps=30[bezel]", "[screen][bezel]overlay=0:0:format=auto[device]");
  const panels = devicePanelRects(geometry, clip.deviceFrame);
  if (panels.length > 1) filters.push(`[device]split=${panels.length}${panels.map((_, i) => `[panel${i}]`).join("")}`);
  panels.forEach((panel, i) => {
    const source = panels.length === 1 ? "device" : `panel${i}`;
    const viewport = devicePanelViewport(width, height, clip.deviceFrame!, panel,durationMs);
    filters.push(`[${source}]crop=${panel.width}:${panel.height}:${panel.x}:${panel.y},pad=${panel.width + 2}:${panel.height + 2}:1:1:color=black@0,scale=${viewport.width}:${viewport.height},${devicePerspectiveFilter(width, height, clip.deviceFrame!, panel, 30, 1, viewport,durationMs)}${clip.deviceFrame!.animation ? `,format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*${animationExpressions(clip.deviceFrame!.animation,"(T*1000)",durationMs,clip.deviceFrame!,"device").opacity}'` : ""}[warped${i}]`);
    const side = panel.x + panel.width / 2 < geometry.outer.x + geometry.outer.width / 2 ? -1 : 1;
    const visibility = facing(clip.deviceFrame!, "(t*1000)", height, side,durationMs);
    filters.push(`[${i === 0 ? "background" : `composite${i - 1}`}][warped${i}]overlay=${viewport.x}:${viewport.y}:format=auto:enable='gt(${visibility},0.015)'[composite${i}]`);
  });
  filters.push(`[composite${panels.length - 1}]format=${transparent ? "rgba" : "yuv420p"}[framed]`);
  return filters.join(";");
}
