import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
const run=promisify(execFile);
import { expect, test, type Page } from "@playwright/test";
import { normalizeVideoTimeline } from "../lib/video-timeline";

test.use({ actionTimeout: 15_000 });
async function editor(page: Page, empty = false) {
  let project: any = { id:"devices-demo", name:"Connected product demo", caption:"", brandId:"", labels:[], revision:1, createdAt:"2026-10-02T00:00:00Z", updatedAt:"2026-10-02T00:00:00Z", timeline:{ version:1, aspectRatio:"1:1", clips:empty?[]:[{ id:"recording", name:"Screen recording", sourceUrl:"https://media.example.test/demo.mp4", kind:"video", inMs:1000, outMs:4000, sourceDurationMs:5000, fit:"contain", x:.5, y:.5, zoom:1, volume:.35 }], labels:[], music:{ url:"", volume:1, offsetMs:0, fadeInMs:0, fadeOutMs:0 }, coverMs:0 } };
  const errors:string[]=[];page.on("pageerror", error=>errors.push(error.message));
  await page.route("https://media.example.test/**", route=>{
    const bytes=readFileSync(new URL("./fixtures/device-demo.mp4",import.meta.url));
    const range=/^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range??"");
    if(!range)return route.fulfill({contentType:"video/mp4",headers:{"Accept-Ranges":"bytes"},body:bytes});
    const start=Number(range[1]),end=range[2]?Math.min(Number(range[2]),bytes.length-1):bytes.length-1;
    return route.fulfill({status:206,contentType:"video/mp4",headers:{"Accept-Ranges":"bytes","Content-Range":`bytes ${start}-${end}/${bytes.length}`},body:bytes.subarray(start,end+1)});
  });
  await page.route("**/api/v1/videos",route=>{
    if(route.request().method()==="PATCH"){const next=route.request().postDataJSON();project={...next,timeline:normalizeVideoTimeline(next.timeline),revision:project.revision+1};return route.fulfill({json:{data:project}});}
    return route.fulfill({json:{data:[project]}});
  });
  for(const path of ["videos/templates","brands/kit","videos/jobs*","media/projects"])await page.route(`**/api/v1/${path}`,route=>route.fulfill({json:{data:[]}}));
  await page.route("**/api/v1/media?*",route=>route.fulfill({json:{data:[{key:"demo",name:"Watch recording.mp4",url:"https://media.example.test/demo.mp4"}]}}));
  await page.route("**/api/v1/videos/compose",route=>route.fulfill({json:{data:{available:false}}}));
  await page.goto("/demo?view=videos");await page.getByRole("button",{name:/^Connected product demo/}).click();
  return {project:()=>project,errors};
}
async function range(page:Page,name:string,value:number){await page.getByLabel(name,{exact:true}).evaluate((element,next)=>{const input=element as HTMLInputElement;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,String(next));input.dispatchEvent(new Event("input",{bubbles:true}));input.dispatchEvent(new Event("change",{bubbles:true}));},value);}
const layers=(page:Page)=>page.getByRole("region",{name:"Device layers",exact:true});
const preview=(page:Page)=>page.locator(".unified-video-canvas [data-layer-preview]");
async function rename(page:Page,name:string){await page.getByLabel("Layer name",{exact:true}).fill(name);}
async function placement(page:Page,x:number){const detail=page.locator(".device-demo-transform");if(!(await detail.getAttribute("open")))await detail.getByText("Position, scale & rotation",{exact:true}).click();await range(page,"Device horizontal position",x);await range(page,"Device scale",55);}

