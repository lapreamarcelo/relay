import type { DeviceFrame, VideoScene } from "@relay/core";
import type { DeviceFrameGeometry } from "./device-frames.ts";
import { defaultVideoScene, type ScenePoint } from "./video-scene.ts";

export interface MeshFace { vertices: ScenePoint[]; material: "body" | "glass" | "lens" | "accent"; side: number }
export interface DeviceMesh { faces: MeshFace[]; thickness: number }
export interface MeshProjection { screen: ScenePoint; camera: ScenePoint }
export type MeshProjector = (point: ScenePoint, side: number) => MeshProjection;

function ring(x: number,y: number,w: number,h: number,r: number,z: number): ScenePoint[] {
  const radius=Math.min(r,w/2,h/2), points: ScenePoint[]=[];
  for(const [cx,cy,start] of [[x+w-radius,y+radius,-90],[x+w-radius,y+h-radius,0],[x+radius,y+h-radius,90],[x+radius,y+radius,180]])
    for(let i=0;i<=6;i++) { const angle=(start+i*15)*Math.PI/180; points.push({x:cx+radius*Math.cos(angle),y:cy+radius*Math.sin(angle),z}); }
  return points;
}
function extrude(faces: MeshFace[],x: number,y: number,w: number,h: number,r: number,front: number,back: number,side: number,material: MeshFace["material"]="body") {
  const a=ring(x,y,w,h,r,front),b=ring(x,y,w,h,r,back);
  // Reversing the back preserves outward normals and real back-face visibility.
  faces.push({vertices:a,material,side},{vertices:[...b].reverse(),material,side});
  a.forEach((p,i)=>{const j=(i+1)%a.length;faces.push({vertices:[p,b[i],b[j],a[j]],material,side});});
}
/** Original procedural model, with no downloaded model or manufacturer assets.
 * Device-local coordinates are centered on the full body's hinge. */
