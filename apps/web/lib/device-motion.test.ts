import assert from "node:assert/strict";
import test from "node:test";
import { execFile, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import type { DeviceFrame, VideoClip } from "@relay/core";
import { deviceBackgroundSvg, deviceBodyLayerSvg, deviceFrameLayerSvg } from "./device-frames.ts";
import { devicePanelAtScale, devicePanelViewport, deviceScene, deviceVideoSceneFilter, type DevicePanel } from "./device-motion.ts";

const frame: DeviceFrame = { device: "iphone-duo", color: "#171717", background: "#00FF00" };
const clip = (deviceFrame?: DeviceFrame): VideoClip => ({ id: "test", name: "test", sourceUrl: "https://example.com/test.mp4", kind: "video", inMs: 0, outMs: 1000, fit: "cover", x: .5, y: .5, zoom: 1, volume: 1, deviceFrame });
function map(panel: DevicePanel, x: number, y: number) {
  const m = panel.transform.slice(9, -1).split(",").map(Number);
  const w = m[3] * x + m[7] * y + m[15];
  return { x: (m[0] * x + m[4] * y + m[12]) / w, y: (m[1] * x + m[5] * y + m[13]) / w };
}
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

test("preview pixel projection preserves output geometry across viewport sizes without a parent scale", () => {
  const original = deviceScene(1080,1920,{...frame,rotateX:-18,rotateY:32,rotateZ:-8,foldAngle:85});
  for(const scale of [.1,.333,1,2]) for(const panel of [...original.panels,...original.bodyPanels]) {
    const preview=devicePanelAtScale(panel,scale);
    for(const [i,[x,y]] of [[0,0],[preview.rect.width,0],[0,preview.rect.height],[preview.rect.width,preview.rect.height]].entries()) {
      const projected=map(preview,x,y);
      close(projected.x,panel.corners[i].x*scale);close(projected.y,panel.corners[i].y*scale);
    }
    assert.equal(preview.visible,panel.visible);
    assert.equal(preview.shade,panel.shade);
  }
});

test("panel homographies map the complete device and source screen through the same projection", () => {
  for (const settings of [frame, { ...frame, x: .2, y: .75, scale: .8, rotateX: 30, rotateY: -25, rotateZ: 42, foldAngle: 125 }]) {
    const scene = deviceScene(1080, 1920, settings);
    assert.equal(scene.panels.length, 2);
    for (const panel of scene.panels) {
      const points = [[0, 0], [panel.rect.width, 0], [0, panel.rect.height], [panel.rect.width, panel.rect.height]];
      points.forEach(([x, y], i) => {
        const actual = map(panel, x, y); close(actual.x, panel.corners[i].x); close(actual.y, panel.corners[i].y);
      });
    }
    close(scene.panels[0].corners[1].x, scene.panels[1].corners[0].x);
    close(scene.panels[0].corners[1].y, scene.panels[1].corners[0].y);
    close(scene.panels[0].corners[3].x, scene.panels[1].corners[2].x);
    close(scene.panels[0].corners[3].y, scene.panels[1].corners[2].y);
  }
});

test("motion is deterministic, loops seamlessly, and fold/unfold hold their final pose", () => {
  for (const motion of ["float", "orbit", "fold-cycle"] as const) {
    const moving = { ...frame, motion, motionDurationMs: 2000 };
    const first = deviceScene(1080, 1080, moving, 0), last = deviceScene(1080, 1080, moving, 2000);
    first.panels.forEach((panel, i) => panel.corners.forEach((p, j) => { close(p.x, last.panels[i].corners[j].x); close(p.y, last.panels[i].corners[j].y); }));
    assert.notDeepEqual(first, deviceScene(1080, 1080, moving, 500));
  }
  const folded = deviceScene(1080, 1920, { ...frame, foldAngle: 150 });
  assert.deepEqual(deviceScene(1080, 1920, { ...frame, motion: "fold" }, 4000).panels, folded.panels);
  assert.deepEqual(deviceScene(1080, 1920, { ...frame, motion: "fold" }, 5000).panels, folded.panels);
  assert.deepEqual(deviceScene(1080, 1920, { ...frame, motion: "unfold" }, 4000).panels, deviceScene(1080, 1920, frame).panels);
});

test("edge-on and back-facing Duo panels are hidden consistently", () => {
  const edge = deviceScene(1080, 1920, { ...frame, foldAngle: 150, rotateY: 15 });
  assert.equal(edge.panels[0].visible, false);
  assert.equal(edge.panels[1].visible, true);
  const back = deviceScene(1080, 1920, { ...frame, foldAngle: 150, rotateY: 40 });
  assert.equal(back.panels[0].visible, false);
  assert.equal(back.panels[1].visible, true);
});

test("rotated device bodies have physical thickness and share front homographies and visibility", () => {
  for(const device of ["iphone","watch","iphone-duo"] as const) {
    const settings:DeviceFrame={...frame,device,rotateX:20,rotateY:45,foldAngle:device==="iphone-duo"?80:0};
    const scene=deviceScene(360,480,settings);
    assert.equal(scene.bodyPanels.length,scene.panels.length*2);
    scene.bodyPanels.forEach((panel,index)=>{
      assert.ok(panel.depth!<0);
      assert.equal(panel.visible,scene.panels[index%scene.panels.length].visible);
      for(const [i,[x,y]] of [[0,0],[panel.rect.width,0],[0,panel.rect.height],[panel.rect.width,panel.rect.height]].entries()) {
        const actual=map(panel,x,y);close(actual.x,panel.corners[i].x);close(actual.y,panel.corners[i].y);
      }
      assert.notDeepEqual(panel.corners,scene.panels[index%scene.panels.length].corners);
      const viewport=devicePanelViewport(360,480,settings,panel.rect,4000,panel.depth);
      for(const corner of panel.corners) {
        if(corner.x>=0&&corner.x<=360) assert.ok(corner.x>=viewport.x&&corner.x<=viewport.x+viewport.width);
        if(corner.y>=0&&corner.y<=480) assert.ok(corner.y>=viewport.y&&corner.y<=viewport.y+viewport.height);
      }
    });
  }
  assert.deepEqual(deviceScene(360,480,{...frame,device:"browser"}).bodyPanels,[]);
  assert.deepEqual(deviceScene(360,480,{...frame,device:"iphone"}).bodyPanels,[],"face-on devices skip invisible body warps");
});

test("bounded export viewports cover projected preset corners throughout a cycle", () => {
  for (const motion of ["none", "float", "orbit", "fold", "unfold", "fold-cycle"] as const) {
    const settings: DeviceFrame = { ...frame, motion, scale: 1.5, rotateX: 60, rotateY: -55, rotateZ: 160, x: .25, y: .8 };
    const initial = deviceScene(1080, 1920, settings);
    const bounds = initial.panels.map(p => devicePanelViewport(1080, 1920, settings, p.rect));
    for (let t = 0; t <= 4000; t += 37) deviceScene(1080, 1920, settings, t).panels.forEach((p, i) => p.corners.forEach(c => {
      if (c.x >= 0 && c.x <= 1080) assert.ok(c.x >= bounds[i].x && c.x <= bounds[i].x + bounds[i].width);
      if (c.y >= 0 && c.y <= 1920) assert.ok(c.y >= bounds[i].y && c.y <= bounds[i].y + bounds[i].height);
    }));
  }
});

const run = promisify(execFile);
const ffmpegAvailable = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
test("FFmpeg exports the same projected metal side behind the iPhone screen", {skip:!ffmpegAvailable,timeout:15000}, async()=>{
  const dir=await mkdtemp(join(tmpdir(),"relay-device-depth-"));
  const width=360,height=480,settings:DeviceFrame={...frame,device:"iphone",rotateY:50};
  try {
    await writeFile(join(dir,"frame.png"),await sharp(Buffer.from(deviceFrameLayerSvg(width,height,settings))).png().toBuffer());
    await writeFile(join(dir,"body.png"),await sharp(Buffer.from(deviceBodyLayerSvg(width,height,settings))).png().toBuffer());
    await writeFile(join(dir,"bg.png"),await sharp(Buffer.from(deviceBackgroundSvg(width,height,frame.background))).png().toBuffer());
    await run("ffmpeg",["-v","error","-y","-f","lavfi","-i","color=blue:size=80x100:rate=30","-i",join(dir,"frame.png"),"-i",join(dir,"body.png"),"-i",join(dir,"bg.png"),"-filter_complex_threads","1","-filter_complex",deviceVideoSceneFilter(width,height,clip(settings),3,1000,true,2),"-map","[framed]","-frames:v","1",join(dir,"still.png")]);
    const {data,info}=await sharp(join(dir,"still.png")).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const scene=deviceScene(width,height,settings);
    const front=map(scene.panels[0],0,scene.panels[0].rect.height/2);
    const rear=map(scene.bodyPanels[0],0,scene.bodyPanels[0].rect.height/2);
    const offset=(Math.round((front.y+rear.y)/2)*info.width+Math.round((front.x+rear.x)/2))*4;
    assert.ok(data[offset+3]>200,"metal body is visible in the gap behind the front edge");
    assert.ok(data[offset+2]<150,"the side contains body material rather than recording pixels");
    const center=(height/2*info.width+width/2)*4;
    assert.ok(data[center+2]>200&&data[center+3]===255,"screen stays opaque over the body");
    assert.equal(data[3],0,"outside device stays transparent");
    const faded:DeviceFrame={...settings,animation:{keyframes:[{timeMs:0,opacity:.5}]}};
    for(const transparent of [true,false]) {
      const output=join(dir,`fade-${transparent}.png`);
      await run("ffmpeg",["-v","error","-y","-f","lavfi","-i","color=blue:size=80x100:rate=30","-i",join(dir,"frame.png"),"-i",join(dir,"body.png"),"-i",join(dir,"bg.png"),"-filter_complex_threads","1","-filter_complex",deviceVideoSceneFilter(width,height,clip(faded),3,1000,transparent,2),"-map","[framed]","-frames:v","1",output]);
      const pixels=await sharp(output).ensureAlpha().raw().toBuffer();
      if(transparent) assert.ok(pixels[center+3]>=125&&pixels[center+3]<=130,"body and glass fade as a single group instead of accumulating alpha");
      else {
        assert.ok(pixels[center+1]>110&&pixels[center+2]>110,"faded glass reveals the opaque canvas background");
        assert.equal(pixels[3],255,"group fade leaves background opaque");
      }
    }
  } finally {await rm(dir,{recursive:true,force:true});}
});
test("transparent Watch and iPhone scenes keep opaque screens and alpha-zero outside edges", { skip: !ffmpegAvailable, timeout: 15000 }, async () => {
  const dir=await mkdtemp(join(tmpdir(),"relay-layer-alpha-"));
  const width=160,height=200;
  try {
    // An intentionally opaque input canvas must also be cleared in layer mode.
    await writeFile(join(dir,"bg.png"),await sharp(Buffer.from(deviceBackgroundSvg(width,height,"#00FF00"))).png().toBuffer());
    for(const device of ["watch","iphone"] as const) {
      const framed:DeviceFrame={device,color:"#171717",background:"#FF0000",scale:.8,rotateZ:12};
      await writeFile(join(dir,"frame.png"),await sharp(Buffer.from(deviceFrameLayerSvg(width,height,framed))).png().toBuffer());
      await run("ffmpeg",["-v","error","-y","-f","lavfi","-i","color=blue:size=80x100:rate=30","-i",join(dir,"frame.png"),"-i",join(dir,"bg.png"),"-filter_complex_threads","1","-filter_complex",deviceVideoSceneFilter(width,height,clip(framed),2,1000,true),"-map","[framed]","-frames:v","1",join(dir,`${device}.png`)]);
      const {data,info}=await sharp(join(dir,`${device}.png`)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
      assert.equal(data[3],0,"outside a device layer must stay transparent");
      const center=(100*info.width+80)*info.channels;
      assert.ok(data[center+2]>200&&data[center+3]===255,"recording pixels remain opaque inside the device");
    }
  } finally {await rm(dir,{recursive:true,force:true});}
});
test("FFmpeg exports moving Duo panels with real screen pixels and transparent outside edges", { skip: !ffmpegAvailable, timeout: 30000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "relay-device-test-"));
  const width = 240, height = 320;
  const moving: DeviceFrame = { ...frame, motion: "fold-cycle", motionDurationMs: 1000, rotateZ: -8 };
  try {
    await writeFile(join(dir, "frame.png"), await sharp(Buffer.from(deviceFrameLayerSvg(width, height, moving))).png().toBuffer());
    await writeFile(join(dir, "background.png"), await sharp(Buffer.from(deviceBackgroundSvg(width, height, frame.background))).png().toBuffer());
    // At local zero, float has exactly the static pose. Comparing lossless first
    // frames catches FFmpeg's one-based perspective `on` counter drifting ahead.
    const firstFrameInputs = ["-v", "error", "-y", "-f", "lavfi", "-i", "color=red:size=120x120:rate=30", "-loop", "1", "-i", join(dir, "frame.png"), "-loop", "1", "-i", join(dir, "background.png"), "-filter_complex_threads", "1", "-filter_complex"];
    for (const motion of ["none", "float"] as const) {
      await run("ffmpeg", [...firstFrameInputs, deviceVideoSceneFilter(width, height, clip({ ...moving, motion, motionDurationMs: 500 }), 2), "-map", "[framed]", "-frames:v", "1", join(dir, `first-${motion}.png`)]);
    }
    const center = async (name: string) => {
      const { data, info } = await sharp(join(dir, name)).raw().toBuffer({ resolveWithObject: true });
      let x = 0, y = 0, count = 0;
      for (let py = 0; py < info.height; py++) for (let px = 0; px < info.width; px++) {
        const offset = (py * info.width + px) * info.channels;
        if (data[offset] > 150 && data[offset + 1] < 100 && data[offset + 2] < 100) { x += px; y += py; count++; }
      }
      assert.ok(count > 100);
      return { x: x / count, y: y / count };
    };
    const movingCenter = await center("first-float.png"), staticCenter = await center("first-none.png");
    assert.ok(Math.abs(movingCenter.x - staticCenter.x) < .5 && Math.abs(movingCenter.y - staticCenter.y) < .5, "exported local-zero pose must match static preview pose");
    await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=red:size=120x120:rate=30,drawbox=x=60:y=0:w=60:h=120:color=blue:t=fill", "-loop", "1", "-i", join(dir, "frame.png"), "-loop", "1", "-i", join(dir, "background.png"), "-filter_complex_threads", "1", "-filter_complex", deviceVideoSceneFilter(width, height, clip(moving), 2), "-map", "[framed]", "-t", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p", join(dir, "output.mp4")]);
    const probe = JSON.parse((await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=avg_frame_rate,nb_frames", "-of", "json", join(dir, "output.mp4")])).stdout);
    assert.equal(probe.streams[0].avg_frame_rate, "30/1");
    assert.equal(Number(probe.streams[0].nb_frames), 30);
    for (const timeMs of [0, 500]) {
      const output = join(dir, `still-${timeMs}.png`);
      await run("ffmpeg", ["-v", "error", "-y", "-ss", String(timeMs / 1000), "-i", join(dir, "output.mp4"), "-frames:v", "1", output]);
      const { data, info } = await sharp(await readFile(output)).raw().toBuffer({ resolveWithObject: true });
      const pixel = (x: number, y: number) => [...data.subarray((Math.round(y) * info.width + Math.round(x)) * info.channels, (Math.round(y) * info.width + Math.round(x)) * info.channels + 3)];
      assert.ok(pixel(0, 0)[1] > 200, "outside the projected device stays background green");
      const scene = deviceScene(width, height, moving, timeMs);
      for (let i = 0; i < 2; i++) {
        const panel = scene.panels[i];
        const p = map(panel, panel.rect.width / 2, panel.rect.height / 2);
        const rgb = pixel(p.x, p.y);
        assert.ok(i === 0 ? rgb[0] > 150 && rgb[2] < 100 : rgb[2] > 150 && rgb[0] < 100, `screen ${i} at ${timeMs}ms should contain ${i === 0 ? "red" : "blue"} source, got ${rgb}`);
      }
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("unframed contain export exposes the selected background", { skip: !ffmpegAvailable, timeout: 15000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "relay-background-test-"));
  try {
    await writeFile(join(dir, "background.png"), await sharp(Buffer.from(deviceBackgroundSvg(120, 160, "#00FF00"))).png().toBuffer());
    await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=red:size=120x60:rate=30", "-loop", "1", "-i", join(dir, "background.png"), "-filter_complex_threads", "1", "-filter_complex", deviceVideoSceneFilter(120, 160, { ...clip(), fit: "contain" }, 1), "-map", "[framed]", "-frames:v", "1", join(dir, "still.png")]);
    const { data, info } = await sharp(join(dir, "still.png")).raw().toBuffer({ resolveWithObject: true });
    assert.ok(data[1] > 200);
    const center = (80 * info.width + 60) * info.channels;
    assert.ok(data[center] > 200 && data[center + 1] < 50);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("keyframes move the projected frame and fade alpha consistently in real FFmpeg output", { skip: !ffmpegAvailable, timeout: 30000 }, async () => {
  const dir=await mkdtemp(join(tmpdir(),"relay-keyframed-test-"));
  const width=160,height=200;
  const animated:DeviceFrame={...frame,device:"iphone",animation:{entrance:{preset:"fade",durationMs:200,easing:"linear"},exit:{preset:"fade",durationMs:200,easing:"linear"},keyframes:[{timeMs:0,x:.35,scale:.8,easing:"ease-in-out"},{timeMs:1000,x:.65,scale:1.1}]}};
  try {
    await writeFile(join(dir,"frame.png"),await sharp(Buffer.from(deviceFrameLayerSvg(width,height,animated))).png().toBuffer());
    await writeFile(join(dir,"bg.png"),await sharp(Buffer.from(deviceBackgroundSvg(width,height,frame.background))).png().toBuffer());
    await run("ffmpeg",["-v","error","-y","-f","lavfi","-i","color=red:size=80x100:rate=30","-i",join(dir,"frame.png"),"-i",join(dir,"bg.png"),"-filter_complex_threads","1","-filter_complex",deviceVideoSceneFilter(width,height,clip(animated),2),"-map","[framed]","-t","1","-c:v","libx264","-pix_fmt","yuv420p",join(dir,"output.mp4")]);
    for(const timeMs of [0,300,600,900]) {
      const png=join(dir,`${timeMs}.png`);
      await run("ffmpeg",["-v","error","-y","-ss",String(timeMs/1000),"-i",join(dir,"output.mp4"),"-frames:v","1",png]);
      const {data,info}=await sharp(png).raw().toBuffer({resolveWithObject:true});
      const scene=deviceScene(width,height,animated,timeMs,1000);
      const p=map(scene.panels[0],scene.panels[0].rect.width/2,scene.panels[0].rect.height/2);
      const offset=(Math.round(p.y)*info.width+Math.round(p.x))*info.channels;
      const red=data[offset],green=data[offset+1];
      if(timeMs===0) assert.ok(green>200&&red<30,"entrance zero alpha reveals canvas");
      else assert.ok(Math.abs(red-255*scene.opacity)<30,`alpha at ${timeMs}ms: ${red} vs ${scene.opacity}`);
      assert.ok(data[1]>200,"background outside frame remains visible");
    }
  } finally {await rm(dir,{recursive:true,force:true});}
});

test("the maximum keyframe track exports without FFmpeg parser nesting failures", { skip: !ffmpegAvailable, timeout: 60000 }, async () => {
  const dir=await mkdtemp(join(tmpdir(),"relay-keyframe-limit-"));
  const animated:DeviceFrame={...frame,animation:{keyframes:Array.from({length:100},(_,i)=>({timeMs:i*100,x:.1+i*.008,y:.1+i*.008,scale:.5+i*.008,rotateX:i*.3,rotateY:i*.3,rotateZ:i,foldAngle:i,opacity:.5+i*.005}))}};
  try {
    await writeFile(join(dir,"frame.png"),await sharp(Buffer.from(deviceFrameLayerSvg(160,200,animated))).png().toBuffer());
    await writeFile(join(dir,"body.png"),await sharp(Buffer.from(deviceBodyLayerSvg(160,200,animated))).png().toBuffer());
    await writeFile(join(dir,"background.png"),await sharp(Buffer.from(deviceBackgroundSvg(160,200,frame.background))).png().toBuffer());
    await writeFile(join(dir,"filter.txt"),deviceVideoSceneFilter(160,200,{...clip(animated),outMs:10000},3,10000,false,2));
    await run("ffmpeg",["-v","error","-y","-f","lavfi","-i","color=red:size=80x100:rate=30","-i",join(dir,"frame.png"),"-i",join(dir,"body.png"),"-i",join(dir,"background.png"),"-filter_complex_threads","1","-filter_complex_script",join(dir,"filter.txt"),"-map","[framed]","-frames:v","1","-f","null","-"],{maxBuffer:1024*1024});
  } finally {await rm(dir,{recursive:true,force:true});}
});

test("authored hinge keyframes take precedence over canned folding motion", () => {
  const authored:DeviceFrame={...frame,motion:"fold-cycle",animation:{keyframes:[{timeMs:0,foldAngle:20},{timeMs:1000,foldAngle:140}]}};
  assert.deepEqual(deviceScene(240,320,authored,500,1000).panels,deviceScene(240,320,{...frame,foldAngle:80},500,1000).panels);
});
