#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { normalizeRecordingPlan, axeGestureArguments, gestureSamples } from "./local-recording-plan.mjs";

const help = `Relay local Simulator recorder

Explicitly records one booted Simulator and logs the AXE gestures in a JSON plan.
Does not observe manual mouse clicks, record your desktop, launch apps, or upload.

node apps/web/scripts/local-recording.mjs --udid <UUID> --plan <plan.json> --output <capture.mp4> [--dry-run]

Plan: { "width": 402, "height": 874, "durationMs": 12000, "steps": [
  { "kind": "tap", "timeMs": 1000, "from": { "x": 0.5, "y": 0.6 } },
  { "kind": "swipe", "timeMs": 3000, "durationMs": 600,
    "from": { "x": 0.5, "y": 0.8 }, "to": { "x": 0.5, "y": 0.3 } }
] }

Width/height are logical Simulator points, not Retina screenshot pixels.
Requires Xcode simctl and AXE on PATH. Open the target app before running.
Import capture.mp4 and capture.events.json using Relay's Record a source panel.
AXE dispatch latency and intermediate swipe positions are approximations.
`;

async function main() {
  const options = {};
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === "--help" || arg === "-h") { process.stdout.write(help); return; }
    if (arg === "--dry-run") options.dryRun = true;
    else if (["--udid", "--plan", "--output"].includes(arg) && process.argv[i + 1]) options[arg.slice(2)] = process.argv[++i];
    else throw new Error(`Unknown or incomplete option: ${arg}`);
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(options.udid ?? "") || !options.plan || !options.output) throw new Error("Pass an explicit Simulator UUID, plan, and output. Use --help for the format.");
  const plan = normalizeRecordingPlan(JSON.parse(await readFile(resolve(options.plan), "utf8")));
  const output = resolve(options.output);
  if (!output.endsWith(".mp4")) throw new Error("The output must end with .mp4.");
  const sidecar = output.replace(/\.mp4$/, ".events.json");
  if (options.dryRun) {
    process.stdout.write(JSON.stringify({ recording: ["xcrun", "simctl", "io", options.udid, "recordVideo", "--codec=h264", output], gestures: plan.steps.map(step => ({ timeMs: step.timeMs, command: ["axe", ...axeGestureArguments(step, plan, options.udid)] })), sidecar }, null, 2) + "\n"); return;
  }
  for (const path of [output, sidecar]) {
    let exists = false; try { await access(path); exists = true; } catch { /* absent */ }
    if (exists) throw new Error(`Refusing to overwrite ${path}.`);
  }
  await mkdir(dirname(output), { recursive: true });
  const run = (command, args) => new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let error = ""; child.stderr.on("data", chunk => error += chunk);
    child.once("error", reject); child.once("exit", code => code === 0 ? resolve() : reject(new Error(`${command} failed: ${error.trim() || code}`)));
  });
  // Verify dependencies before asking the Simulator to record.
  await run("axe", ["--version"]);
  const recorder = spawn("xcrun", ["simctl", "io", options.udid, "recordVideo", "--codec=h264", output], { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "", interrupted = false, recorderDone = false;
  const stopped = new Promise((resolve, reject) => {
    recorder.once("error", reject);
    recorder.once("exit", (code, signal) => { recorderDone = true; code === 0 || signal === "SIGINT" ? resolve() : reject(new Error(`simctl recording failed: ${stderr.trim() || code}`)); });
  });
  // Attach a rejection handler immediately; startup and gesture errors still await it below.
  stopped.catch(() => {});
  const interrupt = () => { interrupted = true; if (!recorderDone) recorder.kill("SIGINT"); };
  process.once("SIGINT", interrupt); process.once("SIGTERM", interrupt);
  let startedAt;
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("simctl did not announce recording startup within 15 seconds.")), 15000);
      recorder.stderr.on("data", chunk => {
        stderr = (stderr + chunk).slice(-20000);
        if (startedAt === undefined && /Recording started/i.test(stderr)) { startedAt = performance.now(); clearTimeout(timeout); resolve(); }
      });
      recorder.once("error", error => { clearTimeout(timeout); reject(error); });
      recorder.once("exit", () => { clearTimeout(timeout); if (startedAt === undefined) reject(new Error(`simctl could not start: ${stderr.trim()}`)); });
    });
    process.stdout.write(`Recording ${options.udid}. Ctrl-C stops and saves the partial take.\n`);
    const events = [];
    const waitUntil = async timeMs => {
      while (!interrupted && !recorderDone && performance.now() - startedAt < timeMs) await new Promise(resolve => setTimeout(resolve, Math.min(100, timeMs - (performance.now() - startedAt))));
    };
    for (const step of plan.steps) {
      await waitUntil(step.timeMs);
      if (interrupted || recorderDone) break;
      const timeMs = performance.now() - startedAt;
      await run("axe", axeGestureArguments(step, plan, options.udid));
      events.push(...gestureSamples(step, timeMs));
    }
    await waitUntil(plan.durationMs);
    const durationMs = Math.round(performance.now() - startedAt);
    if (!recorderDone) recorder.kill("SIGINT");
    await stopped;
    const pointer = { events: events.filter(event => event.timeMs <= durationMs), style: "touch", color: "#FFFFFF", size: 24, smoothing: 80, display: "tap-only", idleMs: 1200, fadeMs: 250 };
    await writeFile(sidecar, JSON.stringify({ ...pointer, recording: { videoFile: output, source: "simctl-axe", durationMs, logicalWidth: plan.width, logicalHeight: plan.height, timing: "AXE command dispatch; swipe positions interpolated; native delivery latency is not observed" } }, null, 2) + "\n", { flag: "wx" });
    process.stdout.write(`Saved ${output}\nSaved ${sidecar}\n`);
  } finally {
    process.removeListener("SIGINT", interrupt); process.removeListener("SIGTERM", interrupt);
    if (!recorderDone) {
      recorder.kill("SIGINT");
      let timeout;
      try { await Promise.race([stopped.catch(() => {}), new Promise(resolve => { timeout = setTimeout(() => { if (!recorderDone) recorder.kill("SIGKILL"); resolve(); }, 5000); })]); }
      finally { clearTimeout(timeout); }
    }
  }
}
main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
