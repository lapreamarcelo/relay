import type { DeviceFrame, VideoClip } from "@relay/core";
import { animationExpressions, animationEase } from "./video-animation.ts";
import { deviceBackgroundCss, deviceFrameGeometry, type DeviceFrameGeometry } from "./device-frames.ts";

import { sceneCameraState, sceneCameraPoint, sceneProjectPoint, rotateScenePoint, sceneFocusBlur, sceneShutterSamples, defaultVideoScene, type ScenePoint } from "./video-scene.ts";
import { createDeviceMesh, projectDeviceMesh, renderDeviceMeshSvg } from "./device-mesh.ts";

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
  /** Body sheets sit behind the front glass; these values also drive export. */
  depth?: number;
  shade?: number;
  screen?: "inner" | "outer";
  screenRect?: DevicePanelRect & {radius:number};
}
export interface DeviceScene {
  geometry: DeviceFrameGeometry;
  panels: DevicePanel[];
  bodyPanels: DevicePanel[];
  background: string;
  opacity: number;
  meshSvg?: string;
  meshBounds?: DevicePanelRect;
  focusBlur?: number;
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

/** The GPU and software paths evaluate the same authored object clock. */
export function devicePose(frame:DeviceFrame,timeMs:number,height:number,durationMs:number) {
  return pose(frame,timeMs,height,durationMs);
}

function project(width: number, height: number, frame: DeviceFrame, geometry: DeviceFrameGeometry, timeMs: Scalar, point: DevicePoint, side: number, durationMs?: number, bodyDepth = 0, sceneTimeMs: Scalar = timeMs): { x: Scalar; y: Scalar } {
  if (frame.renderMode === "mesh") return meshProjectPoint(width,height,frame,geometry,timeMs,{x:point.x-geometry.outer.x-geometry.outer.width/2,y:point.y-geometry.outer.y-geometry.outer.height/2,z:bodyDepth},side,durationMs,sceneTimeMs).screen;
  const p = pose(frame, timeMs, height, durationMs), scale = p.animated.scale;
  const localX = mul(point.x - geometry.outer.x - geometry.outer.width / 2, scale);
  const localY = mul(point.y - geometry.outer.y - geometry.outer.height / 2, scale);
  // Each half rotates around the same center hinge; video remains on the two planes.
  const localZ = mul(bodyDepth, scale);
  const foldedX = add(mul(localX, cos(mul(.5, p.fold))), neg(mul(mul(localZ, side), sin(mul(.5, p.fold)))));
  const foldedZ = add(mul(mul(localX,side), sin(mul(.5, p.fold))), mul(localZ, cos(mul(.5, p.fold))));
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

/** A single vertex pipeline for polygon mesh, CSS glass homographies and FFmpeg. */
function meshProjectPoint(width:number,height:number,frame:DeviceFrame,geometry:DeviceFrameGeometry,timeMs:Scalar,point:ScenePoint,side:number,durationMs=4000,sceneTimeMs:Scalar=timeMs,preparedPose?:ReturnType<typeof pose>) {
  const p=preparedPose ?? pose(frame,timeMs,height,durationMs),scale=p.animated.scale;
  const folded=rotateScenePoint({x:mul(point.x,scale),y:mul(point.y,scale),z:mul(point.z,scale)},0,mul(-side*.5,p.fold),0);
  const rotated=rotateScenePoint(folded,p.rx,p.ry,p.rz);
  const world={x:add(rotated.x,mul(width,add(p.animated.x,-.5))),y:add(add(rotated.y,mul(height,add(p.animated.y,-.5))),p.dy),z:add(rotated.z,mul(p.animated.depth,Math.max(width,height)))};
  return {screen:sceneProjectPoint(world,width,height,frame.scene,sceneTimeMs),camera:sceneCameraPoint(world,width,height,frame.scene,sceneTimeMs)};
}
/** Body bounds remain selectable when all recording surfaces face away. */
export function deviceMeshBounds(width:number,height:number,frame:DeviceFrame,timeMs=0,durationMs=frame.motionDurationMs ?? 4000,sceneTimeMs=timeMs):DevicePanelRect {
  const geometry=deviceFrameGeometry(width,height,frame.device),mesh=createDeviceMesh(geometry,frame.device),p=pose(frame,timeMs,height,durationMs);
  const points=mesh.faces.flatMap(face=>face.vertices.map(point=>meshProjectPoint(width,height,frame,geometry,timeMs,point,face.side,durationMs,sceneTimeMs,p).screen as ScenePoint));
  const x=Math.min(...points.map(p=>p.x)),y=Math.min(...points.map(p=>p.y)),right=Math.max(...points.map(p=>p.x)),bottom=Math.max(...points.map(p=>p.y));
  return {x,y,width:right-x,height:bottom-y};
}
/** Render local pose at timeMs, shared camera at sceneTimeMs. This is already
 * projected output SVG: export must NOT perspective-warp this body input. */
export function deviceMeshSvg(width:number,height:number,frame:DeviceFrame,timeMs=0,durationMs=frame.motionDurationMs ?? 4000,sceneTimeMs=timeMs,fps=30):string {
  const geometry=deviceFrameGeometry(width,height,frame.device),mesh=createDeviceMesh(geometry,frame.device),scene=frame.scene ?? defaultVideoScene;
  const samples=sceneShutterSamples(scene,timeMs,fps);
  const rendered=samples.map(sample=>{
    const globalTime=Math.max(0,sceneTimeMs+sample.timeMs-timeMs),cameraPose=sceneCameraState(scene,globalTime);
    const frozenFrame={...frame,scene:{...scene,camera:{...scene.camera,x:cameraPose.x,y:cameraPose.y,z:cameraPose.z,rotateX:cameraPose.rotateX as number,rotateY:cameraPose.rotateY as number,rotateZ:cameraPose.rotateZ as number,focalLength:cameraPose.focalLength*cameraPose.scale,keyframes:undefined}}};
    const devicePose=pose(frame,sample.timeMs,height,durationMs);
    const faces=projectDeviceMesh(mesh,(point,side)=>meshProjectPoint(width,height,frozenFrame,geometry,sample.timeMs,point,side,durationMs,globalTime,devicePose) as {screen:ScenePoint;camera:ScenePoint},frame,scene,Math.max(width,height)*3);
    const svg=renderDeviceMeshSvg(width,height,faces,scene,sceneFocusBlur(scene,devicePose.animated.depth as number,width,height));
    return {svg,weight:sample.weight};
  });
  if(rendered.length===1) return rendered[0].svg;
  const definitions=rendered.map((r,i)=>r.svg.replace(/^<svg /,`<svg id="shutter-image${i}" `).replaceAll('id="mesh-',`id="mesh-${i}-`).replaceAll('url(#mesh-',`url(#mesh-${i}-`)).join("");
  const images=rendered.map((r,i)=>`<feImage href="#shutter-image${i}" x="0" y="0" width="${width}" height="${height}" result="image${i}"/><feColorMatrix in="image${i}" type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 ${r.weight} 0" result="sample${i}"/>`).join("");
  const sums=rendered.slice(1).map((_,i)=>`<feComposite in="${i===0?"sample0":`sum${i-1}`}" in2="sample${i+1}" operator="arithmetic" k2="1" k3="1" result="sum${i}"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs>${definitions}<filter id="mesh-shutter" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">${images}${sums}</filter></defs><rect width="100%" height="100%" fill="transparent" filter="url(#mesh-shutter)"/></svg>`;
}

function facing(frame: DeviceFrame, timeMs: Scalar, height: number, side: number, durationMs?: number, width = height, sceneTimeMs: Scalar = timeMs): Scalar {
  const p = pose(frame, timeMs, height,durationMs);
  if(frame.renderMode === "mesh") {
    const normal=rotateScenePoint(rotateScenePoint({x:0,y:0,z:1},0,mul(-side*.5,p.fold),0),p.rx,p.ry,p.rz);
    const c=animationExpressions({keyframes:frame.scene?.camera.keyframes},sceneTimeMs,86400000,{...frame.scene?.camera,scale:1},"device");
    const n=rotateScenePoint(normal,mul(c.rotateX,-Math.PI/180),mul(c.rotateY,-Math.PI/180),mul(c.rotateZ,-Math.PI/180));
    const geometry=deviceFrameGeometry(width,height,frame.device),center=meshProjectPoint(width,height,frame,geometry,timeMs,{x:side*geometry.outer.width/4,y:0,z:0},side,durationMs,sceneTimeMs).camera;
    const camera=Math.max(width,height)*3;
    return div(add(add(mul(n.x,neg(center.x)),mul(n.y,neg(center.y))),mul(n.z,add(camera,neg(center.z)))),camera);
  }
  return add(mul(side, mul(sin(mul(.5, p.fold)), sin(p.ry))), mul(cos(mul(.5, p.fold)), mul(cos(p.rx), cos(p.ry))));
}

export function devicePanelRects(geometry: DeviceFrameGeometry, frame: DeviceFrame): DevicePanelRect[] {
  const { x, y, width, height } = geometry.outer;
  if (frame.device !== "iphone-duo") return [{ x, y, width, height }];
  const left = Math.floor(width / 2);
  return [{ x, y, width: left, height }, { x: x + left, y, width: width - left, height }];
}
interface DeviceSurface { rect:DevicePanelRect; side:number; depth:number; rear:boolean; screen:"inner"|"outer"; screenRect?:DevicePanel["screenRect"] }
function deviceSurfaces(geometry:DeviceFrameGeometry,frame:DeviceFrame):DeviceSurface[] {
  const front=devicePanelRects(geometry,frame).map(rect=>({rect,side:rect.x+rect.width/2<geometry.outer.x+geometry.outer.width/2?-1:1,depth:0,rear:false,screen:frame.device === "iphone-duo"?"inner" as const:"outer" as const}));
  if(frame.renderMode !== "mesh" || frame.device !== "iphone-duo") return front;
  const rect=front[1].rect,b=geometry.border,top=Math.round(rect.y+rect.width*.5);
  return [...front,{rect,side:1,depth:-createDeviceMesh(geometry,frame.device).thickness-.4,rear:true,screen:"outer",screenRect:{x:rect.x+b,y:top,width:rect.width-b*2,height:rect.y+rect.height-b-top,radius:geometry.screen.radius}}];
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

/** Project directly in preview pixels. Scaling a full-resolution scene after
 * its perspective warp makes browsers resample an already flattened texture. */
export function devicePanelAtScale(panel: DevicePanel, scale: number): DevicePanel {
  const rect = { x: panel.rect.x * scale, y: panel.rect.y * scale, width: panel.rect.width * scale, height: panel.rect.height * scale };
  const corners = panel.corners.map(point => ({ x: point.x * scale, y: point.y * scale })) as DevicePanel["corners"];
  return { ...panel, rect, corners, transform: devicePanelTransform(rect, corners) };
}

export function deviceScene(width: number, height: number, frame: DeviceFrame, timeMs = 0, durationMs = frame.motionDurationMs ?? 4000, sceneTimeMs = timeMs, fps=30): DeviceScene {
  const geometry = deviceFrameGeometry(width, height, frame.device);
  const panels = deviceSurfaces(geometry, frame).map(surface => {
    const {rect,side,depth,rear}=surface;
    const points=rectCorners(rect);if(rear) { [points[0],points[1]]=[points[1],points[0]];[points[2],points[3]]=[points[3],points[2]]; }
    const corners=points.map(point=>project(width,height,frame,geometry,Math.max(0,timeMs),point,side,durationMs,depth,sceneTimeMs)) as DevicePanel["corners"];
    return {rect,corners,transform:devicePanelTransform(rect,corners),screen:surface.screen,screenRect:surface.screenRect,visible:(facing(frame,Math.max(0,timeMs),height,side,durationMs,width,sceneTimeMs) as number)*(rear?-1:1)>.015};
  });
  const bodyPanels = deviceBodySheets(geometry, frame).flatMap(sheet => panels.map(panel => {
    const side = panel.rect.x + panel.rect.width / 2 < geometry.outer.x + geometry.outer.width / 2 ? -1 : 1;
    const corners = rectCorners(panel.rect).map(point => project(width, height, frame, geometry, Math.max(0,timeMs), point, side, durationMs, sheet.depth)) as DevicePanel["corners"];
    return { ...panel, corners, transform: devicePanelTransform(panel.rect, corners), ...sheet };
  }));
  return { geometry, panels, bodyPanels, ...(frame.renderMode === "mesh" ? {meshSvg:deviceMeshSvg(width,height,frame,timeMs,durationMs,sceneTimeMs,fps),meshBounds:deviceMeshBounds(width,height,frame,timeMs,durationMs,sceneTimeMs),focusBlur:sceneFocusBlur(frame.scene,pose(frame,timeMs,height,durationMs).animated.depth as number,width,height)} : {}), background: deviceBackgroundCss(frame), opacity: pose(frame,Math.max(0,timeMs),height,durationMs).animated.opacity as number };
}

/** Overlapping rounded planes form a bounded extrusion. This is a perspective
 * body, not a mesh model: rotations stay within the supported front-facing range. */
function deviceBodySheets(geometry: DeviceFrameGeometry, frame: DeviceFrame): Array<{ depth: number; shade: number }> {
  if (frame.device === "browser" || frame.renderMode === "mesh") return [];
  const tilted = frame.rotateX || frame.rotateY || frame.foldAngle || ["orbit","fold","unfold","fold-cycle"].includes(frame.motion ?? "none") || frame.animation?.keyframes?.some(key => key.rotateX || key.rotateY || key.foldAngle);
  // A face-on body's silhouette is completely covered by the glass. Avoid the
  // extra preview layers and export warps for simple labels/static mockups.
  if (!tilted) return [];
  const thickness = geometry.outer.width * (frame.device === "watch" ? .085 : frame.device === "iphone-duo" ? .025 : .045);
  return [{ depth: -thickness, shade: .64 }, { depth: -thickness * .42, shade: 1 }];
}

/** The panel input is stretched to the canvas before this warp. An alpha-zero
 * guard pixel around the panel prevents FFmpeg's edge extension filling the canvas.
 * FFmpeg's perspective on counter starts at one, after fps=30. Subtracting one
 * makes the first exported frame match preview local time zero. */
export function devicePerspectiveFilter(width: number, height: number, frame: DeviceFrame, panel: DevicePanelRect, fps = 30, guard = 1, viewport: DevicePanelRect = { x: 0, y: 0, width, height }, durationMs = frame.motionDurationMs ?? 4000, bodyDepth = 0, sceneTimeOffsetMs = 0, motionTimeOffsetMs = 0, rear=false): string {
  const geometry = deviceFrameGeometry(width, height, frame.device);
  const expanded = { x: panel.x - guard, y: panel.y - guard, width: panel.width + guard * 2, height: panel.height + guard * 2 };
  const side = panel.x + panel.width / 2 < geometry.outer.x + geometry.outer.width / 2 ? -1 : 1;
  const sourceCorners=rectCorners(expanded);if(rear){[sourceCorners[0],sourceCorners[1]]=[sourceCorners[1],sourceCorners[0]];[sourceCorners[2],sourceCorners[3]]=[sourceCorners[3],sourceCorners[2]];}
  const points = sourceCorners.map(point => project(width, height, frame, geometry, `max(0,((on-1)/${fps}*1000)+${motionTimeOffsetMs})`, point, side,durationMs,bodyDepth,`max(0,((on-1)/${fps}*1000)+${sceneTimeOffsetMs})`));
  return `perspective=${points.map((point, index) => `x${index}='${add(point.x, -viewport.x)}':y${index}='${add(point.y, -viewport.y)}'`).join(":")}:sense=destination:eval=frame:interpolation=linear`;
}

/** Conservative output bounds for a complete preset cycle. Perspective maps are
 * generated only for this region, avoiding two full-HD warps for small panels.
 * Fixed dense sampling plus a guard covers the smooth, bounded preset curves. */
export function devicePanelViewport(width: number, height: number, frame: DeviceFrame, panel: DevicePanelRect, durationMs = frame.motionDurationMs ?? 4000, bodyDepth = 0, sceneTimeOffsetMs = 0): DevicePanelRect {
  const geometry = deviceFrameGeometry(width, height, frame.device);
  if(frame.renderMode === "mesh") return {x:0,y:0,width,height};
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
      const p = project(width, height, frame, geometry, t, corner, side,durationMs,bodyDepth);
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
 * Optional bodyInput is a deviceBodyLayerSvg PNG; its rear sheets use the same
 * projection and animation as the glass. Existing callers can omit the body.
 * Source and frame are composited before splitting/warping, so screen media
 * follows exactly the same geometry as the bezel in both preview and export. */
export function deviceVideoSceneFilter(width: number, height: number, clip: VideoClip, backgroundInput: number, durationMs = clip.outMs-clip.inMs, transparent = false, bodyInput?: number, sceneTimeOffsetMs = 0, sourceInput = "0:v", fps = 30, panelSourceInputs?:{inner?:string;outer?:string}): string {
  const motionOffsetMs=clip.motionOffsetMs ?? 0;
  const geometry = clip.deviceFrame ? deviceFrameGeometry(width, height, clip.deviceFrame.device) : undefined;
  const tw = geometry?.screen.width ?? width, th = geometry?.screen.height ?? height;
  const sw = Math.ceil(tw * clip.zoom / 2) * 2, sh = Math.ceil(th * clip.zoom / 2) * 2;
  const fit = clip.fit === "cover"
    ? `scale=${sw}:${sh}:force_original_aspect_ratio=increase,crop=${tw}:${th}:(iw-ow)*${clip.x}:(ih-oh)*${clip.y}`
    : `scale=${tw}:${th}:force_original_aspect_ratio=decrease,pad=${tw}:${th}:(ow-iw)*${clip.x}:(oh-ih)*${clip.y}:color=${geometry ? "black" : "black@0"}`;
  const surfaces=clip.deviceFrame && geometry ? deviceSurfaces(geometry,clip.deviceFrame):[];
  const rearSurface=surfaces.find(s=>s.rear);
  let frontSource=panelSourceInputs?.inner ?? sourceInput,outerSource=panelSourceInputs?.outer ?? sourceInput;
  const sourcePrefix:string[]=[];
  if(rearSurface && frontSource===outerSource) { sourcePrefix.push(`[${frontSource}]split=2[meshFrontSource][meshRearSource]`);frontSource="meshFrontSource";outerSource="meshRearSource"; }
  const filters = [...sourcePrefix,`[${frontSource}]format=rgba,${fit},setsar=1,fps=${fps},setpts=PTS-STARTPTS${geometry ? `,pad=${width}:${height}:${geometry.screen.x}:${geometry.screen.y}:color=black@0` : ""}[screen]`, `[${backgroundInput}:v]format=rgba${transparent ? ",colorchannelmixer=aa=0" : ""},loop=loop=-1:size=1:start=0,settb=1/${fps},setpts=N,fps=${fps}[background]`];
  if (!clip.deviceFrame || !geometry) {
    filters.push(`[background][screen]overlay=0:0:format=auto,format=${transparent ? "rgba" : "yuv420p"}[framed]`);
    return filters.join(";");
  }
  const focusBlur = clip.deviceFrame.renderMode === "mesh" ? sceneFocusBlur(clip.deviceFrame.scene,pose(clip.deviceFrame,motionOffsetMs,height,durationMs).animated.depth as number,width,height) : 0;
  const focusAnimated=clip.deviceFrame.renderMode === "mesh" && !!clip.deviceFrame.scene?.aperture && clip.deviceFrame.animation?.keyframes?.some(k=>k.depth !== undefined);
  filters.push(`[1:v]format=rgba,loop=loop=-1:size=1:start=0,settb=1/${fps},setpts=N,fps=${fps}[bezel]`, "[screen][bezel]overlay=0:0:format=auto[device]");
  const opacity = animationExpressions(clip.deviceFrame.animation,`(T*1000+${motionOffsetMs})`,durationMs,clip.deviceFrame,"device").opacity;
  const fade = opacity !== 1;
  // Fade the completed device once, matching preview group opacity. Fading each
  // overlapping sheet both compounds alpha and repeats expensive RGB evaluation.
  if (fade && !transparent) filters.push("[background]split=2[canvasBackground][deviceCanvas]", "[deviceCanvas]colorchannelmixer=aa=0[deviceBase]");
  const base = fade && !transparent ? "deviceBase" : "background";
  const panels=surfaces.map(s=>s.rect);
  if(rearSurface?.screenRect) {
    const r=rearSurface.screenRect,sw=Math.ceil(r.width*clip.zoom/2)*2,sh=Math.ceil(r.height*clip.zoom/2)*2;
    const fit=clip.fit === "cover" ? `scale=${sw}:${sh}:force_original_aspect_ratio=increase,crop=${r.width}:${r.height}:(iw-ow)*${clip.x}:(ih-oh)*${clip.y}` : `scale=${r.width}:${r.height}:force_original_aspect_ratio=decrease,pad=${r.width}:${r.height}:(ow-iw)*${clip.x}:(oh-ih)*${clip.y}:color=black`;
    const radius=Math.min(r.radius,r.width/2,r.height/2),dx=`max(0,abs(X-${r.width/2})-${r.width/2-radius})`,dy=`max(0,abs(Y-${r.height/2})-${r.height/2-radius})`;
    const mask=`geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*lte(${dx}*${dx}+${dy}*${dy},${radius*radius})'`;
    filters.push(`[${outerSource}]format=rgba,${fit},setsar=1,fps=${fps},setpts=PTS-STARTPTS,${mask},pad=${width}:${height}:${r.x}:${r.y}:color=black@0[rearDevice]`);
  }
  const viewports: DevicePanelRect[] = [];
  const sheets = bodyInput === undefined ? [] : deviceBodySheets(geometry, clip.deviceFrame);
  const meshBody = clip.deviceFrame.renderMode === "mesh" && bodyInput !== undefined;
  if(meshBody) filters.push(`[${bodyInput}:v]format=rgba,setpts=PTS-STARTPTS,fps=${fps}[meshBody]`, `[${base}][meshBody]overlay=0:0:format=auto[meshBase]`);
  const bodyCount = sheets.length * panels.length;
  if (bodyCount) {
    filters.push(`[${bodyInput}:v]format=rgba,loop=loop=-1:size=1:start=0,settb=1/${fps},setpts=N,fps=${fps},split=${bodyCount}${Array.from({length:bodyCount},(_,i)=>`[body${i}]`).join("")}`);
    sheets.forEach((sheet, sheetIndex) => panels.forEach((panel, panelIndex) => {
      const index = sheetIndex * panels.length + panelIndex;
      const viewport = motionOffsetMs ? {x:0,y:0,width,height} : devicePanelViewport(width,height,clip.deviceFrame!,panel,durationMs,sheet.depth);
      viewports.push(viewport);
      filters.push(`[body${index}]crop=${panel.width}:${panel.height}:${panel.x}:${panel.y},pad=${panel.width+2}:${panel.height+2}:1:1:color=black@0,colorchannelmixer=rr=${sheet.shade}:gg=${sheet.shade}:bb=${sheet.shade},scale=${viewport.width}:${viewport.height},${devicePerspectiveFilter(width,height,clip.deviceFrame!,panel,fps,1,viewport,durationMs,sheet.depth,sceneTimeOffsetMs,motionOffsetMs)}[bodywarped${index}]`);
      const side=panel.x+panel.width/2<geometry.outer.x+geometry.outer.width/2?-1:1;
      const visibility=facing(clip.deviceFrame!,`(t*1000+${motionOffsetMs})`,height,side,durationMs);
      filters.push(`[${index===0?base:`bodycomposite${index-1}`}][bodywarped${index}]overlay=${viewport.x}:${viewport.y}:format=auto:enable='gt(${visibility},0.015)'[bodycomposite${index}]`);
    }));
  }
  const blurAmount=clip.deviceFrame.renderMode === "mesh" ? clip.deviceFrame.scene?.motionBlur ?? 0 : 0;
  const sampleOffsets=blurAmount ? Array.from({length:5},(_,i)=>(i/4-.5)*1000/fps*blurAmount) : [0];
  const frontPanelCount=surfaces.filter(s=>!s.rear).length;
  const sourceCount=frontPanelCount*sampleOffsets.length;
  if(sourceCount>1) filters.push(`[device]split=${sourceCount}${Array.from({length:sourceCount},(_,i)=>`[panelSource${i}]`).join("")}`);
  if(rearSurface && sampleOffsets.length>1) filters.push(`[rearDevice]split=${sampleOffsets.length}${sampleOffsets.map((_,i)=>`[rearSource${i}]`).join("")}`);
  panels.forEach((panel, i) => {
    const surface=surfaces[i];
    const viewport = motionOffsetMs ? {x:0,y:0,width,height} : devicePanelViewport(width, height, clip.deviceFrame!, panel,durationMs);
    viewports.push(viewport);
    sampleOffsets.forEach((offset,sampleIndex)=>{
      const source=surface.rear?(sampleOffsets.length===1?"rearDevice":`rearSource${sampleIndex}`):sourceCount===1?"device":`panelSource${i*sampleOffsets.length+sampleIndex}`;
      filters.push(`[${source}]crop=${panel.width}:${panel.height}:${panel.x}:${panel.y},pad=${panel.width+2}:${panel.height+2}:1:1:color=black@0,scale=${viewport.width}:${viewport.height},${devicePerspectiveFilter(width,height,clip.deviceFrame!,panel,fps,1,viewport,durationMs,surface.depth,sceneTimeOffsetMs+offset,motionOffsetMs+offset,surface.rear)}[sampleWarp${i}_${sampleIndex}]`);
      if(sampleIndex>0) filters.push(`[${sampleIndex===1?`sampleWarp${i}_0`:`sampleBlend${i}_${sampleIndex-1}`}][sampleWarp${i}_${sampleIndex}]blend=all_expr='A*${sampleIndex/(sampleIndex+1)}+B*${1/(sampleIndex+1)}'[sampleBlend${i}_${sampleIndex}]`);
    });
    let warped = sampleOffsets.length===1?`sampleWarp${i}_0`:`sampleBlend${i}_${sampleOffsets.length-1}`;
    if(focusAnimated) {
      const frames=Math.ceil((clip.outMs-clip.inMs)/(clip.speed ?? 1)/1000*fps);
      const commands=Array.from({length:frames},(_,n)=>{
        const local=n/fps*1000+motionOffsetMs;
        const blur=sceneFocusBlur(clip.deviceFrame!.scene,pose(clip.deviceFrame!,local,height,durationMs).animated.depth as number,width,height);
        return `${(n/fps).toFixed(7)} gblur@deviceFocus${i} sigma ${blur.toFixed(6)}`;
      }).join(";");
      filters.push(`[${warped}]sendcmd=c='${commands}',gblur@deviceFocus${i}=sigma=${focusBlur}[focused${i}]`);warped=`focused${i}`;
    } else if(focusBlur > .01) { filters.push(`[${warped}]gblur=sigma=${focusBlur}[focused${i}]`); warped=`focused${i}`; }
    const side = panel.x + panel.width / 2 < geometry.outer.x + geometry.outer.width / 2 ? -1 : 1;
    const visibility = facing(clip.deviceFrame!, `(t*1000+${motionOffsetMs})`, height, side,durationMs,width,`(t*1000+${sceneTimeOffsetMs})`);
    filters.push(`[${i === 0 ? bodyCount ? `bodycomposite${bodyCount-1}` : meshBody ? "meshBase" : base : `composite${i - 1}`}][${warped}]overlay=${viewport.x}:${viewport.y}:format=auto:enable='gt(${mul(visibility,surface.rear?-1:1)},0.015)'[composite${i}]`);
  });
  const composite = `composite${panels.length - 1}`;
  if (fade) {
    const x=Math.min(...viewports.map(v=>v.x)),y=Math.min(...viewports.map(v=>v.y));
    const w=Math.max(...viewports.map(v=>v.x+v.width))-x,h=Math.max(...viewports.map(v=>v.y+v.height))-y;
    filters.push(`[${composite}]crop=${w}:${h}:${x}:${y},format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*${opacity}',pad=${width}:${height}:${x}:${y}:color=black@0[fadedDevice]`);
    filters.push(transparent ? "[fadedDevice]format=rgba[framed]" : "[canvasBackground][fadedDevice]overlay=0:0:format=auto,format=yuv420p[framed]");
  } else filters.push(`[${composite}]format=${transparent ? "rgba" : "yuv420p"}[framed]`);
  return filters.join(";");
}
