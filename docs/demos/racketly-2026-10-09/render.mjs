// Run with: node --experimental-transform-types docs/demos/racketly-2026-10-09/render.mjs
// Relay's production renderer, with isolated local library/storage adapters.
import {registerHooks,createRequire} from 'node:module';
import {readFile,writeFile,copyFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,join,basename} from 'node:path';
const directory=dirname(fileURLToPath(import.meta.url));
const root=join(directory,'../../..');
const sharp=createRequire(join(root,'apps/web/package.json'))('sharp');
registerHooks({resolve(specifier,context,next){
 if(specifier==='server-only')return {url:'data:text/javascript,export{}',shortCircuit:true};
 try{return next(specifier,context);}catch(error){if(specifier.startsWith('.')&&!/\.[a-z]+$/i.test(specifier))return next(specifier+'.ts',context);throw error;}
}});
const bg='#071B28',accent='#87CFE4';
await sharp({create:{width:1280,height:720,channels:3,background:bg}}).png().toFile(join(directory,'canvas.png'));
// Apple's existing Racketly artwork, with the screen in its native opening.
// Keep the supplied hardware intact; do not wrap it in a procedural device.
const watchBezel=join(directory,'watch-ultra-3-black-alpine.png');
await copyFile('/Users/marcelolaprea/Documents/Projects/Racketly/screenshots/apple-2026/watch-refresh/source/hardware/watch-ultra-3-black-alpine.png',watchBezel);
const holeMask=await sharp(watchBezel).extract({left:89,top:223,width:422,height:514}).extractChannel('alpha').linear(-1,255).png().toBuffer();
const watchScreen=await sharp(join(directory,'watch-score.png')).resize(422,514,{fit:'fill'}).ensureAlpha().composite([{input:holeMask,blend:'dest-in'}]).png().toBuffer();
const nativeWatchArtwork=await sharp({create:{width:600,height:960,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite([{input:watchScreen,left:89,top:223},{input:watchBezel}]).png().toBuffer();
const watchArtwork=await sharp(nativeWatchArtwork).resize(275,440).png().toBuffer();
await sharp({create:{width:1280,height:720,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite([{input:watchArtwork,left:938,top:190}]).png().toFile(join(directory,'watch-official-canvas.png'));
const media=name=>`https://racketly.demo.relay/${name}`;
const spring={stiffness:160,damping:20,mass:1};
const label=(id,text,startMs,endMs,x,y,width,fontSize,animation={},textColor='#FFFFFF')=>({id,text,startMs,endMs,x,y,width,fontSize,font:'modern',textColor,background:'light',backgroundColor:bg,style:'light',height:.08,animation});
const base=(id,name,filename,kind,inMs,outMs)=>({id,name,sourceUrl:media(filename),kind,inMs,outMs,fit:'cover',x:.5,y:.5,zoom:1,volume:0});
const device=(device,x,y,scale)=>({device,x,y,scale,renderMode:'mesh',background:bg,color:'#516E7F',depth:0});
const timeline={
 version:1,aspectRatio:'16:9',background:{color:bg},coverMs:6200,
 clips:[{...base('proof','Real Watch scoring','watch-footage.mp4','video',0,3000),sourceDurationMs:3000},
  {...base('canvas','Device showcase','canvas.png','image',0,9300),transition:{kind:'crossfade',durationMs:300,easing:'ease-in-out'}}],
 layers:[
  {...base('iphone','Racketly match history','iphone-match.png','image',0,9000),startMs:3000,fit:'contain',deviceFrame:{...device('iphone',.60,.54,.85),animation:{entrance:{preset:'fade',durationMs:450},keyframes:[{timeMs:0,x:.63,y:.60,scale:.78,rotateY:-17,rotateZ:-4},{timeMs:1100,x:.60,y:.54,scale:.85,rotateY:8,rotateZ:2},{timeMs:9000,x:.60,y:.54,scale:.86,rotateY:-9,rotateZ:-2}]}}},
  {...base('watch','Racketly — official Apple Watch Ultra bezel','watch-official-canvas.png','image',0,9000),startMs:3000,fit:'contain'}
 ],
 labels:[
  label('proof-title','Score on your wrist.',0,2700,.5,.10,.80,76,{entrance:{preset:'letter-rise',durationMs:450,staggerMs:24},exit:{preset:'fade',durationMs:250}}),
  label('proof-caption','A tap. A point. Back to play.',500,2700,.5,.89,.72,40,{entrance:{preset:'fade',durationMs:250},exit:{preset:'fade',durationMs:250}}),
  label('brand','RACKETLY',3000,12000,.22,.15,.36,40,{entrance:{preset:'fade',durationMs:400}},accent),
  label('first-title','Play the point.\nKeep the score.',3000,8000,.22,.36,.38,72,{entrance:{preset:'line-cascade',durationMs:650,staggerMs:70,easing:'spring',curve:spring},exit:{preset:'fade',durationMs:350}}),
  label('last-title','Your match.\nYour story.',8000,12000,.22,.36,.38,88,{entrance:{preset:'line-cascade',durationMs:550,staggerMs:60,easing:'ease-out'}}),
  label('platforms','Apple Watch + iPhone',3700,12000,.22,.63,.38,34,{entrance:{preset:'slide-up',durationMs:450,easing:'spring',curve:spring}},accent),
  label('cta','Track your next match.',9600,12000,.22,.79,.38,36,{entrance:{preset:'soft-reveal',durationMs:500,easing:'ease-out'}}),
  label('samples','Sample app screens',3300,12000,.22,.94,.38,28,{entrance:{preset:'fade',durationMs:500}},'#7D9AA9')
 ],
 camera:{zoom:1,x:.5,y:.5,keyframes:[{timeMs:0,zoom:1},{timeMs:3000,zoom:1,easing:'spring',curve:spring},{timeMs:4500,zoom:1.015,x:.53,y:.5},{timeMs:12000,zoom:1.025,x:.53,y:.5}]},
 scene:{version:1,environment:'softbox',exposure:1.1,roughness:.4,metallic:.65,shadow:.22,lightAngle:-35,focusDepth:0,aperture:0,motionBlur:0,camera:{x:0,y:0,z:0,rotateX:0,rotateY:0,rotateZ:0,focalLength:50}},
 graphics:[{id:'accent-ring',kind:'ring',startMs:3000,endMs:12000,x:.94,y:.14,width:.08,height:.14,color:'#244A60',seed:4,count:1,speed:.12,animation:{keyframes:[{timeMs:0,opacity:.7},{timeMs:9000,opacity:.7}]}}],
 music:{url:media('racketly-song.mp3'),volume:.20,offsetMs:0,fadeInMs:600,fadeOutMs:900},
 exportSettings:{format:'mp4',fps:24,resolution:'720p',quality:'high'}
};
const {normalizeVideoTimeline}=await import(join(root,'apps/web/lib/video-timeline.ts'));
const normalized=normalizeVideoTimeline(timeline);
await writeFile(join(directory,'timeline.json'),JSON.stringify(normalized,null,2)+'\n');
Object.assign(process.env,{R2_ACCOUNT_ID:'local',R2_ACCESS_KEY_ID:'local',R2_SECRET_ACCESS_KEY:'local',R2_BUCKET_NAME:'local',R2_PUBLIC_URL:'https://racketly.demo.relay'});
const allowed=new Set(['watch-footage.mp4','iphone-match.png','watch-score.png','watch-official-canvas.png','canvas.png','racketly-song.mp3']);
globalThis.fetch=async(url,{signal}={})=>{signal?.throwIfAborted();const name=basename(new URL(String(url)).pathname);if(!allowed.has(name))throw Error('Unexpected local asset '+name);return new Response(await readFile(join(directory,name)));};
const {getR2Client}=await import(join(root,'apps/web/lib/r2.ts'));
getR2Client().send=async command=>{await writeFile(join(directory,basename(command.input.Key)),command.input.Body);return {};};
const {renderVideoArtifactDetails}=await import(join(root,'apps/web/lib/video-renderer.ts'));
const result=await renderVideoArtifactDetails({projectId:'racketly-local-demo',sourceUrl:'',labels:[],timeline:normalized,targetKey:'racketly-relay-demo-real-watch.mp4',onProgress:async progress=>console.log('Render progress',progress)});
await writeFile(join(directory,'render-result.json'),JSON.stringify(result,null,2)+'\n');
console.log('Complete:',join(directory,'racketly-relay-demo-real-watch.mp4'));
