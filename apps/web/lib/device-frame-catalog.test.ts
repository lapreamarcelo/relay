import assert from "node:assert/strict";
import test from "node:test";
import { deviceFrameCatalog } from "./device-frame-catalog.ts";
import { normalizeDeviceFrame, deviceFrameGeometry } from "./device-frames.ts";
import { emptyTimeline, normalizeVideoTimeline, videoSizes } from "./video-timeline.ts";
import { normalizeSlides } from "./slideshows.ts";

test("agent catalog examples work in both save contracts and geometry matches exports", () => {
  const catalog = deviceFrameCatalog();
  assert.deepEqual(catalog.frames.map(frame => frame.device), catalog.fields.device.values);
  for (const frame of catalog.frames) {
    assert.deepEqual(normalizeDeviceFrame(frame.example), frame.example);
    const video = normalizeVideoTimeline({...emptyTimeline(), clips:[{sourceUrl:"https://media.example/demo.mp4",kind:"video",inMs:0,outMs:2000,deviceFrame:frame.example}]});
    const slides = normalizeSlides([{mediaUrl:"https://media.example/demo.png",deviceFrame:frame.example}]);
    assert.deepEqual(video.clips[0].deviceFrame, frame.example);
    assert.deepEqual(slides?.[0].deviceFrame, frame.example);
    assert.equal(frame.layouts.length, Object.keys(videoSizes).length);
    for (const layout of frame.layouts) {
      const {aspectRatio, ...geometry} = layout;
      const [width,height] = videoSizes[aspectRatio as keyof typeof videoSizes];
      assert.deepEqual(geometry, deviceFrameGeometry(width,height,frame.device));
    }
  }
});


test("motion catalog example survives the video contract and is rejected for still slides", () => {
  const example = deviceFrameCatalog().motionExample;
  const frame = normalizeDeviceFrame(example, {allowMotion:true});
  assert.deepEqual(frame,example);
  const timeline = normalizeVideoTimeline({...emptyTimeline(),background:{color:"#182422",endColor:"#537C68"},clips:[{sourceUrl:"https://media.example/demo.mp4",kind:"video",outMs:5000,deviceFrame:example}]});
  assert.deepEqual(timeline.clips[0].deviceFrame,example);
  assert.deepEqual(timeline.background,{color:"#182422",endColor:"#537C68"});
  assert.equal(normalizeSlides([{mediaUrl:"https://media.example/demo.png",deviceFrame:example}]),null);
});

test("background catalog exposes an image contract accepted by the timeline normalizer", () => {
  const canvas = deviceFrameCatalog().canvasBackground;
  assert.equal(canvas.field,"timeline.background");
  assert.equal(canvas.imageUrl.maximumBytes,30*1024*1024);
  assert.equal(canvas.imageUrl.maximumPixels,40_000_000);
  assert.deepEqual(canvas.imageFit.values,["cover","contain"]);
  const background=normalizeVideoTimeline({...emptyTimeline(),background:canvas.example}).background;
  assert.deepEqual(background,canvas.example);
});
