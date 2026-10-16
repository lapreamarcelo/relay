import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {animationEase,animationExpressions,animationState,normalizeLayerAnimation} from './video-animation.ts';
import {normalizeVideoTimeline,emptyTimeline} from './video-timeline.ts';
import {animatedLabelsMarkup} from './animated-label-markup.ts';
import {normalizePointer,pointerMarkup} from './video-pointer.ts';
import {normalizeGraphics,graphicsMarkup} from './video-graphics.ts';
import {exportDimensions,exportProfile} from './video-export-settings.ts';
const evaluate=(v:string|number,t:number):number=>typeof v==='number'?v:Function('clock','min','max','lt','iff','pow',`return ${v.replaceAll('if(','iff(')};`)(t,Math.min,Math.max,(a:number,b:number)=>a<b?1:0,(c:number,a:number,b:number)=>c?a:b,Math.pow);
test('spring, overshoot Bezier and geometric scale use identical preview/export math',()=>{
 for(const easing of ['spring','bouncy','cubic-bezier'] as const){const curve=easing==='cubic-bezier'?{controlPoints:[.3,1.6,.7,1.2] as [number,number,number,number]}:{stiffness:230,damping:12,mass:1.3,velocity:.5};const a=normalizeLayerAnimation({scaleMode:'perceptual',returnMs:400,keyframes:[{timeMs:0,scale:.3,x:.2,easing,curve},{timeMs:1000,scale:2,x:.8}]})!;for(const t of [0,21,450,715,1000,1100,1400,1900]){const numeric=animationState(a,t,2000),expression=animationExpressions(a,'clock',2000);for(const key of ['x','scale'] as const)assert.ok(Math.abs(numeric[key]-evaluate(expression[key],t))<1e-9);}assert.equal(animationEase(0,easing,curve),0);assert.equal(animationEase(1,easing,curve),1);assert.ok(Array.from({length:101},(_,i)=>Number(animationEase(i/100,easing,curve))).some(v=>v>1));}
 assert.throws(()=>normalizeLayerAnimation({keyframes:[{timeMs:0,scale:1,curve:{controlPoints:[-1,0,1,1]}}]}));
});
test('new text effects render escaped stable layouts and different deterministic frames',async()=>{
 const label={id:'headline',text:'Hello <world> 🌱',x:.5,y:.5,width:.8,height:.2,fontSize:48,font:'modern' as const,textColor:'#FFFFFF',background:'dark' as const,style:'dark' as const,startMs:0,endMs:2000};
 for(const preset of ['letter-rise','word-spring','line-cascade','tracking','soft-reveal','focus','ripple','spin-in'] as const){const labels=[{...label,animation:{entrance:{preset,durationMs:800,staggerMs:40}}}];const first=animatedLabelsMarkup(labels,180,540,960),last=animatedLabelsMarkup(labels,1000,540,960);assert.notEqual(first,last);assert.ok(!last.includes('<world>'));assert.equal(first,animatedLabelsMarkup(labels,180,540,960));const {info}=await sharp(Buffer.from(first)).png().toBuffer({resolveWithObject:true});assert.equal(info.width,540);}
});
test('pointer source samples stay deterministic when scrubbing and tap-only fades',()=>{
 const track=normalizePointer({events:[{timeMs:1000,x:.8,y:.8,kind:'move'},{timeMs:0,x:.2,y:.2,kind:'down'}],style:'touch',display:'tap-only',smoothing:1000})!;
 assert.match(pointerMarkup(250,100,200,track),/translate\(29.375 58.75\)/);assert.equal(pointerMarkup(600,100,200,track),'');assert.equal(pointerMarkup(-1,100,200,track),'');assert.equal(pointerMarkup(250,100,200,track),pointerMarkup(250,100,200,track));assert.throws(()=>normalizePointer({events:[{timeMs:0,x:Infinity,y:.5,kind:'move'}]}));
});
test('procedural graphics are seeded bounded data and survive timeline saves',()=>{
 const graphics=normalizeGraphics([{id:'p',kind:'particles',startMs:0,endMs:3000,x:.5,y:.5,width:.8,height:.8,color:'#83E8C8',seed:42,count:20,speed:1}])!;
 const timeline=normalizeVideoTimeline({...emptyTimeline(),graphics,exportSettings:{format:'webm',fps:60,resolution:'720p',quality:'high'}});assert.equal(timeline.graphics?.[0].seed,42);assert.deepEqual(exportDimensions(timeline),[720,1280]);assert.equal(exportProfile(timeline.exportSettings).contentType,'video/webm');assert.equal(graphicsMarkup(graphics,500,720,1280),graphicsMarkup(graphics,500,720,1280));assert.notEqual(graphicsMarkup(graphics,500,720,1280),graphicsMarkup(graphics,600,720,1280));assert.equal(graphicsMarkup(graphics,3000,720,1280),'');assert.throws(()=>normalizeGraphics([{...graphics[0],color:'url(http://unsafe)'}]));
});
