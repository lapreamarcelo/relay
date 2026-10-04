import test from "node:test";
import assert from "node:assert/strict";
import type { LayerAnimation } from "@relay/core";
import { animationExpressions, animationState, easingProgress, normalizeLayerAnimation } from "./video-animation.ts";
// Interpret only our algebra to compare the preview and export expression output.
const evaluate = (value:number|string,time:number):number => typeof value === "number" ? value : Function("clock","min","max","lt","iff",`return ${value.replaceAll("if(","iff(")};`)(time,Math.min,Math.max,(a:number,b:number)=>a<b?1:0,(c:number,a:number,b:number)=>c?a:b);

test("sparse keyframes interpolate independently with departing easing and hold final values",()=>{
  const animation:LayerAnimation={keyframes:[{timeMs:0,x:.1,easing:"ease-in"},{timeMs:1000,x:.9},{timeMs:1500,y:.8}]};
  const middle=animationState(animation,500,2000,{x:.5,y:.2});
  assert.ok(Math.abs(middle.x-.3)<1e-10); assert.ok(Math.abs(middle.y-.4)<1e-10);
  assert.equal(animationState(animation,1900,2000).x,.9);
  assert.equal(easingProgress(.25,"ease-in-out"),.125);
});

test("all entrance and exit effects match symbolic export math at boundaries and intermediate times",()=>{
  for(const preset of ["fade","slide-up","slide-down","slide-left","slide-right","pop","zoom","typewriter"] as const) {
    for(const easing of ["linear","ease-in","ease-out","ease-in-out"] as const) {
      const animation:LayerAnimation={entrance:{preset,durationMs:900,easing},exit:{preset,durationMs:900,easing},keyframes:[{timeMs:0,x:.2,scale:.6,opacity:.8,easing},{timeMs:800,x:.8,scale:1.4,opacity:1}]};
      for(const time of [0,100,250,499,500,750,1000]) {
        const numeric=animationState(animation,time,1000),symbolic=animationExpressions(animation,"clock",1000);
        for(const key of Object.keys(numeric) as Array<keyof typeof numeric>) assert.ok(Math.abs(numeric[key]-evaluate(symbolic[key],time))<1e-10,`${preset}/${easing}/${time}/${key}`);
      }
    }
  }
});

test("entrance/exit duration caps preserve a stable middle and keyframes apply before relative presets",()=>{
  const a:LayerAnimation={entrance:{preset:"pop",durationMs:2000,easing:"linear"},exit:{preset:"fade",durationMs:2000,easing:"linear"},keyframes:[{timeMs:0,scale:1.2}]};
  assert.equal(animationState(a,0,1000).scale,.78);
  assert.equal(animationState(a,500,1000).opacity,1);
  assert.equal(animationState(a,1000,1000).opacity,0);
  assert.equal(animationState({entrance:{preset:"typewriter",durationMs:200,easing:"linear"}},100,1000).reveal,.5);
});

test("animation validation rejects invalid, unsupported and ambiguous properties",()=>{
  assert.throws(()=>normalizeLayerAnimation({entrance:{preset:"typewriter",durationMs:300}},"device"),/text/);
  assert.throws(()=>normalizeLayerAnimation({keyframes:[{timeMs:0,foldAngle:10}]}),/Duo/);
  assert.throws(()=>normalizeLayerAnimation({keyframes:[{timeMs:0,rotateX:10}]}),/2D/);
  assert.throws(()=>normalizeLayerAnimation({keyframes:[{timeMs:1,x:.5},{timeMs:1,y:.5}]}),/increasing/);
  assert.throws(()=>normalizeLayerAnimation({keyframes:[{timeMs:1}]}),/property/);
  assert.throws(()=>normalizeLayerAnimation({entrance:{preset:"fade",durationMs:100,easing:"elastic"}}),/easing/);
  assert.deepEqual(normalizeLayerAnimation({keyframes:[{timeMs:0,foldAngle:140,opacity:.5}]},"device",true),{keyframes:[{timeMs:0,foldAngle:140,opacity:.5}]});
});

test("long sparse tracks retain numeric and export parity without losing defaults",()=>{
  const animation:LayerAnimation={keyframes:Array.from({length:100},(_,i)=>({timeMs:i*100,x:.1+i*.008,easing:"ease-in-out"}))};
  for(const time of [0,750,1234,5000,9850,10000]) {
    const actual=animationState(animation,time,10000,{y:undefined});
    assert.equal(actual.y,.2);
    assert.ok(Math.abs(actual.x-evaluate(animationExpressions(animation,"clock",10000).x,time))<1e-10);
  }
});
