// Reproduce: node --experimental-transform-types docs/demos/video-studio/create-demo.mjs
// All media is independently authored; production uploads and fetches stay local.
import { registerHooks, createRequire } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const directory = dirname(fileURLToPath(import.meta.url));
const root = join(directory, '../../..');
const sharp = createRequire(join(root,'apps/web/package.json'))('sharp');
registerHooks({resolve(specifier,context,next){
 if(specifier==='server-only') return {url:'data:text/javascript,export{}',shortCircuit:true};
 try{return next(specifier,context)}catch(error){if(specifier.startsWith('.')&&!/\.[a-z]+$/i.test(specifier))return next(specifier+'.ts',context);throw error;}
}});

function screenSvg(time=0){
 const done=time>=1800, walk=time>=6700, progress=.6+(done?.12:0)+(walk?.12:0), ring=2*Math.PI*43;
 return `<svg xmlns="http://www.w3.org/2000/svg" width="540" height="1120" viewBox="0 0 540 1120"><rect width="540" height="1120" fill="#FBFAF5"/><g font-family="Helvetica,Arial,sans-serif" fill="#203A2C"><text x="34" y="42" font-size="20" font-weight="700">9:41</text><path d="M438 26v13m8-18v18m8-24v24" stroke="#203A2C" stroke-width="4"/><rect x="474" y="24" width="32" height="16" rx="4" fill="none" stroke="#203A2C" stroke-width="2"/><rect x="477" y="27" width="24" height="10" rx="2" fill="#203A2C"/>
 <path d="M34 99c0-25 23-31 27-24C64 99 45 103 34 99Z" fill="#45775D"/><path d="M34 102c-15-5-20-24-12-27C39 79 42 94 34 102Z" fill="#A4BA91"/><text x="77" y="105" font-size="38" font-weight="700" letter-spacing="-1.5">morrow</text><circle cx="475" cy="88" r="23" fill="#E9E6D7"/><text x="475" y="96" font-size="19" text-anchor="middle" font-weight="700">AM</text>
 <text x="28" y="165" font-size="17" letter-spacing="2.3" fill="#72836F">YOUR DAY, AT A GLANCE</text><text x="28" y="216" font-size="41" font-weight="700" letter-spacing="-1.1">A little progress.</text>
 <rect x="28" y="252" width="484" height="240" rx="27" fill="#264B38"/><circle cx="108" cy="341" r="43" fill="none" stroke="#4D6A52" stroke-width="11"/><circle cx="108" cy="341" r="43" fill="none" stroke="#D4E3AD" stroke-width="11" stroke-linecap="round" stroke-dasharray="${progress*ring} ${ring}" transform="rotate(-90 108 341)"/><text x="108" y="351" font-size="32" font-weight="700" text-anchor="middle" fill="#FBFAF5">${Math.round(progress*100)}%</text><text x="182" y="329" font-size="28" font-weight="700" fill="#FBFAF5">Find your</text><text x="182" y="366" font-size="28" font-weight="700" fill="#FBFAF5">daily rhythm.</text><rect x="55" y="422" width="153" height="39" rx="19" fill="#45674A"/><text x="131" y="449" font-size="19" font-weight="500" text-anchor="middle" fill="#F1F3DF">${walk?'5':done?'4':'3'} of 5 habits</text><text x="485" y="449" font-size="19" text-anchor="end" fill="#D4DEC9">Keep it gentle.</text>
 <rect x="28" y="522" width="484" height="143" rx="23" fill="#EFF2E8"/><circle cx="79" cy="590" r="27" fill="#DBE4CD"/><path d="M66 591c7-15 21-15 27 0m-27 0c7 15 21 15 27 0" fill="none" stroke="#55765A" stroke-width="3"/><text x="126" y="577" font-size="27" font-weight="700">Pause &amp; breathe</text><text x="126" y="612" font-size="18" fill="#72836F">2 minutes, just for you</text><rect x="355" y="572" width="128" height="45" rx="22" fill="${done?'#D9E5C9':'#D9E2C6'}"/><text x="419" y="602" font-size="19" font-weight="700" text-anchor="middle">${done?'Done ✓':'Begin'}</text>
 <text x="28" y="726" font-size="26" font-weight="700">The small things</text><text x="491" y="726" font-size="19" text-anchor="end" fill="#72836F">See all</text>
 <rect x="28" y="750" width="484" height="102" rx="19" fill="#FFFFFF" stroke="#E8EADF"/><circle cx="76" cy="801" r="24" fill="#E9ECDD"/><path d="M65 810l12-19 12 19m-18-8h13" fill="none" stroke="#6B8460" stroke-width="3"/><text x="120" y="799" font-size="24" font-weight="700">Evening walk</text><text x="120" y="827" font-size="18" fill="#72836F">A little fresh air</text><circle cx="466" cy="801" r="14" fill="${walk?'#45775D':'none'}" stroke="#CAD3BB" stroke-width="2"/>${walk?'<path d="M460 802l4 4 9-10" fill="none" stroke="#FFFFFF" stroke-width="2"/>':''}
 <rect x="28" y="872" width="484" height="102" rx="19" fill="#FFFFFF" stroke="#E8EADF"/><circle cx="76" cy="923" r="24" fill="#EBE5D8"/><path d="M65 925h23m-19-5h15m-13-5h11" fill="none" stroke="#9A8665" stroke-width="3"/><text x="120" y="921" font-size="24" font-weight="700">One good thing</text><text x="120" y="949" font-size="18" fill="#72836F">Write a moment worth keeping</text><circle cx="466" cy="923" r="14" fill="none" stroke="#CAD3BB" stroke-width="2"/>
 <path d="M0 1014h540" stroke="#E6E8DC"/><rect x="56" y="1035" width="111" height="48" rx="24" fill="#E8EDDA"/><text x="111" y="1066" text-anchor="middle" font-size="19" font-weight="700">Today</text><text x="273" y="1066" text-anchor="middle" font-size="19" fill="#72836F">Habits</text><text x="437" y="1066" text-anchor="middle" font-size="19" fill="#72836F">You</text><rect x="196" y="1100" width="148" height="6" rx="3" fill="#203A2C"/></g></svg>`;
}
await writeFile(join(directory,'fictional-screen.svg'),screenSvg());
await sharp(Buffer.from(screenSvg())).png().toFile(join(directory,'fictional-screen.png'));
console.log('Authored screen ready:',join(directory,'fictional-screen.png'));

