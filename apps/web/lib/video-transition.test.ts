import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { VideoClip } from "@relay/core";
import { timelineJoinFilter } from "./video-transition.ts";
const run = promisify(execFile);
const clip = (id: string): VideoClip => ({ id, sourceUrl: "https://example.com/source.mp4", name: id, kind: "video", inMs: 0, outMs: 1000, fit: "cover", x: .5, y: .5, zoom: 1, volume: 1 });

test("all transition expressions render actual overlapping pictures and audio", { timeout: 60000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "relay-transitions-"));
  try {
    for (const color of ["red", "blue"]) await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `color=${color}:size=80x80:rate=30:duration=1`, "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", join(dir, `${color}.mp4`)]);
    for (const kind of ["crossfade", "slide-left", "slide-right", "wipe-left", "wipe-right", "zoom"] as const) {
      const clips = [clip("red"), { ...clip("blue"), transition: { kind, durationMs: 400, easing: "ease-in" as const } }];
      const output = join(dir, `${kind}.mp4`);
      await run("ffmpeg", ["-v", "error", "-y", "-i", join(dir, "red.mp4"), "-i", join(dir, "blue.mp4"), "-filter_complex_threads", "1", "-filter_complex", timelineJoinFilter(clips), "-map", "[video]", "-map", "[audio]", "-t", "1.6", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", output]);
      const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "json", output]);
      assert.ok(Math.abs(Number(JSON.parse(stdout).format.duration) - 1.6) < .06);
      const image = join(dir, `${kind}.rgb`);
      await run("ffmpeg", ["-v", "error", "-y", "-ss", "0.8", "-i", output, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", image]);
      const pixels = await readFile(image); let red = 0, blue = 0;
      for (let i = 0; i < pixels.length; i += 3) { red += pixels[i]; blue += pixels[i + 2]; }
      assert.ok(red > blue, `${kind}: ease-in midpoint must still show more outgoing than incoming`);
      assert.ok(blue > 1000, `${kind}: incoming picture appears during overlap`);
    }
    for (const transitionIndex of [1, 2]) {
      const clips = [clip("red"), clip("blue"), clip("red")];
      clips[transitionIndex].transition = { kind: "crossfade", durationMs: 400 };
      const output = join(dir, `mixed-${transitionIndex}.mp4`);
      await run("ffmpeg", ["-v", "error", "-y", "-i", join(dir, "red.mp4"), "-i", join(dir, "blue.mp4"), "-i", join(dir, "red.mp4"), "-filter_complex_threads", "1", "-filter_complex", timelineJoinFilter(clips), "-map", "[video]", "-map", "[audio]", "-c:v", "libx264", "-c:a", "aac", output]);
      const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=duration,codec_type", "-of", "json", output]);
      const probe = JSON.parse(stdout);
      assert.ok(Math.abs(Number(probe.format.duration) - 2.6) < .06, "mixed cuts and transitions retain the scheduled duration");
      for (const stream of probe.streams) assert.ok(Math.abs(Number(stream.duration) - 2.6) < .06, `${stream.codec_type} follows timeline timing`);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
