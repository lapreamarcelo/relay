import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyTimeline,normalizeVideoTimeline} from './video-timeline.ts';
import {analyzeAudioPcm,timelineAudioAnalysis} from './video-audio-analysis.ts';
import {defaultCodeClip} from './video-code-clips.ts';
import {graphicsMarkup} from './video-graphics.ts';
import {videoAnalysisMediaUrls} from './videos.ts';
const sourceUrl='https://media.test/music.wav';
const analyzed=()=>({sourceUrl,startMs:0,endMs:2000,offsetMs:0,volume:1,analysis:analyzeAudioPcm([new Float32Array(8000).fill(.5)],8000)});
test('timeline JSON save roundtrip keeps typography, source analysis and editable reactive drawing controls',()=>{
 const document={...emptyTimeline(),music:{...emptyTimeline().music,url:sourceUrl},audioAnalysis:[analyzed()],graphics:[{id:'drawing',kind:'code',startMs:0,endMs:2000,x:.5,y:.5,width:.6,height:.6,color:'#FFFFFF',seed:4,count:1,speed:1,code:defaultCodeClip,audioReactive:{sourceUrl,signal:'bass',amount:2}}],labels:[{id:'title',text:'A real demo',font:'modern',fontSize:48,fontWeight:700,italic:true,kerning:true,letterSpacing:2,lineHeight:1.3,textAlign:'left',strokeColor:'#abc123',strokeWidth:2,shadowColor:'#123abc',shadowBlur:8,shadowX:2,shadowY:3,backgroundOpacity:.3,backgroundRadius:15,padding:20,sceneLayer:'scene',sceneDepth:.2,startMs:0,endMs:2000}]};
 const first=normalizeVideoTimeline(document),second=normalizeVideoTimeline(JSON.parse(JSON.stringify(first)));assert.deepEqual(first,second);assert.equal(first.labels[0].fontWeight,700);assert.equal(first.labels[0].strokeColor,'#ABC123');assert.equal(first.labels[0].sceneLayer,'scene');assert.deepEqual(first.graphics?.[0].code,defaultCodeClip);assert.deepEqual(videoAnalysisMediaUrls(first),[sourceUrl]);assert.notEqual(graphicsMarkup(first.graphics,500,640,360),graphicsMarkup(first.graphics,500,640,360,timelineAudioAnalysis(first)));
});
test('timeline rejects nonfinite typography, malformed analysis and missing source analysis for reactions',()=>{
 assert.throws(()=>normalizeVideoTimeline({...emptyTimeline(),labels:[{text:'Bad',startMs:0,endMs:1000,fontWeight:900}]}),/weight/);
 assert.throws(()=>normalizeVideoTimeline({...emptyTimeline(),labels:[{text:'Bad',startMs:0,endMs:1000,sceneDepth:NaN}]}),/finite/);
 assert.throws(()=>normalizeVideoTimeline({...emptyTimeline(),audioAnalysis:[{...analyzed(),sourceUrl:'http://media.test/music.wav'}]}),/HTTPS/);
 assert.throws(()=>normalizeVideoTimeline({...emptyTimeline(),audioAnalysis:[{...analyzed(),analysis:{...analyzed().analysis,frames:[]}}]}),/frames/);
 assert.throws(()=>normalizeVideoTimeline({...emptyTimeline(),graphics:[{id:'g',kind:'ring',startMs:0,endMs:1000,color:'#FFFFFF',audioReactive:{sourceUrl,signal:'envelope',amount:1}}]}),/analyzed audio/);
});
test('scene typography retains animated 3D pose and overlays reject those fields',()=>{
 const label={id:'scene',text:'Depth',startMs:0,endMs:1000,sceneLayer:'scene',animation:{keyframes:[{timeMs:0,rotateX:20,rotateY:360,depth:.4},{timeMs:1000,rotateY:-30,depth:-.2}]}};
 const result=normalizeVideoTimeline({...emptyTimeline(),labels:[label]});assert.deepEqual(result.labels[0].animation,label.animation);for(const sceneLayer of ['overlay','back'])assert.throws(()=>normalizeVideoTimeline({...emptyTimeline(),labels:[{...label,sceneLayer}]}),/scene placement|scene text/);
});
