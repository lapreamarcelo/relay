import test from "node:test";
import assert from "node:assert/strict";
import { compileVideoComposition, normalizeVideoCompositionRequest, videoComposerCatalog } from "./video-composition.ts";
import { emptyTimeline, timelineDuration } from "./video-timeline.ts";

export const compositionFixtureRequest = () => normalizeVideoCompositionRequest({ prompt: "Make an elegant launch demo for Relay, with an iPhone and clear titles.", productName: "Relay", durationMs: 6000, timeline: { ...emptyTimeline(), music: { url: "https://media.example.test/music.mp3", volume: .4, offsetMs: 1200, fadeInMs: 300, fadeOutMs: 400, startMs: 500, endMs: 5500 }, clips: [{ id: "recording", sourceUrl: "https://media.example.test/demo.mp4", name: "App recording", kind: "video", inMs: 1000, outMs: 9000, sourceDurationMs: 10000, fit: "contain", x: .5, y: .5, zoom: 1, volume: .25 }] } });
export const compositionFixturePlan = () => ({ summary: "A clean framed recording with animated titles and a smooth transition.", background: "#181825", backgroundEnd: "#434361", shots: [0, 1].map(index => ({ sourceClipId: "recording", inMs: 1000 + index * 4000, outMs: 5000 + index * 4000, fit: "contain", device: "iphone", camera: index ? "pan-left" : "push-in", position: "center", transition: index ? "crossfade" : "none", transitionDurationMs: 500, entrance: "slide-up", exit: "fade", titles: [{ text: "Relay", startMs: 0, endMs: 4000, position: "top", font: "modern", fontSize: 72, style: "outline", entrance: "typewriter", exit: "fade" }] })) });

test("composer request bounds footage, prompt, product and duration without mutating input", () => {
  const request = compositionFixtureRequest();
  assert.equal(request.durationMs, 6000);
  assert.equal(normalizeVideoCompositionRequest({ ...request, durationMs: undefined }).durationMs, 15000);
  for (const change of [{ prompt: "tiny" }, { prompt: "x".repeat(4001) }, { durationMs: 999 }, { durationMs: 60001 }, { durationMs: 2000.5 }, { productName: "x".repeat(121) }, { unexpected: true }, { timeline: emptyTimeline() }]) assert.throws(() => normalizeVideoCompositionRequest({ ...request, ...change }));
});
test("compiler maps existing footage, adds editable motion, uses overlap clock, and preserves music", () => {
  const request = compositionFixtureRequest(); const before = structuredClone(request);
  const result = compileVideoComposition(request, compositionFixturePlan());
  assert.equal(timelineDuration(result.timeline), 6000);
  assert.deepEqual(result.timeline.music, request.timeline.music);
  assert.equal(result.timeline.clips[1].inMs, 5000); assert.equal(result.timeline.clips[1].outMs, 7500);
  assert.equal(result.timeline.labels[1].startMs, 3500); assert.equal(result.timeline.labels[1].endMs, 6000);
  assert.equal(result.timeline.labels[0].endMs, 3500);
  assert.equal(result.timeline.labels[0].animation?.entrance?.preset, "typewriter");
  assert.equal(result.timeline.clips[0].deviceFrame?.animation?.keyframes?.length, 2);
  assert.equal(result.timeline.clips[1].deviceFrame?.animation?.keyframes?.[0].rotateY, -15);
  assert.equal(result.timeline.clips[1].deviceFrame?.animation?.keyframes?.[1].timeMs, 2500);
  assert.equal(new Set(result.timeline.clips.map(c => c.id)).size, 2);
  assert.ok(result.timeline.clips.every(c => c.sourceUrl === request.timeline.clips[0].sourceUrl && c.id !== "recording"));
  assert.ok(result.warnings.some(w => w.includes("reuses"))); assert.deepEqual(request, before);
});
test("trimming solves the changed half-duration overlap and never time stretches", () => {
  const request = compositionFixtureRequest(); request.durationMs = 4100;
  const result = compileVideoComposition(request, compositionFixturePlan());
  assert.equal(timelineDuration(result.timeline), 4100);
  assert.equal(result.timeline.clips[1].outMs - result.timeline.clips[1].inMs, 200);
  const short = compositionFixturePlan(); short.shots = [short.shots[0]]; request.durationMs = 15000;
  const shorter = compileVideoComposition(request, short);
  assert.equal(timelineDuration(shorter.timeline), 4000);
  assert.ok(shorter.warnings.some(w => w.includes("requested 15.00s")));
});
test("provider cannot hallucinate sources, expand trims or pass executable/unsafe properties", () => {
  const request = compositionFixtureRequest();
  for (const changes of [{ sourceClipId: "missing" }, { sourceUrl: "https://evil.example/injected.mp4" }, { inMs: 0 }, { outMs: 10001 }, { camera: "unknown" }, { device: "iphone", camera: "fold" }, { device: "none", camera: "push-in" }, { entrance: "typewriter" }]) {
    const plan = compositionFixturePlan(); Object.assign(plan.shots[0], changes);
    assert.throws(() => compileVideoComposition(request, plan));
  }
  const invalidTitle = compositionFixturePlan(); invalidTitle.shots[1].titles[0].endMs = 5000;
  assert.throws(() => compileVideoComposition({ ...request, durationMs: 1000 }, invalidTitle), /Title timing/);
});
test("Duo folding is editable and unsupported fullscreen motion is rejected", () => {
  const plan = compositionFixturePlan(); plan.shots[0].device = "iphone-duo"; plan.shots[0].camera = "fold-cycle";
  const frame = compileVideoComposition(compositionFixtureRequest(), plan).timeline.clips[0].deviceFrame;
  assert.equal(frame?.device, "iphone-duo"); assert.equal(frame?.motion, "fold-cycle");
  const catalog = videoComposerCatalog(false); assert.equal(catalog.available, false); assert.equal(catalog.previewOnly, true); assert.ok(catalog.cameraPresets.includes("push-in"));
});