const width=540,height=1120,fps=24,durationMs=9000;
const encoder=spawn('ffmpeg',['-v','error','-y','-f','rawvideo','-pixel_format','rgba','-video_size',`${width}x${height}`,'-framerate',String(fps),'-i','pipe:0','-c:v','libx264','-preset','veryfast','-crf','17','-pix_fmt','yuv420p',join(directory,'fictional-screen.mp4')],{stdio:['pipe','ignore','pipe']});
let stderr='';encoder.stderr.on('data',d=>stderr+=d);encoder.stdin.on('error',()=>{});
const done=new Promise((resolve,reject)=>{encoder.on('error',reject);encoder.on('close',code=>code===0?resolve():reject(Error(stderr)));});void done.catch(()=>{});
for(let frame=0;frame<durationMs/1000*fps;frame++){
 const pixels=await sharp(Buffer.from(screenSvg(frame/fps*1000))).ensureAlpha().raw().toBuffer();
 await new Promise((resolve,reject)=>encoder.stdin.write(pixels,error=>error?reject(error):resolve()));
}
encoder.stdin.end();await done;
console.log('Screen video ready');

const spring={stiffness:150,damping:20,mass:1},bezier={controlPoints:[.2,.65,.4,1]};
const base={sourceUrl:'https://media.demo.relay/fictional-screen.mp4',name:'Morrow — fictional UI',kind:'video',inMs:0,outMs:5000,sourceDurationMs:9000,fit:'contain',x:.5,y:.5,zoom:1,volume:0};
const pointer={events:[{timeMs:0,x:.91,y:.85,kind:'move'},{timeMs:900,x:419/540,y:596/1120,kind:'move'},{timeMs:1600,x:419/540,y:596/1120,kind:'down'},{timeMs:1750,x:419/540,y:596/1120,kind:'up'},{timeMs:3000,x:.92,y:.8,kind:'move'},{timeMs:5700,x:466/540,y:801/1120,kind:'move'},{timeMs:6500,x:466/540,y:801/1120,kind:'down',screen:'outer'},{timeMs:6650,x:466/540,y:801/1120,kind:'up',screen:'outer'}],style:'touch',display:'tap-only',color:'#C6DEA5',size:33,smoothing:120,idleMs:900,fadeMs:250};
const frame={background:'#F3F1E7',color:'#25362B',renderMode:'mesh',x:.5,y:.57,scale:.72,depth:0};
const label=(id,text,startMs,endMs,y,fontSize=54,extra={})=>({id,text,startMs,endMs,x:.5,y,width:.86,fontSize,font:'modern',textColor:'#244A37',background:'none',backgroundColor:'#F3F1E7',style:'none',...extra});
const timeline={version:1,aspectRatio:'9:16',background:{color:'#F3F1E7',endColor:'#E5ECDD'},clips:[{...base,id:'phone',pointer,deviceFrame:{...frame,device:'iphone',animation:{keyframes:[{timeMs:0,x:.45,y:.66,scale:.60,rotateY:-24,rotateX:5,rotateZ:-5,easing:'spring',curve:spring},{timeMs:1000,x:.5,y:.58,scale:.72,rotateY:11,rotateX:-4,rotateZ:2,easing:'cubic-bezier',curve:bezier},{timeMs:3200,x:.52,y:.57,scale:.73,rotateY:-12,rotateX:4,rotateZ:-3,easing:'cubic-bezier',curve:bezier},{timeMs:5000,x:.5,y:.57,scale:.7,rotateY:14,rotateX:-2,rotateZ:2}]} }},{...base,id:'duo',inMs:5000,outMs:9000,pointer,transition:{kind:'crossfade',durationMs:350,easing:'ease-in-out'},deviceFrame:{...frame,device:'iphone-duo',scale:.75,foldAngle:28,animation:{keyframes:[{timeMs:0,x:.5,y:.59,scale:.68,rotateY:-18,rotateX:3,rotateZ:-2,foldAngle:70,easing:'spring',curve:{stiffness:100,damping:20,mass:1}},{timeMs:1250,x:.5,y:.58,scale:.76,rotateY:9,rotateX:-3,rotateZ:1,foldAngle:20,easing:'cubic-bezier',curve:bezier},{timeMs:2900,x:.5,y:.58,scale:.76,rotateY:-10,rotateX:4,rotateZ:-1,foldAngle:35,easing:'cubic-bezier',curve:bezier},{timeMs:4000,x:.5,y:.58,scale:.74,rotateY:4,rotateX:0,rotateZ:0,foldAngle:24}]}}}],layers:[],labels:[label('eyebrow','RELAY  /  VIDEO STUDIO',0,8650,.045,25,{textColor:'#71816A',animation:{entrance:{preset:'fade',durationMs:400,easing:'ease-out'}}}),label('headline','Bring your screen\nto life.',0,4600,.14,78,{height:.115,animation:{entrance:{preset:'word-spring',durationMs:600,staggerMs:50,easing:'spring',curve:spring},exit:{preset:'fade',durationMs:300}}}),label('headline-two','One story.\nMore dimensions.',4650,8650,.14,72,{height:.115,animation:{entrance:{preset:'line-cascade',durationMs:650,staggerMs:80,easing:'cubic-bezier',curve:bezier}}}),label('caption-one','Gentle motion. Every detail in sync.',600,4400,.895,32,{textColor:'#5C725A',animation:{entrance:{preset:'soft-reveal',durationMs:450},exit:{preset:'fade',durationMs:300}}}),label('caption-two','Make the small moments move.',5150,8650,.895,32,{textColor:'#5C725A',animation:{entrance:{preset:'slide-up',durationMs:500,easing:'spring',curve:spring}}}),label('footer','Original fictional app · Rendered in Relay',0,8650,.961,19,{textColor:'#8B9680'})],graphics:[{id:'ring',kind:'ring',startMs:0,endMs:8650,x:.17,y:.81,width:.2,height:.09,color:'#D5E0C4',seed:4,count:1,speed:.15,animation:{keyframes:[{timeMs:0,opacity:.4},{timeMs:8650,opacity:.4}]}},{id:'particles',kind:'particles',startMs:0,endMs:8650,x:.87,y:.39,width:.17,height:.25,color:'#BDCDA5',seed:43,count:7,speed:.15,animation:{keyframes:[{timeMs:0,opacity:.45},{timeMs:8650,opacity:.45}]}}],scene:{version:1,environment:'softbox',exposure:1.13,roughness:.42,metallic:.54,shadow:.27,lightAngle:-30,focusDepth:0,aperture:0,motionBlur:0,camera:{x:0,y:0,z:0,rotateX:0,rotateY:0,rotateZ:0,focalLength:50,keyframes:[{timeMs:0,scale:1,x:0,y:.015,easing:'cubic-bezier',curve:bezier},{timeMs:2500,scale:1.035,x:-.016,y:0,easing:'cubic-bezier',curve:bezier},{timeMs:5000,scale:1,x:.013,y:0,easing:'cubic-bezier',curve:bezier},{timeMs:8650,scale:1.04,x:0,y:-.012}]}},music:{url:'',volume:.8,offsetMs:0,fadeInMs:0,fadeOutMs:0},beatGrid:{bpm:110,offsetMs:0},coverMs:2200,exportSettings:{format:'mp4',fps:24,resolution:'720p',quality:'high'}};
// Keep device and world interpolation compact for a fast reproducible demo.
// Spring/custom curves remain visible on the final canvas camera and typography.
timeline.background={color:'#F3F1E7'};
for(const entry of timeline.labels){entry.background='light';entry.backgroundColor='#F3F1E7';entry.style='light';if(!entry.height)entry.height=.06;}
timeline.clips=[{...timeline.clips[0],outMs:9000,deviceFrame:{...frame,device:'iphone',animation:{keyframes:[{timeMs:0,x:.48,y:.66,scale:.60,rotateY:-20,rotateX:5,rotateZ:-5},{timeMs:900,x:.5,y:.57,scale:.72,rotateY:12,rotateX:-3,rotateZ:2},{timeMs:9000,x:.51,y:.57,scale:.74,rotateY:-15,rotateX:4,rotateZ:-2}]}}}];
timeline.scene.camera.keyframes=[{timeMs:0,scale:1,x:0,y:.01},{timeMs:9000,scale:1.035,x:.01,y:-.01}];
for(const entry of [...timeline.labels,...timeline.graphics])if(entry.endMs===8650)entry.endMs=9000;
timeline.camera={zoom:1,x:.5,y:.5,keyframes:[{timeMs:0,zoom:1,x:.5,y:.5,easing:'spring',curve:{stiffness:120,damping:22,mass:1}},{timeMs:1100,zoom:1.018,x:.495,y:.52,easing:'cubic-bezier',curve:bezier},{timeMs:9000,zoom:1,x:.5,y:.5}]};
await writeFile(join(directory,'timeline.json'),JSON.stringify(timeline,null,2)+'\n');
console.log('Timeline ready:',join(directory,'timeline.json'));
Object.assign(process.env,{R2_ACCOUNT_ID:'local',R2_ACCESS_KEY_ID:'local',R2_SECRET_ACCESS_KEY:'local',R2_BUCKET_NAME:'local',R2_PUBLIC_URL:'https://media.demo.relay'});
globalThis.fetch=async(url,{signal}={})=>{signal?.throwIfAborted();const name=new URL(String(url)).pathname.slice(1);if(name!=='fictional-screen.mp4')throw Error('Unexpected local asset: '+name);return new Response(await readFile(join(directory,name)));};
const {getR2Client}=await import(join(root,'apps/web/lib/r2.ts'));
getR2Client().send=async command=>{const name=command.input.Key;await writeFile(join(directory,name),command.input.Body);return {};};
const {normalizeVideoTimeline}=await import(join(root,'apps/web/lib/video-timeline.ts'));
const {renderVideoArtifactDetails}=await import(join(root,'apps/web/lib/video-renderer.ts'));
const result=await renderVideoArtifactDetails({projectId:'local-demo',sourceUrl:'',labels:[],timeline:normalizeVideoTimeline(timeline),targetKey:'relay-video-studio-demo.mp4',onProgress:async progress=>console.log('Render progress',progress)});
await writeFile(join(directory,'render-result.json'),JSON.stringify(result,null,2)+'\n');
console.log('Demo complete:',join(directory,'relay-video-studio-demo.mp4'));
