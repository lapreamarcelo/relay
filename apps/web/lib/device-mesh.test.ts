import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { execFile, spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { DeviceFrame, VideoClip } from '@relay/core';
import { createDeviceMesh } from './device-mesh.ts';
import { deviceFrameGeometry, deviceFrameLayerSvg, deviceBackgroundSvg, normalizeDeviceFrame } from './device-frames.ts';
import { deviceMeshSvg, deviceScene, deviceVideoSceneFilter } from './device-motion.ts';
import { sceneCameraExpressions, sceneCameraState, defaultVideoScene, normalizeVideoScene, sceneProjectPoint, sceneShutterSamples, sceneFocusBlur, sortSceneLayers } from './video-scene.ts';
const frame: DeviceFrame={device:'iphone',color:'#9DADB9',background:'#00FF00',renderMode:'mesh'};
const run=promisify(execFile);
const clip=(f:DeviceFrame):VideoClip=>({id:'mesh',name:'mesh',sourceUrl:'https://example.com/source.mp4',kind:'video',inMs:0,outMs:1000,fit:'cover',x:.5,y:.5,zoom:1,volume:1,deviceFrame:f});
test('mesh normalization supports complete rotations and preserves classic bounds',()=>{
 assert.equal(normalizeDeviceFrame({...frame,rotateY:360,depth:.2,scene:defaultVideoScene},{allowMotion:true})?.rotateY,360);
 assert.throws(()=>normalizeDeviceFrame({...frame,renderMode:'vector',rotateY:360},{allowMotion:true}));assert.throws(()=>normalizeDeviceFrame(frame));
 assert.throws(()=>normalizeVideoScene({...defaultVideoScene,aperture:NaN}));
 assert.throws(()=>normalizeVideoScene({...defaultVideoScene,camera:{...defaultVideoScene.camera,keyframes:[{timeMs:0},{timeMs:0}]}}));
 assert.equal(normalizeDeviceFrame({...frame,animation:{keyframes:[{timeMs:0,rotateY:720}]}},{allowMotion:true})?.animation?.keyframes?.[0].rotateY,720);
});
test('procedural device families contain two-sided extrusion, rear lenses and hardware',()=>{
 for(const device of ['iphone','iphone-duo','watch','mac','tablet','browser'] as const){const mesh=createDeviceMesh(deviceFrameGeometry(360,480,device),device);assert.ok(mesh.faces.length>25&&mesh.thickness>0);if(device==='iphone')assert.ok(mesh.faces.some(f=>f.material==='lens'));if(device==='iphone-duo')assert.equal(new Set(mesh.faces.map(f=>f.side)).size,2);if(device==='mac')assert.ok(mesh.faces.some(f=>f.material==='glass'));}
});
test('edge and back views retain bodies while front screens cull across full rotations',async()=>{
 for(const angle of [0,90,180,270,360]){const s=deviceScene(240,320,{...frame,rotateY:angle});assert.equal(s.panels[0].visible,angle===0||angle===360);const data=await sharp(Buffer.from(s.meshSvg!)).ensureAlpha().raw().toBuffer();let opaque=0;for(let i=3;i<data.length;i+=4)if(data[i]>100)opaque++;assert.ok(opaque>150,`body visible at ${angle} degrees`);}
});
test('global camera time moves both body and glass deterministically; lens changes projection',()=>{
 const scene={...defaultVideoScene,camera:{...defaultVideoScene.camera,z:.2,rotateY:13,keyframes:[{timeMs:0,x:0,scale:1},{timeMs:1000,x:.2,scale:1.5}]}},f={...frame,scene,depth:.1};const a=deviceScene(360,480,f,100,1000,0),b=deviceScene(360,480,f,100,1000,750);assert.notDeepEqual(a.panels[0].corners,b.panels[0].corners);assert.notEqual(a.meshSvg,b.meshSvg);assert.deepEqual(b,deviceScene(360,480,f,100,1000,750));
 const lens=sceneProjectPoint({x:30,y:20,z:0},360,480,{...defaultVideoScene,camera:{...defaultVideoScene.camera,focalLength:100}});assert.equal(lens.x,240);assert.equal(lens.y,280);
});
test('material, environment, focus and temporal shutter affect rendering without losing static alpha',async()=>{
 const baseline=deviceMeshSvg(240,320,{...frame,rotateY:35,scene:defaultVideoScene});for(const change of [{environment:'sunset' as const},{roughness:.95},{metallic:0},{lightAngle:100},{exposure:2}])assert.notEqual(deviceMeshSvg(240,320,{...frame,rotateY:35,scene:{...defaultVideoScene,...change}}),baseline);
 assert.ok(sceneFocusBlur({...defaultVideoScene,aperture:1},1,240,320)>0);assert.deepEqual(sceneShutterSamples(undefined,200),[{timeMs:200,weight:1}]);assert.equal(sceneShutterSamples({...defaultVideoScene,motionBlur:1},200).length,5);
 const blurred=deviceMeshSvg(240,320,{...frame,scene:{...defaultVideoScene,motionBlur:1}},200,1000,200);const image=await sharp(Buffer.from(blurred)).ensureAlpha().raw().toBuffer();assert.ok(image[(160*240+120)*4+3]>245,'stationary temporal average stays opaque');
 assert.deepEqual(sortSceneLayers([{deviceFrame:{depth:1}},{deviceFrame:{depth:-1}}]).map(l=>l.deviceFrame.depth),[-1,1]);
});
test('Duo halves share the same hinge under folded scene camera projection',()=>{
 const f={...frame,device:'iphone-duo' as const,foldAngle:90,rotateX:20,rotateY:30,scene:{...defaultVideoScene,camera:{...defaultVideoScene.camera,rotateZ:15}}};const s=deviceScene(360,480,f,500,1000,700);assert.deepEqual(s,deviceScene(360,480,f,500,1000,700));assert.deepEqual(s.panels[0].corners[1],s.panels[1].corners[0]);assert.deepEqual(s.panels[0].corners[3],s.panels[1].corners[2]);
});
const ffmpeg=spawnSync('ffmpeg',['-version'],{stdio:'ignore'}).status===0;
test('real FFmpeg mesh export projects the camera-attached screen and culls back screens',{skip:!ffmpeg,timeout:30000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'relay-mesh-')),width=160,height=200;
 try{await writeFile(join(dir,'bg.png'),await sharp(Buffer.from(deviceBackgroundSvg(width,height,'#00FF00'))).png().toBuffer());
 for(const angle of [25,180]){const settings={...frame,rotateY:angle,scene:{...defaultVideoScene,camera:{...defaultVideoScene.camera,x:.04,rotateZ:8}}};await writeFile(join(dir,'bezel.png'),await sharp(Buffer.from(deviceFrameLayerSvg(width,height,settings))).png().toBuffer());await writeFile(join(dir,'body.png'),await sharp(Buffer.from(deviceMeshSvg(width,height,settings))).png().toBuffer());await run('ffmpeg',['-v','error','-y','-f','lavfi','-i','color=blue:size=80x100:rate=30','-i',join(dir,'bezel.png'),'-i',join(dir,'body.png'),'-i',join(dir,'bg.png'),'-filter_complex_threads','1','-filter_complex',deviceVideoSceneFilter(width,height,clip(settings),3,1000,true,2),'-map','[framed]','-frames:v','1',join(dir,'result.png')]);const data=await sharp(join(dir,'result.png')).ensureAlpha().raw().toBuffer(),p=deviceScene(width,height,settings).panels[0],m=p.transform.slice(9,-1).split(',').map(Number),x=p.rect.width/2,y=p.rect.height/2,d=m[3]*x+m[7]*y+m[15],px=Math.round((m[0]*x+m[4]*y+m[12])/d),py=Math.round((m[1]*x+m[5]*y+m[13])/d),offset=(py*width+px)*4;assert.equal(data[3],0);if(angle===25)assert.ok(data[offset+2]>220&&data[offset+3]>240,'source remains on projected screen');else assert.ok(data[offset+3]>200&&data[offset+2]<220,'rear material remains visible instead of source');}
 const settings={...frame,motion:'orbit' as const,scene:{...defaultVideoScene,motionBlur:.8,aperture:.3,focusDepth:.5}};await writeFile(join(dir,'bezel.png'),await sharp(Buffer.from(deviceFrameLayerSvg(width,height,settings))).png().toBuffer());await writeFile(join(dir,'body.png'),await sharp(Buffer.from(deviceMeshSvg(width,height,settings,100,1000,500,60))).png().toBuffer());await run('ffmpeg',['-v','error','-y','-f','lavfi','-i','color=blue:size=80x100:rate=60','-i',join(dir,'bezel.png'),'-i',join(dir,'body.png'),'-i',join(dir,'bg.png'),'-filter_complex_threads','1','-filter_complex',deviceVideoSceneFilter(width,height,{...clip(settings),motionOffsetMs:100},3,1000,true,2,500,'0:v',60),'-map','[framed]','-frames:v','1',join(dir,'blur.png')]);assert.equal((await sharp(join(dir,'blur.png')).metadata()).width,width);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('mesh Duo exposes a readable rear display with separately projected source pixels',{skip:!ffmpeg,timeout:30000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'relay-duo-rear-')),width=160,height=200,f={...frame,device:'iphone-duo' as const,rotateY:180};
 try{const scene=deviceScene(width,height,f);assert.equal(scene.panels.length,3);assert.equal(scene.panels[2].screen,'outer');assert.ok(scene.panels[2].visible);assert.ok(!scene.panels[0].visible&&!scene.panels[1].visible);
 await writeFile(join(dir,'bg.png'),await sharp(Buffer.from(deviceBackgroundSvg(width,height,'#00FF00'))).png().toBuffer());await writeFile(join(dir,'bezel.png'),await sharp(Buffer.from(deviceFrameLayerSvg(width,height,f))).png().toBuffer());await writeFile(join(dir,'body.png'),await sharp(Buffer.from(deviceMeshSvg(width,height,f))).png().toBuffer());
 await run('ffmpeg',['-v','error','-y','-f','lavfi','-i','color=blue:size=80x100:rate=30','-i',join(dir,'bezel.png'),'-i',join(dir,'body.png'),'-i',join(dir,'bg.png'),'-filter_complex_threads','1','-filter_complex',deviceVideoSceneFilter(width,height,clip(f),3,1000,true,2),'-map','[framed]','-frames:v','1',join(dir,'out.png')]);
 await run('ffmpeg',['-v','error','-y','-f','lavfi','-i','color=blue:size=80x100:rate=30','-i',join(dir,'bezel.png'),'-i',join(dir,'body.png'),'-i',join(dir,'bg.png'),'-filter_complex_threads','1','-filter_complex',deviceVideoSceneFilter(width,height,clip(f),3,1000,true,2),'-map','[framed]','-frames:v','30','-f','null','-']);
 const data=await sharp(join(dir,'out.png')).ensureAlpha().raw().toBuffer(),p=scene.panels[2],r=p.screenRect!,m=p.transform.slice(9,-1).split(',').map(Number),x=r.x+r.width/2-p.rect.x,y=r.y+r.height/2-p.rect.y,d=m[3]*x+m[7]*y+m[15],px=Math.round((m[0]*x+m[4]*y+m[12])/d),py=Math.round((m[1]*x+m[5]*y+m[13])/d),offset=(py*width+px)*4;assert.ok(data[offset+2]>220&&data[offset+3]>240,'rear display carries opaque recording pixels');
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('camera Z and focal length interpolate independent sparse channels and validate authored ranges',()=>{
 const scene={...defaultVideoScene,camera:{...defaultVideoScene.camera,z:-.2,focalLength:40,keyframes:[{timeMs:0,z:-.4,focalLength:30,scale:1},{timeMs:500,z:.4},{timeMs:1000,focalLength:90,scale:2}]}};
 const normalized=normalizeVideoScene(scene)!;
 assert.equal(normalized.camera.keyframes?.[1].z,.4);
 const pose=sceneCameraState(normalized,250);assert.ok(Math.abs(pose.z)<1e-8);assert.equal(pose.focalLength,45);assert.equal(pose.scale,1.25);
 const at750=sceneCameraState(normalized,750);assert.equal(at750.z,.4);assert.equal(at750.focalLength,75);assert.equal(at750.scale,1.75);
 assert.throws(()=>normalizeVideoScene({...scene,camera:{...scene.camera,keyframes:[{timeMs:0,z:2.1}]}}));
 assert.throws(()=>normalizeVideoScene({...scene,camera:{...scene.camera,keyframes:[{timeMs:0,focalLength:NaN}]}}));
 assert.throws(()=>normalizeVideoScene({...scene,camera:{...scene.camera,keyframes:[{timeMs:0,focalLength:121}]}}));
 const expression=sceneCameraExpressions(normalized,'(t*1000+500)');assert.equal(typeof expression.z,'string');assert.equal(typeof expression.focalLength,'string');
 const f={...frame,animation:{keyframes:[{timeMs:0,depth:-.2},{timeMs:1000,depth:.3}]},scene:normalized};
 assert.notDeepEqual(deviceScene(160,200,f,0,1000,750).panels,deviceScene(160,200,f,500,1000,750).panels);
});

test('cut offsets preserve numeric and FFmpeg camera dolly, lens and animated device depth',{skip:!ffmpeg,timeout:30000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'relay-camera-dolly-')),width=160,height=200;
 const scene={...defaultVideoScene,aperture:.6,camera:{...defaultVideoScene.camera,keyframes:[{timeMs:0,z:-.5,focalLength:35},{timeMs:1000,z:.4,focalLength:70}]}};
 const f={...frame,scale:.7,scene,animation:{keyframes:[{timeMs:0,depth:-.2},{timeMs:1000,depth:.3}]}};
 try{
 await writeFile(join(dir,'bg.png'),await sharp(Buffer.from(deviceBackgroundSvg(width,height,'#00FF00'))).png().toBuffer());await writeFile(join(dir,'bezel.png'),await sharp(Buffer.from(deviceFrameLayerSvg(width,height,f))).png().toBuffer());
 for(const [motionTime,globalTime] of [[100,350],[600,850]]){
 await writeFile(join(dir,'body.png'),await sharp(Buffer.from(deviceMeshSvg(width,height,f,motionTime,1000,globalTime))).png().toBuffer());
 const filter=deviceVideoSceneFilter(width,height,{...clip(f),motionOffsetMs:motionTime},3,1000,true,2,globalTime);
 assert.ok(filter.includes('sendcmd='),'animated depth updates Gaussian sigma every exported frame');
 await run('ffmpeg',['-v','error','-y','-f','lavfi','-i','color=blue:size=80x100:rate=30','-i',join(dir,'bezel.png'),'-i',join(dir,'body.png'),'-i',join(dir,'bg.png'),'-filter_complex_threads','1','-filter_complex',filter,'-map','[framed]','-frames:v','1',join(dir,'out.png')]);
 const pixels=await sharp(join(dir,'out.png')).ensureAlpha().raw().toBuffer(),p=deviceScene(width,height,f,motionTime,1000,globalTime).panels[0],m=p.transform.slice(9,-1).split(',').map(Number),x=p.rect.width*.6,y=p.rect.height*.6,d=m[3]*x+m[7]*y+m[15],px=Math.round((m[0]*x+m[4]*y+m[12])/d),py=Math.round((m[1]*x+m[5]*y+m[13])/d),index=(py*width+px)*4;
 assert.ok(pixels[index+2]>230&&pixels[index+3]>240,'export recording matches numeric projection across linked local/global clocks');
 }
 }finally{await rm(dir,{recursive:true,force:true});}
});