export function createDeviceMesh(geometry: DeviceFrameGeometry,device: DeviceFrame["device"]): DeviceMesh {
  const {outer:o}=geometry,w=o.width,h=o.height,faces:MeshFace[]=[];
  const thickness=w*(device==="watch"?.13:device==="mac"?.023:device==="iphone-duo"?.03:device==="tablet"?.035:.055);
  const pieces=device==="iphone-duo"?[-1,1]:[0];
  for(const side of pieces) {
    const x=side===1?0:-w/2,pw=side?w/2:w,r=side?o.radius*.75:o.radius;
    extrude(faces,x,-h/2,pw,h,r,-.5,-thickness,side);
    if(!["browser","mac","watch"].includes(device)) {
      // Three raised rear lenses and their separate glass surfaces.
      const cx=x+pw*.2,cy=-h/2+pw*.22,lens=pw*(device==="tablet"?.045:.065);
      extrude(faces,cx-lens*1.8,cy-lens*1.8,lens*4.2,lens*4.2,lens*.8,-thickness-1,-thickness-lens*.2,side,"accent");
      for(const [dx,dy] of [[0,0],[lens*2,0],[0,lens*2]]) {
        extrude(faces,cx+dx-lens,cy+dy-lens,lens*2,lens*2,lens,-thickness-lens*.2,-thickness-lens*.42,side,"body");
        faces.push({vertices:ring(cx+dx-lens*.7,cy+dy-lens*.7,lens*1.4,lens*1.4,lens,-thickness-lens*.43).reverse(),material:"lens",side});
      }
      extrude(faces,x+pw-1,-h*.21,thickness*.23,h*.12,1,-thickness*.25,-thickness*.75,side,"accent");
      extrude(faces,x-thickness*.18,-h*.3,thickness*.23,h*.085,1,-thickness*.25,-thickness*.75,side,"accent");
    }
  }
  if(device==="watch") {
    for(const direction of [-1,1]) extrude(faces,-w*.27,direction===-1?-h*.84:h/2,w*.54,h*.34,w*.08,-thickness*.25,-thickness*.55,0,"accent");
    extrude(faces,w/2-1,-h*.18,thickness*.7,h*.11,h*.04,-thickness*.18,-thickness*.78,0,"accent");
  }
  if(device==="mac") {
    // A keyboard deck extends toward the viewer from the lower screen hinge.
    const y=h/2,z=w*.23;
    const top=[{x:-w*.53,y:y+thickness,z:0},{x:w*.53,y:y+thickness,z:0},{x:w*.58,y:y+thickness*2,z},{x:-w*.58,y:y+thickness*2,z}];
    faces.push({vertices:top,material:"body",side:0},{vertices:top.map(p=>({...p,y:p.y+thickness})).reverse(),material:"accent",side:0});
    for(let i=0;i<4;i++) {const j=(i+1)%4;faces.push({vertices:[top[j],top[i],{...top[i],y:top[i].y+thickness},{...top[j],y:top[j].y+thickness}],material:"body",side:0});}
    for(let row=0;row<4;row++) for(let col=0;col<12;col++) {
      const x=-w*.43+col*w*.073,depth=w*.025+row*w*.026;
      faces.push({vertices:[{x,y:y+thickness-.1,z:depth},{x:x+w*.058,y:y+thickness-.1,z:depth},{x:x+w*.058,y:y+thickness-.1,z:depth+w*.018},{x,y:y+thickness-.1,z:depth+w*.018}],material:"glass",side:0});
    }
  }
  return {faces,thickness};
}
const minus=(a:ScenePoint,b:ScenePoint):ScenePoint=>({x:a.x-b.x,y:a.y-b.y,z:a.z-b.z});
const cross=(a:ScenePoint,b:ScenePoint):ScenePoint=>({x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x});
const dot=(a:ScenePoint,b:ScenePoint)=>a.x*b.x+a.y*b.y+a.z*b.z;
const unit=(p:ScenePoint):ScenePoint=>{const n=Math.hypot(p.x,p.y,p.z)||1;return{x:p.x/n,y:p.y/n,z:p.z/n};};
const rgb=(hex:string)=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
const environments={studio:{ambient:.38,color:[242,247,255],light:.8},softbox:{ambient:.58,color:[255,248,235],light:.55},sunset:{ambient:.3,color:[255,157,95],light:1},night:{ambient:.12,color:[105,154,255],light:.65}};
function litMaterial(material:MeshFace["material"],normal:ScenePoint,center:ScenePoint,frame:DeviceFrame,scene:VideoScene,cameraDistance:number): string {
  const env=environments[scene.environment],angle=scene.lightAngle*Math.PI/180,light=unit({x:Math.sin(angle),y:-.65,z:Math.cos(angle)});
  const view=unit({x:-center.x,y:-center.y,z:cameraDistance-center.z});
  const lambert=Math.max(0,dot(normal,light)),half=unit({x:light.x+view.x,y:light.y+view.y,z:light.z+view.z});
  const specular=Math.pow(Math.max(0,dot(normal,half)),4+(1-scene.roughness)*100)*(1-scene.roughness*.8);
  const fresnel=Math.pow(1-Math.max(0,dot(normal,view)),3);
  const reflection=(specular*.65+fresnel*.24)*scene.metallic;
  const base=material==="lens"?[13,25,43]:material==="glass"?[12,14,19]:material==="accent"?rgb(frame.color).map(c=>c*.6):rgb(frame.color);
  return `rgb(${base.map((c,i)=>Math.round(Math.min(255,Math.max(0,(c*(env.ambient+lambert*env.light)+env.color[i]*reflection)*scene.exposure)))).join(",")})`;
}
export interface ProjectedMeshFace { points: ScenePoint[]; depth: number; color: string; material: MeshFace["material"] }
export function projectDeviceMesh(mesh:DeviceMesh,project:MeshProjector,frame:DeviceFrame,scene:VideoScene=defaultVideoScene,cameraDistance=3000):ProjectedMeshFace[] {
  const result:ProjectedMeshFace[]=[];
  for(const face of mesh.faces) {
    const points=face.vertices.map(p=>project(p,face.side)),camera=points.map(p=>p.camera);
    const normal=unit(cross(minus(camera[1],camera[0]),minus(camera[2],camera[0])));
    // Ring winding in screen (Y down) gives front faces +Z.
    const center=camera.reduce((a,p)=>({x:a.x+p.x/camera.length,y:a.y+p.y/camera.length,z:a.z+p.z/camera.length}),{x:0,y:0,z:0});
    if(dot(normal,{x:-center.x,y:-center.y,z:cameraDistance-center.z})<=0) continue;
    result.push({points:points.map(p=>p.screen),depth:center.z,color:litMaterial(face.material,normal,center,frame,scene,cameraDistance),material:face.material});
  }
  return result.sort((a,b)=>a.depth-b.depth);
}
/** Transparent projected body; append the shared projected video/glass panels
 * above it. Faces carry actual normals, lighting, depth and back-face culling. */
export function renderDeviceMeshSvg(width:number,height:number,faces:ProjectedMeshFace[],scene:VideoScene=defaultVideoScene,blur=0):string {
  const polygons=faces.map(face=>`<polygon data-material="${face.material}" points="${face.points.map(p=>`${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(" ")}" fill="${face.color}" stroke="${face.color}" stroke-width=".35"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><filter id="mesh-focus" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${blur}"/></filter><filter id="mesh-shadow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${Math.max(width,height)*.013}"/></filter></defs>${scene.shadow?`<g transform="translate(${Math.sin(scene.lightAngle*Math.PI/180)*height*.015} ${height*.018})" opacity="${scene.shadow}" filter="url(#mesh-shadow)">${faces.map(f=>`<polygon points="${f.points.map(p=>`${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(" ")}" fill="#000"/>`).join("")}</g>`:""}<g${blur?` filter="url(#mesh-focus)"`:""}>${polygons}</g></svg>`;
}
