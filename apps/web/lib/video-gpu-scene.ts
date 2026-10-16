import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { BokehPass } from "three/addons/postprocessing/BokehPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import type { DeviceFrame, VideoClip, VideoTimeline } from "@relay/core";
import { deviceModel, isGpuFrame, modelAssetPath } from "./device-model-catalog.ts";
import { deviceFrameGeometry } from "./device-frames.ts";
import {animationState,animationEase} from "./video-animation.ts";
import {videoSizes} from "./video-timeline.ts";
import { devicePose } from "./device-motion.ts";
import { clipSchedule, layerSchedule, clipMotionTime, clipMotionDuration, clipSourceTime } from "./video-timeline.ts";
import { defaultVideoScene, sceneCameraState, sceneShutterSamples } from "./video-scene.ts";
import { pointerSvg } from "./video-pointer.ts";
import {mediaPreviewUrl} from "./browser-library-media.ts";
import { animatedLabelsMarkup } from "./animated-label-markup.ts";

type Surface={mesh:THREE.Mesh; canvas:HTMLCanvasElement; texture:THREE.CanvasTexture; screen?:"inner"|"outer";half?:-1|1};
function releaseObject(object:THREE.Object3D){object.traverse(node=>{if(node instanceof THREE.Mesh){node.geometry.dispose();for(const material of Array.isArray(node.material)?node.material:[node.material]){for(const value of Object.values(material))if(value instanceof THREE.Texture)value.dispose();material.dispose();}}});}
type ObjectState={clip:VideoClip; group:THREE.Group; surfaces:Surface[]; hinges:THREE.Group[]; media:HTMLImageElement|HTMLVideoElement; pointer?:HTMLImageElement; lastPointer?:string; opacity:number};
const materials=(object:THREE.Object3D)=>{const found=new Set<THREE.Material>();object.traverse(node=>{if(node instanceof THREE.Mesh)for(const material of Array.isArray(node.material)?node.material:[node.material])found.add(material);});return [...found];};
const roundedShape=(w:number,h:number,r:number)=>{const shape=new THREE.Shape(),x=-w/2,y=-h/2;shape.moveTo(x+r,y);shape.lineTo(x+w-r,y);shape.quadraticCurveTo(x+w,y,x+w,y+r);shape.lineTo(x+w,y+h-r);shape.quadraticCurveTo(x+w,y+h,x+w-r,y+h);shape.lineTo(x+r,y+h);shape.quadraticCurveTo(x,y+h,x,y+h-r);shape.lineTo(x,y+r);shape.quadraticCurveTo(x,y,x+r,y);return shape;};
function panel(w:number,h:number,r:number):Surface {
 const canvas=document.createElement("canvas");canvas.width=1024;canvas.height=Math.max(64,Math.min(2048,Math.round(1024*h/w)));
 const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;
 const geometry=new THREE.ShapeGeometry(roundedShape(w,h,r),24),pos=geometry.attributes.position,uv=geometry.attributes.uv;
 for(let i=0;i<uv.count;i++)uv.setXY(i,(pos.getX(i)+w/2)/w,(pos.getY(i)+h/2)/h);
 return {mesh:new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({map:texture,toneMapped:false,side:THREE.FrontSide,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1})),canvas,texture};
}
async function loadedImage(src:string):Promise<HTMLImageElement>{
 const image=new Image();image.crossOrigin="anonymous";image.src=src;
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{await Promise.race([image.decode(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error("Image loading timed out.")),20000);})]);return image;}
 catch(error){image.removeAttribute("src");throw error;}finally{clearTimeout(timer);}
}
async function loadMediaDirect(clip:VideoClip):Promise<HTMLImageElement|HTMLVideoElement>{
 if(clip.kind==="image")return loadedImage(clip.sourceUrl);
 const video=document.createElement("video");video.crossOrigin="anonymous";video.muted=true;video.playsInline=true;video.preload="auto";video.src=clip.sourceUrl;
 try{await new Promise<void>((resolve,reject)=>{
  const cleanup=()=>{clearTimeout(timer);video.removeEventListener("loadeddata",done);video.removeEventListener("error",fail);};
  const done=()=>{cleanup();resolve();},fail=()=>{cleanup();reject(new Error(`Could not load ${clip.name}.`));};
  const timer=setTimeout(fail,20000);video.addEventListener("loadeddata",done);video.addEventListener("error",fail);video.load();
 });return video;}catch(error){video.removeAttribute("src");video.load();throw error;}
}
async function loadMedia(clip:VideoClip):Promise<HTMLImageElement|HTMLVideoElement>{
 try{return await loadMediaDirect(clip);}catch(error){
  if(clip.sourceUrl.startsWith("https:")&&new URL(clip.sourceUrl).origin!==location.origin)return loadMediaDirect({...clip,sourceUrl:mediaPreviewUrl(clip.sourceUrl)});
  throw error;
 }
}