test("three independently timed devices rotate, share the canvas, seek and persist as editable layers",async({page},testInfo)=>{
  const state=await editor(page);
  await layers(page).getByRole("button",{name:"Layer selected footage",exact:true}).click();
  await rename(page,"Watch lead");await page.getByRole("button",{name:"Watch",exact:true}).click();
  await page.getByLabel("Device animation",{exact:true}).selectOption("orbit");await placement(page,25);
  await page.getByText("Clip adjustments",{exact:true}).click();await range(page,"Source volume",.35);
  await layers(page).getByRole("button",{name:"Duplicate layer",exact:true}).click();await rename(page,"Watch companion");
  await page.getByLabel("Layer start time",{exact:true}).fill("500");await placement(page,50);
  await page.getByLabel("Device animation",{exact:true}).selectOption("float");
  await layers(page).getByRole("button",{name:"Layer selected footage",exact:true}).click();await rename(page,"iPhone partner");
  await page.getByRole("button",{name:"iPhone",exact:true}).click();await page.getByLabel("Layer start time",{exact:true}).fill("1000");await placement(page,77);
  await page.getByLabel("Trim start (ms)",{exact:true}).fill("1500");
  await page.getByLabel("Canvas background style",{exact:true}).selectOption("solid");await page.getByLabel("Canvas background color",{exact:true}).fill("#112233");
  // The sequence can be removed: layers alone still provide duration, playback and editing.
  await page.locator(".timeline-clips > button").click();await page.getByRole("button",{name:"Delete",exact:true}).click();
  await expect(page.locator(".timeline-clips > button")).toHaveCount(0);
  await range(page,"Timeline playhead",250);await expect(preview(page)).toHaveCount(1);
  const firstTransform=await preview(page).first().locator("[data-device-panel]").getAttribute("data-device-panel-transform");
  await range(page,"Timeline playhead",1250);await expect(preview(page)).toHaveCount(3);
  await expect(page.locator('.unified-video-canvas [data-device-preview="watch"]')).toHaveCount(2);
  await expect(page.locator('.unified-video-canvas [data-device-preview="iphone"]')).toHaveCount(1);
  await expect.poll(()=>preview(page).first().locator("[data-device-panel]").getAttribute("data-device-panel-transform")).not.toBe(firstTransform);
  const videos=preview(page).locator("video");await expect(videos).toHaveCount(3);
  await expect.poll(()=>videos.evaluateAll(elements=>elements.map(element=>Math.round((element as HTMLVideoElement).currentTime*1000)))).toEqual([2250,1750,1750]);
  await expect.poll(()=>videos.evaluateAll(elements=>elements.map(element=>(element as HTMLVideoElement).volume))).toEqual([.35,0,0]);
  await expect.poll(()=>preview(page).locator(".device-frame-preview").evaluateAll(elements=>elements.every(element=>getComputedStyle(element).backgroundColor==="rgba(0, 0, 0, 0)"))).toBe(true);
  await page.getByRole("button",{name:"Play",exact:true}).click();await expect.poll(()=>videos.first().evaluate(element=>(element as HTMLVideoElement).paused)).toBe(false);
  await page.getByRole("button",{name:"Pause",exact:true}).click();await expect.poll(()=>videos.evaluateAll(elements=>elements.every(element=>(element as HTMLVideoElement).paused))).toBe(true);
  await range(page,"Timeline playhead",1250);
  await page.getByRole("button",{name:"Add text label",exact:true}).click();await page.getByLabel("Label text",{exact:true}).fill("Connected together");
  await page.getByRole("button",{name:"Save draft",exact:true}).click();
  expect(state.project().timeline.layers).toHaveLength(3);expect(state.project().timeline.clips).toHaveLength(0);
  expect(state.project().timeline.layers.map((layer:any)=>[layer.name,layer.startMs,layer.deviceFrame.device,layer.deviceFrame.motion])).toEqual([["Watch lead",0,"watch","orbit"],["Watch companion",500,"watch","float"],["iPhone partner",1000,"iphone","float"]]);
  await page.reload();await page.getByRole("button",{name:/^Connected product demo/}).click();await range(page,"Timeline playhead",1250);await expect(preview(page)).toHaveCount(3);
  await expect(page.getByRole("button",{name:"Edit text: Connected together",exact:true})).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({path:`/tmp/relay-multi-device-${testInfo.project.name}.png`,fullPage:true,animations:"disabled"});expect(state.errors).toEqual([]);
});