test("composer compiles staggered Watch+iPhone and multiple Watch scenes without losing independent pose", () => {
  const request = compositionFixtureRequest(); request.durationMs = 5000;
  const shot = compositionFixturePlan().shots[0];
  const {transition: _transition, transitionDurationMs: _duration, position: _position, ...source} = shot;
  const plan = {summary:"Watch hands off to iPhone",background:"#112233",backgroundEnd:"#445566",shots:[],layers:[
    {...source,device:"watch",camera:"orbit",startMs:0,x:.3,y:.5,scale:.6,rotateX:10,rotateY:-15,rotateZ:-4,volume:0,titles:[]},
    {...source,device:"iphone",camera:"push-in",startMs:1000,x:.7,y:.5,scale:.5,rotateX:0,rotateY:12,rotateZ:4,volume:.3},
  ]};
  const result=compileVideoComposition(request,plan);
  assert.equal(result.timeline.clips.length,0);
  assert.equal(timelineDuration(result.timeline),5000);
  assert.deepEqual(result.timeline.layers?.map(layer=>[layer.startMs,layer.deviceFrame?.device,layer.volume]),[[0,"watch",0],[1000,"iphone",.3]]);
  assert.equal(result.timeline.layers?.[0].deviceFrame?.motion,"orbit");
  assert.equal(result.timeline.layers?.[1].deviceFrame?.scale,.5);
  assert.equal(result.timeline.layers?.[1].deviceFrame?.animation?.keyframes?.[0].scale,.39);
  assert.deepEqual([result.timeline.labels[0].startMs,result.timeline.labels[0].endMs],[1000,5000]);
  plan.layers[1].device="watch";
  assert.deepEqual(compileVideoComposition(request,plan).timeline.layers?.map(layer=>layer.deviceFrame?.device),["watch","watch"]);
  const layerOnly = {...request,timeline:{...request.timeline,clips:[],layers:result.timeline.layers}};
  assert.doesNotThrow(()=>normalizeVideoCompositionRequest(layerOnly));
  const fromLayer={...plan,layers:plan.layers.map(layer=>({...layer,sourceClipId:result.timeline.layers![0].id}))};
  assert.equal(compileVideoComposition(layerOnly,fromLayer).timeline.layers?.length,2);
});

test("parallel plans cannot exceed source trims, inject transitions, use invalid pose or escape duration", () => {
  const request = compositionFixtureRequest(); request.durationMs=3000;
  const {transition: _transition, transitionDurationMs: _duration, position: _position,...shot}=compositionFixturePlan().shots[0];
  const layer={...shot,device:"watch",camera:"pan-left",startMs:1000,x:.1,y:.5,scale:.25,rotateX:0,rotateY:60,rotateZ:0,volume:0};
  const plan={summary:"A Watch scene",background:"#112233",backgroundEnd:"#445566",shots:[],layers:[layer]};
  const result=compileVideoComposition(request,plan);
  assert.equal(result.timeline.layers![0].outMs,3000);
  assert.equal(result.timeline.layers![0].deviceFrame?.animation?.keyframes?.[1].timeMs,2000);
  assert.equal(timelineDuration(result.timeline),3000);
  for(const changes of [{sourceClipId:"invented"},{inMs:0},{transition:"crossfade"},{scale:.1},{rotateY:90},{startMs:-1},{camera:"fold"},{device:"none"}]) assert.throws(()=>compileVideoComposition(request,{...plan,layers:[{...layer,...changes}]}));
  assert.throws(()=>compileVideoComposition(request,{...plan,layers:[{...layer,startMs:3000}]}),/No composition footage/);
  assert.throws(()=>compileVideoComposition(request,{...plan,layers:Array.from({length:13},()=>layer)}),/12/);
});

test("composer emits a global zoom/focus camera for unframed footage and rejects invalid focus or timing", () => {
  const request = compositionFixtureRequest();
  request.timeline.camera = {zoom:4,x:0,y:0};
  const plan = compositionFixturePlan();
  for (const shot of plan.shots) Object.assign(shot,{device:"none",camera:"still",entrance:"none",exit:"none"});
  const camera = {zoom:1,x:.5,y:.5,keyframes:[{timeMs:0,zoom:1,easing:"ease-in-out"},{timeMs:1500,zoom:2.5,x:.7,y:.3},{timeMs:5000,zoom:1}]};
  const result = compileVideoComposition(request,{...plan,camera});
  assert.deepEqual(result.timeline.camera,camera);
  assert.ok(result.timeline.clips.every(clip => !clip.deviceFrame));
  assert.equal(compileVideoComposition(request,{...plan,camera:null}).timeline.camera,undefined,"new scenes clear the input camera when no move is requested");
  for (const invalid of [{...camera,zoom:5},{...camera,x:-.1},{...camera,unknown:true},{...camera,keyframes:[{timeMs:7000,zoom:2}]}]) {
    assert.throws(()=>compileVideoComposition(request,{...plan,camera:invalid}));
  }
  assert.deepEqual(videoComposerCatalog(true).sceneCamera.presets,["zoom-in","zoom-out","focus-return"]);
});
