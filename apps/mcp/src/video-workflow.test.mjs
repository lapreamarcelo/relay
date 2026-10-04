import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { register } from "tsx/esm/api";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

register();
const { normalizeVideoTimeline } = await import("../../web/lib/video-timeline.ts");
const { serializeVideoProject } = await import("../../web/lib/videos.ts");
const { deviceFrameCatalog } = await import("../../web/lib/device-frame-catalog.ts");
const { videoAnimationCatalog } = await import("../../web/lib/video-animation-catalog.ts");
const cwd = fileURLToPath(new URL("../", import.meta.url));

// The real MCP entry point, transports and production project normalizers run.
// The local API adapter replaces database/storage/job workers; no cloud calls.
for (const transportName of ["stdio", "http"]) test(`${transportName} MCP controls complete editable app demos and render jobs`, { timeout: 30000 }, async () => {
  const projects = new Map(), jobs = new Map(), calls = [];
  const backend = createServer(async (request, response) => {
    const reply = (status, payload) => { response.writeHead(status, { "Content-Type": "application/json" }); response.end(JSON.stringify(payload)); };
    if (request.headers.authorization !== "Bearer relay_sk_promotion") return reply(401, { error: "Unauthorized" });
    const url = new URL(request.url, "http://local.test");
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
    calls.push({ path: url.pathname, method: request.method, body });
    try {
      if (url.pathname === "/api/v1/capabilities") return reply(200, { data: url.searchParams.get("section") === "device-frames" ? deviceFrameCatalog() : url.searchParams.get("section") === "video-animation" ? videoAnimationCatalog() : { scopes: ["videos:read", "videos:write", "media:write"], deviceFrames: deviceFrameCatalog(), videoAnimations: videoAnimationCatalog() } });
      if (url.pathname === "/api/v1/media") return reply(201, { key: "screen.mp4", url: "https://media.example.test/screen.mp4", uploadUrl: "https://upload.example.test/screen.mp4" });
      if (url.pathname === "/api/v1/videos/compose") {
        if (request.method === "GET") return reply(200, { data: { available: true, provider: "openai" } });
        assert.equal(body.prompt, "Make a cinematic launch for My app");
        assert.equal(body.productName, "My app");
        assert.equal(body.durationMs, 15000);
        return reply(200, { data: { timeline: normalizeVideoTimeline(body.timeline), summary: "Editable launch preview", warnings: [], provider: "openai" } });
      }
      if (url.pathname === "/api/v1/videos") {
        if (request.method === "GET") {
          const id = url.searchParams.get("id");
          return reply(200, { data: id ? projects.get(id) : [...projects.values()] });
        }
        const existing = body.id && projects.get(body.id);
        if (request.method === "PATCH" && (!existing || body.revision !== existing.revision)) return reply(409, { error: "Project changed or was deleted. Reload before saving." });
        const project = serializeVideoProject({ id: existing?.id ?? crypto.randomUUID(), brand_id: null, name: body.name, caption: body.caption ?? "", source_url: body.sourceUrl ?? "", source_folder_id: null, music_url: body.musicUrl || null, music_folder_id: null, labels: body.labels ?? [], timeline: normalizeVideoTimeline(body.timeline), revision: (existing?.revision ?? 0) + 1, rendered_url: null, created_at: existing?.createdAt ?? new Date(), updated_at: new Date() });
        projects.set(project.id, project);
        return reply(existing ? 200 : 201, { data: project });
      }
      if (url.pathname === "/api/v1/videos/templates") return reply(201, { data: { id: "template", ...body, timeline: normalizeVideoTimeline(body.timeline) } });
      if (url.pathname === "/api/v1/videos/variants") {
        const source = projects.get(body.id);
        assert.ok(source); assert.equal(body.labelId, "hook"); assert.equal(body.clientRequestId, "ten-hooks"); assert.equal(body.render, true);
        return reply(201, { data: body.hooks.map((hook, index) => {
          const timeline = structuredClone(source.timeline); timeline.labels.find(label => label.id === body.labelId).text = hook;
          return { project: { ...source, id: `variant-${index}`, timeline }, job: { id: `variant-job-${index}`, status: "queued" } };
        }) });
      }
      if (url.pathname === "/api/v1/videos/render") {
        const project = projects.get(body.id);
        assert.ok(project);
        const job = { id: crypto.randomUUID(), projectId: project.id, revision: project.revision, status: "queued", progress: 0, snapshot: structuredClone(project.timeline) };
        jobs.set(job.id, job);
        return reply(202, { job });
      }
      if (url.pathname === "/api/v1/videos/jobs") {
        const job = jobs.get(body?.id ?? url.searchParams.get("id"));
        assert.ok(job);
        if (request.method === "PATCH") { job.status = body.action === "cancel" ? "cancelled" : "queued"; return reply(200, { data: job }); }
        job.status = "completed"; job.progress = 100; job.renderedUrl = "https://media.example.test/promotion.mp4";
        return reply(200, { data: job });
      }
      return reply(404, { error: "Unexpected test endpoint" });
    } catch (error) { return reply(400, { error: error.message }); }
  });
  backend.listen(0, "127.0.0.1"); await once(backend, "listening");
  const env = Object.fromEntries(Object.entries({ ...process.env, RELAY_URL: `http://127.0.0.1:${backend.address().port}`, RELAY_API_KEY: "relay_sk_promotion", MCP_TRANSPORT: transportName }).filter(([, value]) => typeof value === "string"));
  const client = new Client({ name: "app-promotion-agent", version: "1.0" });
  let child;
  try {
    let transport;
    if (transportName === "stdio") transport = new StdioClientTransport({ command: process.execPath, args: ["--import", "tsx", "src/index.ts"], cwd, env, stderr: "pipe" });
    else {
      const reservation = createServer(); reservation.listen(0, "127.0.0.1"); await once(reservation, "listening");
      const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
      child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], { cwd, env: { ...env, MCP_PORT: String(port), MCP_HOST: "127.0.0.1" }, stdio: ["ignore", "pipe", "pipe"] });
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("HTTP MCP did not start")), 10000);
        child.stderr.on("data", data => { if (String(data).includes("listening")) { clearTimeout(timer); resolve(); } });
        child.once("exit", code => { clearTimeout(timer); reject(new Error(`MCP exited ${code}`)); });
      });
      transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), { requestInit: { headers: { Authorization: "Bearer relay_sk_promotion" } } });
    }
    await client.connect(transport);
    const call = async (name, args = {}) => {
      const result = await client.callTool({ name, arguments: args });
      assert.ok(!result.isError, `${name}: ${JSON.stringify(result.content)}`);
      return result.structuredContent ?? JSON.parse(result.content[0].text);
    };
    const tools = (await client.listTools()).tools;
    for (const name of ["list_device_frames", "list_video_animations", "get_capabilities", "prepare_media_upload", "list_videos", "save_video", "render_video", "get_video_render_job", "update_video_render_job", "save_video_template", "generate_video_captions", "create_video_variants"]) assert.ok(tools.some(tool => tool.name === name), name);
    const catalog = (await call("list_device_frames")).data;
    assert.equal(catalog.frames.length, 8);
    assert.equal(catalog.parallelLayers.maximum, 12);
    const animations = (await call("list_video_animations")).data;
    assert.ok(animations.textPresets.includes("typewriter")); assert.ok(animations.transitionKinds.includes("crossfade"));
    await call("get_capabilities");
    const upload = await call("prepare_media_upload", { fileName: "screen.mp4", contentType: "video/mp4" });
    assert.equal(upload.url, "https://media.example.test/screen.mp4");
    const timeline = { version: 1, aspectRatio: "9:16", background: { color: "#112233", endColor: "#445566" }, clips: [{ id: "recording", name: "My app", sourceUrl: upload.url, kind: "video", inMs: 1000, outMs: 6000, sourceDurationMs: 8000, fit: "contain", x: .4, y: .6, zoom: 1.2, volume: .35, deviceFrame: { device: "iphone-duo", color: "#171717", background: "#223344", x: .55, y: .45, scale: .85, rotateX: -8, rotateY: 15, rotateZ: -6, foldAngle: 150, motion: "fold-cycle", motionDurationMs: 2000 } }], labels: [{ id: "hook", text: "Meet my app", x: .4, y: .2, width: .7, height: .15, fontSize: 64, font: "editorial", textColor: "#FFFFFF", background: "dark", backgroundColor: "#332211", style: "dark", startMs: 500, endMs: 3500 }], music: { url: "https://media.example.test/music.wav", name: "Launch music", startMs: 1000, endMs: 4000, offsetMs: 250, volume: .45, fadeInMs: 500, fadeOutMs: 600 }, coverMs: 1500 };
    timeline.clips[0].deviceFrame.motionEasing = "ease-in-out";
    timeline.clips[0].deviceFrame.animation = { entrance: { preset: "slide-up", durationMs: 500 }, exit: { preset: "fade", durationMs: 400 }, keyframes: [{ timeMs: 0, x: .4, foldAngle: 0, easing: "ease-in-out" }, { timeMs: 2000, x: .6, foldAngle: 150, opacity: .8 }] };
    timeline.labels[0].animation = { entrance: { preset: "typewriter", durationMs: 800, easing: "linear" }, exit: { preset: "pop", durationMs: 400 }, keyframes: [{ timeMs: 0, scale: .8 }, { timeMs: 1500, scale: 1.2, rotateZ: 12 }] };
    timeline.clips.push({ ...structuredClone(timeline.clips[0]), id: "recording-two", transition: { kind: "zoom", durationMs: 600, easing: "ease-in" } });
    const source = structuredClone(timeline.clips[0]); delete source.transition;
    timeline.layers = [
      {...source, id:"watch-layer", name:"Watch", startMs:0, volume:0, deviceFrame:{device:"watch",background:"#112233",color:"#171717",x:.3,y:.5,scale:.6,motion:"orbit",motionDurationMs:2500}},
      {...source, id:"phone-layer", name:"iPhone", startMs:1000, volume:.4, deviceFrame:{device:"iphone",background:"#112233",color:"#171717",x:.7,y:.5,scale:.5,animation:{entrance:{preset:"pop",durationMs:500},keyframes:[{timeMs:0,rotateY:-20},{timeMs:2000,rotateY:20}]}}},
    ];
    assert.equal((await call("get_video_composer")).data.available, true);
    const generated = (await call("generate_video_composition", { prompt: "Make a cinematic launch for My app", productName: "My app", durationMs: 15000, timeline })).data;
    assert.deepEqual(generated.timeline, normalizeVideoTimeline(timeline));
    assert.equal(projects.size, 0, "composition only returns a preview until explicitly saved");
    const beforeInvalidCompose = calls.filter(call => call.path === "/api/v1/videos/compose").length;
    const invalidCompose = await client.callTool({ name: "generate_video_composition", arguments: { prompt: "short", timeline } });
    assert.equal(invalidCompose.isError, true);
    assert.equal(calls.filter(call => call.path === "/api/v1/videos/compose").length, beforeInvalidCompose, "invalid composition input does not reach the composition API");
    let project = (await call("save_video", { name: "App launch", timeline: generated.timeline })).data;
    project = (await call("list_videos", { id: project.id })).data;
    assert.equal(project.sourceUrl, "", "timeline projects return empty legacy source URLs");
    assert.deepEqual(project.timeline, normalizeVideoTimeline(timeline));
    const stale = structuredClone(project);
    project.timeline.labels[0].text = "Launch today"; project.timeline.labels[0].x = .6;
    project = (await call("save_video", { ...project, musicUrl: "" })).data;
    assert.equal(project.revision, 2);
    assert.equal(project.timeline.labels[0].text, "Launch today");
    const conflict = await client.callTool({ name: "save_video", arguments: stale });
    assert.equal(conflict.isError, true);
    assert.match(conflict.content[0].text, /Project changed/);
    const beforeInvalidLayer = calls.filter(call=>call.path==="/api/v1/videos").length;
    const invalidLayer = await client.callTool({name:"save_video",arguments:{name:"Unsafe layer",timeline:{...project.timeline,layers:[{...project.timeline.layers[0],transition:{kind:"crossfade",durationMs:500}}]}}});
    assert.equal(invalidLayer.isError,true);
    assert.equal(calls.filter(call=>call.path==="/api/v1/videos").length,beforeInvalidLayer,"layer transitions rejected before saving");
    const layerOnly = (await call("save_video_template",{name:"Two Watches",timeline:{...project.timeline,clips:[],layers:project.timeline.layers.map((layer,i)=>({...layer,deviceFrame:{...layer.deviceFrame,device:"watch"},startMs:i*500}))}})).data;
    assert.equal(layerOnly.timeline.clips.length,0);
    assert.deepEqual(layerOnly.timeline.layers.map(layer=>layer.deviceFrame.device),["watch","watch"]);
    const template = await call("save_video_template", { name: "Reusable launch", timeline: project.timeline });
    assert.deepEqual(template.data.timeline, project.timeline);
    for (const device of ["phone", "tablet", "browser", "iphone", "iphone-duo", "mac", "watch", "android"]) {
      const document = structuredClone(project.timeline);
      document.clips[0].deviceFrame = { device, background: "#112233", color: "#171717", motion: "orbit", rotateX: 12, rotateY: -8, rotateZ: 5, scale: .8, x: .4, y: .6, motionDurationMs: 2500 };
      const saved = await call("save_video_template", { name: `${device} launch`, timeline: document });
      assert.deepEqual(saved.data.timeline, normalizeVideoTimeline(document));
    }
    for (const motion of ["none", "orbit", "float", "fold", "unfold", "fold-cycle"]) {
      const document = structuredClone(project.timeline); document.clips[0].deviceFrame.motion = motion;
      const saved = await call("save_video_template", { name: `${motion} animation`, timeline: document });
      assert.equal(saved.data.timeline.clips[0].deviceFrame.motion, motion);
    }
    const queued = (await call("render_video", { id: project.id, async: true })).job;
    assert.equal(queued.revision, project.revision);
    assert.equal((await call("update_video_render_job", { id: queued.id, action: "cancel" })).data.status, "cancelled");
    assert.equal((await call("update_video_render_job", { id: queued.id, action: "retry" })).data.status, "queued");
    project.timeline.background.color = "#556677";
    project = (await call("save_video", project)).data;
    const completed = (await call("get_video_render_job", { id: queued.id })).data;
    assert.equal(completed.status, "completed");
    assert.equal(completed.revision, 2, "render output remains tied to its captured revision");
    assert.equal(completed.snapshot.background.color, "#112233");
    assert.equal(project.timeline.background.color, "#556677");
    const beforeVariants = structuredClone(project.timeline);
    const hooks = Array.from({ length: 10 }, (_, i) => `Hook ${i + 1}`);
    const variants = (await call("create_video_variants", { id: project.id, labelId: "hook", hooks, clientRequestId: "ten-hooks", render: true })).data;
    assert.equal(variants.length, 10);
    for (const [index, entry] of variants.entries()) {
      const expected = structuredClone(beforeVariants); expected.labels[0].text = hooks[index];
      assert.deepEqual(entry.project.timeline, expected); assert.equal(entry.job.status, "queued");
    }
    assert.deepEqual(projects.get(project.id).timeline, beforeVariants);
    const beforeInvalidVariants = calls.filter(call => call.path === "/api/v1/videos/variants").length;
    for (const change of [{ labelId: " " }, { hooks: [" "] }, { hooks: Array(21).fill("Hook") }, { hooks: ["x".repeat(501)] }]) {
      const invalidVariants = await client.callTool({ name: "create_video_variants", arguments: { id: project.id, labelId: "hook", hooks, clientRequestId: "ten-hooks", ...change } });
      assert.equal(invalidVariants.isError, true);
      assert.equal(calls.filter(call => call.path === "/api/v1/videos/variants").length, beforeInvalidVariants, "invalid batch cannot reach the API");
    }
    assert.ok(completed.renderedUrl.endsWith(".mp4"));
    assert.equal(calls.filter(call => call.path === "/api/v1/videos/render").length, 1);
    const before = calls.filter(call => call.path === "/api/v1/videos").length;
    const invalid = await client.callTool({ name: "save_video", arguments: { ...project, timeline: { ...project.timeline, clips: [{ ...project.timeline.clips[0], deviceFrame: { ...project.timeline.clips[0].deviceFrame, scale: 9 } }] } } });
    assert.equal(invalid.isError, true);
    assert.equal(calls.filter(call => call.path === "/api/v1/videos").length, before, "invalid pose must not reach the project API");
    for (const deviceFrame of [
      { device: "iphone", background: "#112233", color: "#171717", foldAngle: 30 },
      { device: "iphone", background: "#112233", color: "#171717", animation: { keyframes: [{ timeMs: 0, foldAngle: 30 }] } },
      { device: "iphone", background: "#112233", color: "#171717", motion: "fold-cycle" },
    ]) {
      const invalidFold = await client.callTool({ name: "save_video", arguments: { ...project, timeline: { ...project.timeline, clips: [{ ...project.timeline.clips[0], deviceFrame }] } } });
      assert.equal(invalidFold.isError, true);
      assert.equal(calls.filter(call => call.path === "/api/v1/videos").length, before, "Duo-only animation must fail before the project API");
    }
  } finally {
    await client.close();
    if (child) { child.kill("SIGTERM"); await once(child, "exit"); }
    backend.closeAllConnections(); await new Promise(resolve => backend.close(resolve));
  }
});
