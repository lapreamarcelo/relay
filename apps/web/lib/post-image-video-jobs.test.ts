import assert from "node:assert/strict";
import test from "node:test";
import { postImageVideoTimeline } from "./post-image-video-jobs.ts";

test("single images become eight second contained silent vertical MP4s", () => {
  const timeline = postImageVideoTimeline(["https://media.example/one.png"]);
  assert.equal(timeline.aspectRatio, "9:16");
  assert.equal(timeline.background?.color, "#000000");
  assert.equal(timeline.exportSettings?.format, "mp4");
  assert.equal(timeline.clips[0].outMs, 8000);
  assert.equal(timeline.clips[0].fit, "contain");
  assert.equal(timeline.clips[0].volume, 0);
  assert.equal(timeline.music.url, "");
  assert.equal(timeline.music.volume, 0);
});

test("carousels preserve image order with equal four second hard cuts and configurable timing", () => {
  const urls = ["https://media.example/second.png", "https://media.example/first.png"];
  const timeline = postImageVideoTimeline(urls);
  assert.deepEqual(timeline.clips.map(clip => clip.sourceUrl), urls);
  assert.deepEqual(timeline.clips.map(clip => [clip.inMs, clip.outMs, clip.transition]), [[0, 4000, undefined], [0, 4000, undefined]]);
  assert.equal(postImageVideoTimeline(urls, 5).clips[0].outMs, 5000);
  assert.equal(postImageVideoTimeline([urls[0]], 10).clips[0].outMs, 10000);
  assert.throws(() => postImageVideoTimeline(urls, 8));
  assert.throws(() => postImageVideoTimeline([], 4));
});