export async function seekGpuMedia(video:HTMLVideoElement,timeMs:number){const seconds=Math.max(0,Math.min(timeMs/1000,Math.max(0,video.duration-.00001)));if(Math.abs(video.currentTime-seconds)<.0001 && !video.seeking)return;await new Promise<void>((resolve,reject)=>{const timeout=setTimeout(()=>{clean();reject(new Error("Screen video seek timed out."));},15000);const clean=()=>{clearTimeout(timeout);video.removeEventListener("seeked",done);video.removeEventListener("error",fail);};const done=()=>{clean();resolve();};const fail=()=>{clean();reject(new Error("Screen video decode failed."));};video.addEventListener("seeked",done);video.addEventListener("error",fail);video.currentTime=seconds;});}

/** One shared WebGL scene for preview and deterministic browser export. */
export class VideoGpuScene {
 readonly renderer:THREE.WebGLRenderer;
 readonly scene=new THREE.Scene();
 readonly camera:THREE.PerspectiveCamera;
 private readonly objects=new Map<string,ObjectState>();
 private readonly loader:GLTFLoader;
 private readonly draco:DRACOLoader;
 private readonly environment:THREE.Texture;
 private readonly sceneLabels=new Map<string,{mesh:THREE.Mesh;image?:HTMLImageElement;svg?:string}>();
 private composer:EffectComposer;
 private bokeh:BokehPass;
 private disposed=false;
 constructor(readonly canvas:HTMLCanvasElement,readonly width:number,readonly height:number,readonly assetBase=""){
  this.renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,preserveDrawingBuffer:true,powerPreference:"high-performance"});
  this.renderer.setPixelRatio(1);this.renderer.setSize(width,height,false);this.renderer.setClearColor(0x000000,0);
  this.renderer.localClippingEnabled=true;this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.NoToneMapping;this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFShadowMap;
  this.camera=new THREE.PerspectiveCamera(30,width/height,Math.max(width,height)*.03,Math.max(width,height)*12);
  const pmrem=new THREE.PMREMGenerator(this.renderer),room=new RoomEnvironment();this.environment=pmrem.fromScene(room,.04).texture;room.dispose();pmrem.dispose();this.scene.environment=this.environment;
  this.scene.add(new THREE.HemisphereLight(0xffffff,0x465267,2));
  const key=new THREE.DirectionalLight(0xffffff,4);key.name="key";key.castShadow=true;key.shadow.mapSize.set(2048,2048);key.shadow.camera.left=-width;key.shadow.camera.right=width;key.shadow.camera.top=height;key.shadow.camera.bottom=-height;key.shadow.camera.far=Math.max(width,height)*8;key.shadow.bias=-.00015;key.shadow.normalBias=.3;this.scene.add(key);
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(width*4,height*4),new THREE.ShadowMaterial({opacity:.25}));floor.name="shadow-receiver";floor.position.z=-Math.max(width,height)*.16;floor.receiveShadow=true;this.scene.add(floor);
  this.draco=new DRACOLoader();this.draco.setDecoderPath(`${assetBase}/devices/draco/`);this.loader=new GLTFLoader();this.loader.setDRACOLoader(this.draco);
  // Default-framebuffer antialiasing does not apply to the composer's buffers.
  // Resolve multisampled geometry before the color/focus passes, preserving
  // both smooth bezel coverage and the source recording's unlit colors.
  const gl=this.renderer.getContext() as WebGL2RenderingContext;
  const supportedSamples=(format:number)=>{
   try{const supported=gl.getInternalformatParameter(gl.RENDERBUFFER,format,gl.SAMPLES) as Int32Array|null;return Math.max(0,...Array.from(supported??[]).filter(n=>n>0&&n<=4));}
   catch{return 0;}
  };
  const floatingSamples=supportedSamples(gl.RGBA16F);
  const target=new THREE.WebGLRenderTarget(width,height,{type:floatingSamples?THREE.HalfFloatType:THREE.UnsignedByteType,samples:floatingSamples||supportedSamples(gl.RGBA8)});
  this.composer=new EffectComposer(this.renderer,target);this.composer.addPass(new RenderPass(this.scene,this.camera));this.bokeh=new BokehPass(this.scene,this.camera,{focus:3000,aperture:0,maxblur:.008});this.bokeh.materialBokeh.fragmentShader=this.bokeh.materialBokeh.fragmentShader.replace("gl_FragColor.a = 1.0;","");this.composer.addPass(this.bokeh);this.composer.addPass(new OutputPass());this.composer.setSize(width,height);
 }
 async prepare(timeline:VideoTimeline){await Promise.all([...timeline.clips,...(timeline.layers??[])].filter(c=>isGpuFrame(c.deviceFrame)).map(c=>this.add(c)));}
 private async add(clip:VideoClip){
  if(this.objects.has(clip.id))return;const frame=clip.deviceFrame!,model=deviceModel(frame),group=new THREE.Group(),surfaces:Surface[]=[],hinges:THREE.Group[]=[];
  const geometry=deviceFrameGeometry(this.width,this.height,frame.device),w=geometry.outer.width,h=geometry.outer.height;
  if("file" in model){
   const gltf=await this.loader.loadAsync(`${this.assetBase}${modelAssetPath(model.file)}`),body=gltf.scene;
   if(this.disposed){releaseObject(body);return;}
   body.traverse(node=>{if(node instanceof THREE.Mesh){node.castShadow=true;node.receiveShadow=true;node.material=Array.isArray(node.material)?node.material.map(m=>m.clone()):node.material.clone();}});
   if(frame.device==="watch")body.rotation.x+=Math.PI/4;
   body.updateMatrixWorld(true);
   let screen:THREE.Mesh|undefined;
   const meshes:THREE.Mesh[]=[];body.traverse(node=>{if(node instanceof THREE.Mesh)meshes.push(node);});
   if(frame.device==="watch")screen=meshes.find(m=>!Array.isArray(m.material)&&m.material.name==="edYkGGAdRWeopLP");
   else if(frame.device==="iphone")screen=meshes.find(m=>!Array.isArray(m.material)&&m.material.name==="Material.001");
   else {const candidates=meshes.filter(m=>!Array.isArray(m.material)&&/glass|screen|display/i.test(m.material.name));candidates.sort((a,b)=>{const sa=new THREE.Box3().setFromObject(a).getSize(new THREE.Vector3()),sb=new THREE.Box3().setFromObject(b).getSize(new THREE.Vector3());return sb.x*sb.y-sa.x*sa.y;});screen=candidates[0];}
   const box=new THREE.Box3().setFromObject(screen??body,true),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());
   if(screen&&frame.device!=="watch")screen.visible=false;
   const factor=geometry.screen.width/Math.max(.0001,size.x);const normalized=new THREE.Group();normalized.add(body);normalized.scale.setScalar(factor);normalized.position.copy(center).multiplyScalar(-factor);group.add(normalized);
   const sw=geometry.screen.width*(frame.device==="watch"?.97:1),sh=size.y*factor*(frame.device==="watch"?.97:1);
   const surface=panel(sw,sh,frame.device==="watch"?sw*.29:sw*(frame.device==="android"?.035:.125));surface.mesh.position.z=size.z*factor/2+.15;group.add(surface.mesh);surfaces.push(surface);
   // Keep the manufacturer's glass/hardware outside the native screen opening.
   if(frame.device==="iphone") {const island=new THREE.Mesh(new RoundedBoxGeometry(sw*.27,sw*.072,sw*.018,4,sw*.026),new THREE.MeshPhysicalMaterial({color:0x050506,roughness:.13,clearcoat:1}));island.position.set(0,sh/2-sw*.065,surface.mesh.position.z+.2);group.add(island);}
   for(const material of materials(body)){if(material instanceof THREE.MeshStandardMaterial && material.metalness>.5 && frame.finish){material.color.set(({graphite:"#3B3B3D",silver:"#D7D9DD",gold:"#BFA781",natural:"#99958C"})[frame.finish]);material.roughness=.24;}}
   if(frame.device==="watch" && frame.band==="none")meshes.filter(m=>!Array.isArray(m.material)&&["sTxeXXVKohXeDJU","lgIBGhMXHpTEcfq","FsJfKVbzNLXJeBa","ivgxAOQoWknkmNj","troyYZUIqRYbiDX"].includes(m.material.name)).forEach(m=>m.visible=false);
  }else{
   const material=new THREE.MeshPhysicalMaterial({color:frame.color,metalness:.85,roughness:.26,clearcoat:.8}),depth=w*.045;
   const create=(pw:number,ph:number,parent:THREE.Group)=>{const shell=new THREE.Mesh(new RoundedBoxGeometry(pw,ph,depth,6,Math.min(geometry.outer.radius,depth*.45)),material.clone());shell.position.z=-depth/2;shell.castShadow=true;shell.receiveShadow=true;parent.add(shell);const screen=panel(pw-geometry.border*2,ph-geometry.border*2,geometry.screen.radius);screen.mesh.position.z=.3;parent.add(screen.mesh);surfaces.push(screen);};
   if(frame.device==="iphone-duo")for(const direction of [-1,1]){const hinge=new THREE.Group();create(w/2,h,hinge);hinge.children.forEach(part=>part.position.x+=direction*w/4);group.add(hinge);hinges.push(hinge);surfaces.at(-1)!.screen="inner";surfaces.at(-1)!.half=direction as -1|1;
     const rear=panel(w/2-geometry.border*2,h-geometry.border*2,geometry.screen.radius);rear.mesh.position.set(direction*w/4,0,-depth-.3);rear.mesh.rotation.y=Math.PI;rear.screen="outer";rear.half=direction as -1|1;hinge.add(rear.mesh);surfaces.push(rear);}
   else create(w,h,group);
   if(frame.device==="mac"){const deck=new THREE.Mesh(new RoundedBoxGeometry(w*1.04,h*.035,w*.6,6,h*.012),material);deck.position.set(0,-h/2,w*.28);deck.castShadow=true;group.add(deck);for(let row=0;row<5;row++)for(let col=0;col<12;col++){const key=new THREE.Mesh(new RoundedBoxGeometry(w*.059,h*.009,w*.038,2,h*.003),new THREE.MeshStandardMaterial({color:0x121416,roughness:.7}));key.position.set((col-5.5)*w*.073,-h/2+h*.02,w*.06+row*w*.052);group.add(key);}}
  }
  for(const m of materials(group))if(m instanceof THREE.MeshStandardMaterial){
   m.userData.relayMetal=m.metalness;
   // Tone-map lit hardware before postprocessing. Unlit app screens and text
   // retain their exact source colors through the final sRGB output pass.
   m.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace("#include <common>","#include <common>\n#include <tonemapping_pars_fragment>").replace("#include <opaque_fragment>","outgoingLight=ACESFilmicToneMapping(outgoingLight);\n#include <opaque_fragment>");};
   m.customProgramCacheKey=()=>"relay-hardware-aces-v1";
  }
  let media:HTMLImageElement|HTMLVideoElement;try{media=await loadMedia(clip);}catch(error){releaseObject(group);throw error;}
  if(this.disposed){releaseObject(group);if(media instanceof HTMLVideoElement){media.pause();media.removeAttribute("src");media.load();}return;}
  this.scene.add(group);this.objects.set(clip.id,{clip,group,surfaces,hinges,media,opacity:1});
 }
 async frame(timeline:VideoTimeline,timeMs:number,{seek=true,blur=true}:{seek?:boolean;blur?:boolean}={}):Promise<HTMLCanvasElement>{
  if(this.disposed)throw new Error("GPU scene was disposed.");
  const shutter=blur?sceneShutterSamples(timeline.scene,timeMs,timeline.exportSettings?.fps??30):[{timeMs,weight:1}];
  if(shutter.length>1){const accumulated=document.createElement("canvas");accumulated.width=this.width;accumulated.height=this.height;const ctx=accumulated.getContext("2d")!;ctx.globalCompositeOperation="lighter";for(const sample of shutter){const frame=await this.frame(timeline,sample.timeMs,{seek,blur:false});ctx.globalAlpha=sample.weight;ctx.drawImage(frame,0,0);}return accumulated;}

  const schedule=[...clipSchedule(timeline),...layerSchedule(timeline)],active=new Map(schedule.filter(e=>timeMs>=e.startMs&&timeMs<e.endMs&&isGpuFrame(e.clip.deviceFrame)).map(e=>[e.clip.id,e]));
  for(const [id,state]of this.objects){const entry=active.get(id);state.group.visible=Boolean(entry);if(!entry)continue;state.clip=entry.clip;const sourceMs=clipSourceTime(entry.clip,timeMs-entry.startMs);if(state.media instanceof HTMLVideoElement){if(seek)await seekGpuMedia(state.media,sourceMs);else if(Math.abs(state.media.currentTime-sourceMs/1000)>.15)state.media.currentTime=sourceMs/1000;}
   if(entry.clip.pointer){const svg=pointerSvg(sourceMs,state.media instanceof HTMLVideoElement?state.media.videoWidth:state.media.naturalWidth,state.media instanceof HTMLVideoElement?state.media.videoHeight:state.media.naturalHeight,entry.clip.pointer);if(svg!==state.lastPointer){state.pointer=await loadedImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);state.lastPointer=svg;}}
   if(!entry.clip.pointer){state.pointer=undefined;state.lastPointer=undefined;}
   for(const surface of state.surfaces){const ctx=surface.canvas.getContext("2d")!,cw=surface.canvas.width,ch=surface.canvas.height,iw=state.media instanceof HTMLVideoElement?state.media.videoWidth:state.media.naturalWidth,ih=state.media instanceof HTMLVideoElement?state.media.videoHeight:state.media.naturalHeight;ctx.fillStyle="#000";ctx.fillRect(0,0,cw,ch);const fit=entry.clip.fit==="cover"?Math.max(cw/(surface.half?iw/2:iw),ch/ih)*entry.clip.zoom:Math.min(cw/(surface.half?iw/2:iw),ch/ih),dw=(surface.half?iw/2:iw)*fit,dh=ih*fit,x=(cw-dw)*entry.clip.x,y=(ch-dh)*entry.clip.y;if(surface.half){ctx.drawImage(state.media,surface.half===-1?0:iw/2,0,iw/2,ih,x,y,dw,dh);if(entry.clip.pointer){const svg=pointerSvg(sourceMs,iw,ih,entry.clip.pointer,surface.screen);const pointer=await loadedImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);ctx.drawImage(pointer,surface.half===-1?0:iw/2,0,iw/2,ih,x,y,dw,dh);}}else{ctx.drawImage(state.media,x,y,dw,dh);if(state.pointer)ctx.drawImage(state.pointer,x,y,dw,dh);}surface.texture.needsUpdate=true;}
  }
  if(this.disposed)return this.canvas;
  await this.updateSceneLabels(timeline,timeMs);
  if(this.disposed)return this.canvas;
  const scene=timeline.scene??defaultVideoScene;
  this.pose(timeline,timeMs,active);this.render(scene);return this.canvas;
 }
 private pose(timeline:VideoTimeline,timeMs:number,active:Map<string,ReturnType<typeof clipSchedule>[number]>){
  const config=timeline.scene??defaultVideoScene,c=sceneCameraState(config,timeMs),unit=Math.max(this.width,this.height),lens=unit*3/50*c.focalLength*c.scale;
  this.camera.fov=THREE.MathUtils.radToDeg(2*Math.atan(this.height/(2*lens)));this.camera.position.set(c.x*unit,-c.y*unit,unit*3+c.z*unit);this.camera.rotation.set(-c.rotateX*Math.PI/180,c.rotateY*Math.PI/180,-c.rotateZ*Math.PI/180);this.camera.updateProjectionMatrix();this.camera.updateMatrixWorld(true);
  const key=this.scene.getObjectByName("key") as THREE.DirectionalLight,angle=config.lightAngle*Math.PI/180;key.position.set(Math.sin(angle)*unit,unit,Math.cos(angle)*unit*2);key.intensity=config.environment==="night"?1.4:4;key.color.set(config.environment==="sunset"?0xffb181:config.environment==="night"?0x789aff:0xffffff);this.scene.environmentRotation.y=angle;
  (this.scene.getObjectByName("shadow-receiver") as THREE.Mesh).visible=config.shadow>0;(this.scene.getObjectByName("shadow-receiver") as THREE.Mesh<THREE.PlaneGeometry,THREE.ShadowMaterial>).material.opacity=config.shadow;
  for(const [id,state]of this.objects){const entry=active.get(id);if(!entry)continue;const frame=entry.clip.deviceFrame!,p=devicePose(frame,clipMotionTime(entry.clip,timeMs-entry.startMs),this.height,clipMotionDuration(timeline,entry.clip));const a=p.animated;state.group.position.set((Number(a.x)-.5)*this.width,(.5-Number(a.y))*this.height-Number(p.dy),Number(a.depth)*unit);state.group.scale.setScalar(Number(a.scale));state.group.rotation.set(-Number(p.rx),Number(p.ry),-Number(p.rz));
   for(const m of materials(state.group))if(m instanceof THREE.MeshStandardMaterial&&m.userData.relayMetal>.5){m.roughness=config.roughness;m.metalness=config.metallic;}state.hinges.forEach((hinge,i)=>hinge.rotation.y=(i===0?-1:1)*Number(p.fold)/2);
   let opacity=Number(a.opacity),clipPlanes:THREE.Plane[]=[];
   const sequential=timeline.clips.some(c=>c.id===id),incoming=sequential?clipSchedule(timeline).find(e=>e.transitionMs>0&&e.index===entry.index+1&&timeMs>=e.startMs&&timeMs<e.startMs+e.transitionMs):undefined;
   const transition=entry.transitionMs>0&&timeMs<entry.startMs+entry.transitionMs?entry:incoming;
   if(transition){const t=transition.clip.transition!,progress=Number(animationEase((timeMs-transition.startMs)/transition.transitionMs,t.easing,t.curve)),isIncoming=transition.clip.id===id;
    if(t.kind==="crossfade"||t.kind==="zoom")opacity*=isIncoming?progress:1-progress;
    if(t.kind==="zoom"&&isIncoming)state.group.scale.multiplyScalar(1.2-.2*progress);
    if(t.kind==="slide-left"||t.kind==="slide-right"){
      const shift=(t.kind==="slide-left"?-1:1)*(isIncoming?progress-1:progress),projected=state.group.position.clone().project(this.camera);projected.x+=shift*2;state.group.position.copy(projected.unproject(this.camera));
    }
    if(t.kind==="wipe-left"||t.kind==="wipe-right"){
      const left=t.kind==="wipe-left",edge=left?1-progress*2:progress*2-1;
      const pa=new THREE.Vector3(edge,-1,0).unproject(this.camera),pb=new THREE.Vector3(edge,1,0).unproject(this.camera);
      const plane=new THREE.Plane().setFromCoplanarPoints(pa,pb,this.camera.position),inside=new THREE.Vector3(left?Math.min(1,edge+.01):Math.max(-1,edge-.01),0,0).unproject(this.camera);if(plane.distanceToPoint(inside)<0)plane.negate();
      // Clip both sides of a wipe. Coplanar opaque screens must not rely on
      // depth ties to draw the incoming half after multisample resolution.
      if(!isIncoming)plane.negate();clipPlanes=[plane];
    }
   }
   for(const material of materials(state.group)){material.clippingPlanes=clipPlanes;material.clipShadows=true;}

   if(opacity!==state.opacity){state.opacity=opacity;for(const material of materials(state.group)){material.transparent=opacity<1;material.opacity=opacity;material.depthWrite=opacity>.99;}}
  }
 }
 private render(scene:NonNullable<VideoTimeline["scene"]>){this.renderer.toneMappingExposure=scene.exposure;this.bokeh.enabled=scene.aperture>0;(this.bokeh.uniforms as Record<string,THREE.IUniform>).focus.value=Math.max(1,Math.max(this.width,this.height)*(3-scene.focusDepth));(this.bokeh.uniforms as Record<string,THREE.IUniform>).aperture.value=scene.aperture*.00003;this.composer.render();}
 private async updateSceneLabels(timeline:VideoTimeline,timeMs:number){
  const labels=timeline.labels.filter(l=>l.sceneLayer==="scene");const active=new Set(labels.map(l=>l.id));for(const [id,label]of this.sceneLabels)if(!active.has(id)){label.mesh.geometry.dispose();(label.mesh.material as THREE.MeshBasicMaterial).map?.dispose();(label.mesh.material as THREE.Material).dispose();this.scene.remove(label.mesh);this.sceneLabels.delete(id);}
  for(const label of labels){let state=this.sceneLabels.get(label.id);if(!state){const mesh=new THREE.Mesh(new THREE.PlaneGeometry(this.width,this.height),new THREE.MeshBasicMaterial({transparent:true,depthWrite:false,toneMapped:false,side:THREE.DoubleSide}));this.scene.add(mesh);state={mesh};this.sceneLabels.set(label.id,state);}state.mesh.visible=timeMs>=label.startMs&&timeMs<label.endMs;if(!state.mesh.visible)continue;const [dw,dh]=videoSizes[timeline.aspectRatio];const svg=animatedLabelsMarkup([{...label,sceneLayer:"overlay"}],timeMs,dw,dh);if(svg!==state.svg){const image=await loadedImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);if(this.disposed)return;const texture=new THREE.Texture(image);texture.colorSpace=THREE.SRGBColorSpace;texture.needsUpdate=true;const material=state.mesh.material as THREE.MeshBasicMaterial;material.map?.dispose();material.map=texture;material.needsUpdate=true;state.svg=svg;}const p=animationState(label.animation,timeMs-label.startMs,label.endMs-label.startMs,{x:label.x,y:label.y},"label");
    // Rotate around the authored text anchor, not the canvas origin.
    const px=(p.x-.5)*this.width,py=(.5-p.y)*this.height;state.mesh.geometry.dispose();state.mesh.geometry=new THREE.PlaneGeometry(this.width,this.height).translate(-px,-py,0);state.mesh.position.set(px,py,((label.sceneDepth??0)+p.depth)*Math.max(this.width,this.height));state.mesh.rotation.set(-p.rotateX*Math.PI/180,p.rotateY*Math.PI/180,0);}
 }
 play(playing:boolean){for(const state of this.objects.values())if(state.media instanceof HTMLVideoElement){state.media.playbackRate=state.clip.speed??1;if(playing&&state.clip.freezeMs===undefined)void state.media.play().catch(()=>{});else state.media.pause();}}
 dispose(){if(this.disposed)return;this.disposed=true;for(const state of this.objects.values()){if(state.media instanceof HTMLVideoElement){state.media.pause();state.media.removeAttribute("src");state.media.load();}}this.scene.traverse(node=>{if(node instanceof THREE.Mesh){node.geometry.dispose();for(const m of Array.isArray(node.material)?node.material:[node.material]){for(const value of Object.values(m))if(value instanceof THREE.Texture)value.dispose();m.dispose();}}});this.environment.dispose();this.draco.dispose();this.bokeh.dispose();this.composer.dispose();this.renderer.dispose();this.objects.clear();}
}
