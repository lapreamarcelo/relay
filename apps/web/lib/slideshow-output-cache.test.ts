import assert from "node:assert/strict";
import test from "node:test";
import type { SlideshowProject } from "@relay/core";
import { parseSlideshowOutputCache, slideshowOutputFingerprint } from "./slideshow-output-cache.ts";

const project: SlideshowProject = { id: "slides", name: "Launch", caption: "Caption", brandId: "brand", createdAt: "2026-10-25", updatedAt: "2026-10-25", output: { format: "video" }, slides: [{ id: "one", mediaUrl: "https://media.example/one.jpg", fit: "contain", text: "Launch", textPosition: "bottom", textSize: 64, textFont: "modern", textColor: "#fff", textBackground: "none" }] };

test("fingerprint ignores saves, flattened render URLs, object key order and implicit defaults", () => {
  const saved = { ...project, createdAt: "later", updatedAt: "later", output: { format: "video" as const, imageSeconds: 8 }, slides: [{ ...project.slides[0], renderedUrl: "https://media.example/rendered.jpg" }] };
  assert.equal(slideshowOutputFingerprint(project), slideshowOutputFingerprint(saved));
  // Reorder nested source properties without changing their values.
  saved.slides[0] = Object.fromEntries(Object.entries(saved.slides[0]).reverse()) as typeof saved.slides[0];
  assert.equal(slideshowOutputFingerprint(project), slideshowOutputFingerprint(saved));
});

test("fingerprint changes for source, design, order, timing and post metadata changes", () => {
  const fingerprint = slideshowOutputFingerprint(project);
  for (const changed of [
    { ...project, name: "Changed" }, { ...project, caption: "Changed" }, { ...project, brandId: "other" },
    { ...project, output: { format: "video" as const, imageSeconds: 9 } }, { ...project, output: { format: "images" as const } },
    { ...project, slides: [{ ...project.slides[0], text: "Changed" }] }, { ...project, slides: [{ ...project.slides[0], mediaUrl: "https://media.example/other.jpg" }] },
    { ...project, slides: [{ ...project.slides[0], deviceFrame: { device: "phone", background: "#000" } }] },
  ]) assert.notEqual(slideshowOutputFingerprint(changed as SlideshowProject), fingerprint);
  const two = { ...project, slides: [project.slides[0], { ...project.slides[0], id: "two" }] };
  assert.notEqual(slideshowOutputFingerprint(two), slideshowOutputFingerprint({ ...two, slides: [...two.slides].reverse() }));
});

test("cache only recovers matching project content and valid frozen render metadata", () => {
  const cache = { fingerprint: slideshowOutputFingerprint(project), job: { id: "job", projectId: "video", status: "running", revision: 1, progress: 30 }, video: { projectId: "video", durationMs: 8_000 }, result: null };
  assert.deepEqual(parseSlideshowOutputCache(JSON.stringify(cache), project), cache);
  assert.equal(parseSlideshowOutputCache(JSON.stringify(cache), { ...project, caption: "Changed" }), null);
  assert.equal(parseSlideshowOutputCache("{", project), null);
  assert.equal(parseSlideshowOutputCache(JSON.stringify({ ...cache, video: null }), project), null);
  assert.equal(parseSlideshowOutputCache(JSON.stringify({ ...cache, video: { projectId: "wrong", durationMs: 8_000 } }), project), null);
});