test("Media layers work on an empty project with stacking, undo, trim, removal and layer limits",async({page})=>{
  const state=await editor(page,true);
  await layers(page).getByRole("button",{name:"Layer from Media",exact:true}).click();await page.getByRole("button",{name:"Add Watch recording.mp4",exact:true}).click();
  await rename(page,"First watch");await page.getByRole("button",{name:"Watch",exact:true}).click();
  await layers(page).getByRole("button",{name:"Duplicate layer",exact:true}).click();await rename(page,"Second watch");
  await layers(page).getByRole("button",{name:"Send backward",exact:true}).click();
  await page.getByRole("button",{name:"Save draft",exact:true}).click();expect(state.project().timeline.layers.map((layer:any)=>layer.name)).toEqual(["Second watch","First watch"]);
  await page.getByRole("button",{name:"Undo",exact:true}).click();await page.getByRole("button",{name:"Save draft",exact:true}).click();expect(state.project().timeline.layers.map((layer:any)=>layer.name)).toEqual(["First watch","Second watch"]);
  await page.getByRole("button",{name:"Redo",exact:true}).click();
  await page.getByLabel("Layer start time",{exact:true}).fill("2000");await page.getByLabel("Trim start (ms)",{exact:true}).fill("1000");await page.getByLabel("Trim end (ms)",{exact:true}).fill("2500");
  await range(page,"Timeline playhead",2500);await expect(preview(page)).toHaveCount(2);await expect.poll(()=>preview(page).first().locator("video").evaluate(element=>Math.round((element as HTMLVideoElement).currentTime*1000))).toBe(1500);
  await layers(page).getByRole("button",{name:"Remove layer",exact:true}).click();await expect(page.getByRole("button",{name:/^Layer track:/})).toHaveCount(1);
  await layers(page).getByRole("list",{name:"Device stacking order",exact:true}).getByRole("button").click();
  for(let count=1;count<12;count++)await layers(page).getByRole("button",{name:"Duplicate layer",exact:true}).click();
  await expect(page.getByRole("button",{name:/^Layer track:/})).toHaveCount(12);await expect(layers(page).getByRole("button",{name:"Duplicate layer",exact:true})).toBeDisabled();await expect(layers(page).getByRole("button",{name:"Layer from Media",exact:true})).toBeDisabled();
  await page.getByRole("button",{name:"Save draft",exact:true}).click();expect(state.project().timeline.layers).toHaveLength(12);expect(state.errors).toEqual([]);
});

