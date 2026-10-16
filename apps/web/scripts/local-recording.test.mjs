import test from "node:test";
import assert from "node:assert/strict";
import { normalizeRecordingPlan, axeGestureArguments, gestureSamples } from "./local-recording-plan.mjs";
import { mkdtemp, writeFile, readFile, rm, chmod, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);

const plan = { width: 400, height: 800, durationMs: 1000, steps: [{ kind: "tap", timeMs: 100, from: { x: .5, y: .25 } }, { kind: "swipe", timeMs: 400, durationMs: 400, from: { x: 0, y: 1 }, to: { x: 1, y: 0 } }] };
test("local recording plan rejects out-of-bounds, overlapping, and overlong gestures", () => {
  assert.equal(normalizeRecordingPlan(plan).steps.length, 2);
  assert.throws(() => normalizeRecordingPlan({ ...plan, durationMs: 500 }), /beyond/);
  assert.throws(() => normalizeRecordingPlan({ ...plan, width: 0 }), /width/);
  assert.throws(() => normalizeRecordingPlan({ ...plan, steps: [{ ...plan.steps[0], from: { x: 3, y: .2 } }] }), /point/);
  assert.throws(() => normalizeRecordingPlan({ ...plan, steps: [...plan.steps, plan.steps[0]] }), /ordered/);
});
test("AXE commands use logical device points and sample source-relative gesture time", () => {
  const normalized = normalizeRecordingPlan(plan);
  assert.deepEqual(axeGestureArguments(normalized.steps[0], normalized, "device"), ["tap", "-x", "200", "-y", "200", "--udid", "device"]);
  const swipe = normalized.steps[1];
  assert.ok(axeGestureArguments(swipe, normalized, "device").includes("0.4"));
  const events = gestureSamples(swipe, 425);
  assert.deepEqual(events[0], { kind: "down", x: 0, y: 1, timeMs: 425 });
  assert.deepEqual(events.at(-1), { kind: "up", x: 1, y: 0, timeMs: 825 });
  assert.equal(events[2].x, .5); assert.equal(events[2].timeMs, 625);
});

test("explicit CLI recording finalizes the video and event sidecar; dry-run never captures", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-recording-test-"));
  try {
    const planFile = join(directory, "plan.json"), video = join(directory, "capture.mp4"), log = join(directory, "commands.log");
    await writeFile(planFile, JSON.stringify({ width: 400, height: 800, durationMs: 250, steps: [{ kind: "tap", timeMs: 30, from: { x: .5, y: .25 } }] }));
    const udid = "12345678-1234-1234-1234-123456789abc";
    const script = new URL("./local-recording.mjs", import.meta.url).pathname;
    const args = [script, "--udid", udid, "--plan", planFile, "--output", video];
    const dry = await run(process.execPath, [...args, "--dry-run"]);
    assert.equal(JSON.parse(dry.stdout).recording[1], "simctl");
    await assert.rejects(access(video));
    const fakeTool = `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
if (process.argv[1].endsWith('axe')) {
  fs.appendFileSync(process.env.RELAY_RECORDING_TEST_LOG, JSON.stringify(args) + '\\n');
  process.exit(0);
} else {
  process.stderr.write('Recording started\\n');
  const timer = setInterval(() => {}, 100);
  process.once('SIGINT', () => { fs.writeFileSync(args.at(-1), 'mock-video'); clearInterval(timer); process.exit(0); });
}
`;
    for (const name of ["axe", "xcrun"]) { const path = join(directory, name); await writeFile(path, fakeTool); await chmod(path, 0o755); }
    await run(process.execPath, args, { env: { ...process.env, PATH: directory + ":" + process.env.PATH, RELAY_RECORDING_TEST_LOG: log }, timeout: 5000 });
    assert.equal(await readFile(video, "utf8"), "mock-video");
    const sidecar = JSON.parse(await readFile(video.replace(/\.mp4$/, ".events.json"), "utf8"));
    assert.equal(sidecar.events.length, 2); assert.equal(sidecar.events[0].kind, "down");
    assert.ok(sidecar.events[0].timeMs >= 30); assert.equal(sidecar.recording.logicalWidth, 400);
    assert.match(await readFile(log, "utf8"), /"tap","-x","200","-y","200"/);
    await assert.rejects(run(process.execPath, args), /Refusing to overwrite/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
