import assert from "node:assert/strict";
import test from "node:test";
import { emptyTimeline } from "./video-timeline.ts";
import { applySavedVideoTemplate } from "./video-templates.ts";

test("saved device layout wraps replacement footage without sharing mutable frame settings", () => {
  const clip = {id:"original",name:"Screen",sourceUrl:"https://media.example/original.png",kind:"image" as const,inMs:0,outMs:1000,fit:"contain" as const,x:.5,y:.5,zoom:1,volume:1};
  const frame = {device:"phone" as const,background:"#E8E4DF",color:"#20242A"};
  const template = {...emptyTimeline(),clips:[{...clip,deviceFrame:frame}]};
  const result = applySavedVideoTemplate(template,{...emptyTimeline(),clips:[{...clip,id:"replacement",sourceUrl:"https://media.example/new.mp4",kind:"video",outMs:2000}]});
  assert.equal(result.clips[0].sourceUrl,"https://media.example/new.mp4");
  assert.equal(result.clips[0].kind,"video");
  assert.deepEqual(result.clips[0].deviceFrame,frame);
  result.clips[0].deviceFrame!.color="#FFFFFF";
  assert.equal(frame.color,"#20242A");
});