test("a Watch and delayed iPhone export together in a real playable promotion",async({page},testInfo)=>{
  test.setTimeout(120_000);const state=await editor(page);
  await layers(page).getByRole("button",{name:"Layer selected footage",exact:true}).click();await rename(page,"Watch demo");await page.getByRole("button",{name:"Watch",exact:true}).click();await placement(page,25);await page.getByLabel("Device animation",{exact:true}).selectOption("orbit");await page.getByLabel("Trim end (ms)",{exact:true}).fill("2500");
  await layers(page).getByRole("button",{name:"Layer selected footage",exact:true}).click();await rename(page,"Phone demo");await page.getByRole("button",{name:"iPhone",exact:true}).click();await placement(page,75);await page.getByLabel("Layer start time",{exact:true}).fill("500");await page.getByLabel("Trim end (ms)",{exact:true}).fill("2000");await page.getByLabel("Device animation",{exact:true}).selectOption("float");
  await page.locator(".timeline-clips > button").click();await page.getByRole("button",{name:"Delete",exact:true}).click();await page.getByLabel("Canvas background style",{exact:true}).selectOption("solid");await page.getByLabel("Canvas background color",{exact:true}).fill("#112233");
  await range(page,"Timeline playhead",1000);await expect(preview(page)).toHaveCount(2);
  const dir=await mkdtemp(join(tmpdir(),"relay-devices-export-"));let body:Buffer;let revision=0;
  try{
    await page.route("**/api/v1/videos/render",async route=>{
      expect(state.project().timeline.clips).toHaveLength(0);expect(state.project().timeline.layers).toHaveLength(2);revision=state.project().revision;
      const document=join(dir,"timeline.json");await writeFile(document,JSON.stringify(state.project().timeline));await run(process.execPath,[fileURLToPath(new URL("./fixtures/render-demo.mjs",import.meta.url)),document,dir],{timeout:90_000});body=await readFile(join(dir,"output.mp4"));
      await route.fulfill({status:202,json:{job:{id:"devices-export",projectId:state.project().id,revision,status:"queued",progress:0}}});
    });
    await page.route("**/api/v1/videos/jobs*",route=>route.fulfill({json:{data:{id:"devices-export",projectId:state.project().id,revision,status:"completed",progress:100,renderedUrl:"https://media.example.test/output.mp4"}}}));
    await page.route("**/api/v1/videos/download?**",route=>route.fulfill({contentType:"video/mp4",headers:{"Content-Disposition":'attachment; filename="connected-products.mp4"'},body}));
    const downloaded=page.waitForEvent("download",{timeout:100_000});await page.getByRole("button",{name:"Save & download",exact:true}).click();const download=await downloaded;const output=join(dir,"download.mp4");await download.saveAs(output);
    const probe=JSON.parse((await run("ffprobe",["-v","error","-show_entries","format=duration:stream=codec_name,codec_type,width,height","-of","json",output])).stdout);
    expect(Number(probe.format.duration)).toBeCloseTo(1.5,1);expect(probe.streams).toEqual(expect.arrayContaining([expect.objectContaining({codec_name:"h264",width:1080,height:1080}),expect.objectContaining({codec_name:"aac",codec_type:"audio"})]));
    const counts:number[]=[];for(const time of ["0.2","0.9"]){const frame=join(dir,`${time}.rgb`);await run("ffmpeg",["-v","error","-y","-ss",time,"-i",output,"-frames:v","1","-f","rawvideo","-pix_fmt","rgb24",frame]);const pixels=await readFile(frame);let count=0;for(let y=350;y<700;y++)for(let x=700;x<930;x++){const index=(y*1080+x)*3;if(Math.abs(pixels[index]-17)+Math.abs(pixels[index+1]-34)+Math.abs(pixels[index+2]-51)>60)count++;}counts.push(count);}
    expect(counts[0]).toBeLessThan(100);expect(counts[1]).toBeGreaterThan(5000);
    await page.route("**/devices-output.mp4",route=>{const match=/^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range??"");if(!match)return route.fulfill({contentType:"video/mp4",body});const start=Number(match[1]),end=match[2]?Math.min(Number(match[2]),body.length-1):body.length-1;return route.fulfill({status:206,contentType:"video/mp4",headers:{"Accept-Ranges":"bytes","Content-Range":`bytes ${start}-${end}/${body.length}`},body:body.subarray(start,end+1)});});
    await page.evaluate(()=>{const video=document.createElement("video");video.id="devices-export-check";video.src="/devices-output.mp4";video.muted=true;document.body.append(video);});const video=page.locator("#devices-export-check");await expect.poll(()=>video.evaluate(element=>(element as HTMLVideoElement).videoWidth)).toBe(1080);await video.evaluate(element=>(element as HTMLVideoElement).play());await expect.poll(()=>video.evaluate(element=>(element as HTMLVideoElement).currentTime)).toBeGreaterThan(.1);await video.evaluate(element=>(element as HTMLVideoElement).pause());await testInfo.attach("Connected products promotion",{path:output,contentType:"video/mp4"});expect(state.errors).toEqual([]);
  }finally{await rm(dir,{recursive:true,force:true});}
});


test("appended footage starts in focus and late layer trims stay within the timeline limit",async({page})=>{
  const state=await editor(page);
  await page.getByRole("button",{name:"Add media",exact:true}).click();
  await page.getByRole("button",{name:"Add Watch recording.mp4",exact:true}).click();
  await expect(page.getByLabel("Timeline playhead",{exact:true})).toHaveValue("3000");
  await expect(page.locator(".unified-video-canvas [data-clip-preview] video")).toHaveAttribute("src","https://media.example.test/demo.mp4");
  await layers(page).getByRole("button",{name:"Layer selected footage",exact:true}).click();
  await page.getByLabel("Trim start (ms)",{exact:true}).fill("1000");
  await page.getByLabel("Layer start time",{exact:true}).fill("899999");
  await expect(page.getByLabel("Layer start time",{exact:true})).toHaveValue("896000");
  await page.getByLabel("Trim start (ms)",{exact:true}).fill("0");
  await page.getByLabel("Trim end (ms)",{exact:true}).fill("5000");
  await expect(page.getByLabel("Trim end (ms)",{exact:true})).toHaveValue("4000");
  await page.getByRole("button",{name:"Save draft",exact:true}).click();
  expect(state.project().timeline.layers[0].startMs+state.project().timeline.layers[0].outMs-state.project().timeline.layers[0].inMs).toBe(900000);
  expect(state.project().timeline.layers[0].volume).toBe(0);
  expect(state.errors).toEqual([]);
});
