import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { normalizeVideoTimeline } from "../lib/video-timeline";

test.use({ actionTimeout: 15_000 });
const headlines = ["Your whole day, in sync", "Start on your wrist", "Continue on your phone", "A little clarity, everywhere", "Your next idea starts here", "Build a calmer routine", "Small moments, connected", "One app, every device", "Make room for what matters", "Your day, beautifully connected"];
async function editor(page: Page) {
  let source: any = { id:"bulk-source",name:"Connected app launch",caption:"Discover {hook}",brandId:"",sourceUrl:"",labels:[],revision:1,createdAt:"2026-10-02T00:00:00Z",updatedAt:"2026-10-02T00:00:00Z",timeline:{ version:1,aspectRatio:"1:1",clips:[],layers:[{id:"watch",name:"Watch recording",kind:"video",sourceUrl:"https://media.example.test/watch.mp4",inMs:0,outMs:4000,startMs:0,fit:"contain",x:.5,y:.5,zoom:1,volume:0,deviceFrame:{device:"watch",background:"#112233",color:"#171717",x:.3,y:.5,scale:.6,motion:"orbit"}},{id:"phone",name:"Phone recording",kind:"video",sourceUrl:"https://media.example.test/phone.mp4",inMs:0,outMs:3000,startMs:1000,fit:"contain",x:.5,y:.5,zoom:1,volume:.4,deviceFrame:{device:"iphone",background:"#112233",color:"#171717",x:.7,y:.5,scale:.5,motion:"float"}}],background:{color:"#112233"},labels:[{id:"brand",text:"Brand stays",startMs:0,endMs:4000,x:.5,y:.12,width:.8,height:.08,fontSize:40,font:"modern",textColor:"#FFFFFF",background:"none",backgroundColor:"#000000",style:"outline"},{id:"headline",text:"Original headline",startMs:500,endMs:3500,x:.5,y:.8,width:.84,height:.12,fontSize:64,font:"modern",textColor:"#FFFFFF",background:"dark",backgroundColor:"#000000",style:"dark",animation:{entrance:{preset:"typewriter",durationMs:600},exit:{preset:"fade",durationMs:400}}}],music:{url:"https://media.example.test/music.wav",name:"Launch music",volume:.3,offsetMs:500,startMs:200,endMs:3800,fadeInMs:400,fadeOutMs:500},coverMs:1500} };
  const variants: any[] = [], jobs = new Map<string,any>(), requests:any[] = [], errors:string[] = [];
  let failNext = false, partial = false;
  page.on("pageerror",error=>errors.push(error.message));
  const bytes=readFileSync(new URL("./fixtures/device-demo.mp4",import.meta.url));
  await page.route("https://media.example.test/**",route=>{
    if(route.request().url().endsWith(".wav"))return route.fulfill({status:204});
    const match=/^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range??"");
    if(!match)return route.fulfill({contentType:"video/mp4",body:bytes});
    const start=Number(match[1]),end=match[2]?Math.min(Number(match[2]),bytes.length-1):bytes.length-1;
    return route.fulfill({status:206,contentType:"video/mp4",headers:{"Accept-Ranges":"bytes","Content-Range":`bytes ${start}-${end}/${bytes.length}`},body:bytes.subarray(start,end+1)});
  });
  await page.route("**/api/v1/videos",route=>{
    if(route.request().method()==="PATCH"){const body=route.request().postDataJSON();if(body.id===source.id)source={...body,timeline:normalizeVideoTimeline(body.timeline),revision:source.revision+1};return route.fulfill({json:{data:source}});}
    return route.fulfill({json:{data:[source,...variants]}});
  });
  for(const path of ["videos/templates","brands/kit","media/projects","media?*"])await page.route(`**/api/v1/${path}`,route=>route.fulfill({json:{data:[]}}));
  await page.route("**/api/v1/videos/compose",route=>route.fulfill({json:{data:{available:false}}}));
  await page.route("**/api/v1/videos/variants",route=>{
    const body=route.request().postDataJSON();requests.push(body);
    if(failNext){failNext=false;return route.fulfill({status:503,json:{error:"The queue connection was interrupted. Retry."}});}
    const data=body.hooks.map((hook:string,index:number)=>{
      const project={...structuredClone(source),id:`variant-${index}`,name:`${source.name} · ${index+1}`,caption:source.caption.replaceAll("{hook}",hook),revision:1};
      project.timeline.labels.find((label:any)=>label.id===body.labelId).text=hook;
      variants[index]=project;
      if(!body.render)return {project};
      if(partial&&index===1)return {project,error:"Queue temporarily unavailable"};
      const job={id:`job-${index}`,projectId:project.id,revision:1,status:"queued",progress:0};jobs.set(job.id,job);return{project,job};
    });
    return route.fulfill({status:partial?207:201,json:{data}});
  });
  await page.route("**/api/v1/videos/jobs*",route=>{const id=new URL(route.request().url()).searchParams.get("id");return route.fulfill({json:{data:id?jobs.get(id):[]}});});
  await page.route("**/api/v1/videos/render",route=>{const body=route.request().postDataJSON();const job={id:`job-${body.id}`,projectId:body.id,revision:1,status:"queued",progress:0};jobs.set(job.id,job);return route.fulfill({status:202,json:{job}});});
  await page.route("**/api/v1/videos/download?*",route=>route.fulfill({contentType:"video/mp4",headers:{"Content-Disposition":'attachment; filename="variant.mp4"'},body:bytes}));
  await page.goto("/demo?view=videos");await page.getByRole("button",{name:/^Connected app launch/}).click();
  return {source:()=>source,variants,requests,errors,fail:()=>{failNext=true;},partial:()=>{partial=true;},complete:()=>{for(const [id,job] of jobs)jobs.set(id,{...job,status:"completed",progress:100,renderedUrl:`https://media.example.test/${id}.mp4`});}};
}
const panel=(page:Page)=>page.getByRole("dialog",{name:"Create text variants",exact:true});

test("ten label texts preview independently and create editable scenes preserving devices and music",async({page},testInfo)=>{
  const state=await editor(page);
  await page.getByLabel("Label text",{exact:true}).fill("Brand intact");
  await page.getByRole("button",{name:"Bulk text",exact:true}).click();
  const modal=panel(page);await modal.getByLabel("Label to vary",{exact:true}).selectOption("headline");
  await modal.getByLabel("Variant texts",{exact:true}).fill(`\n${headlines.join("\n")}\n`);
  await modal.getByRole("button",{name:"Preview variant 10",exact:true}).click();
  await expect.poll(()=>modal.locator('[aria-label="Variant canvas preview"] svg').last().locator("text").last().locator("tspan").allTextContents()).toEqual(["Your day, beautifully", "connected"]);
  await expect(modal.locator('[aria-label="Variant canvas preview"]')).toContainText("Brand intact");
  await expect(modal.locator('[aria-label="Variant canvas preview"] [data-device-preview="watch"]')).toHaveCount(1);
  await expect(modal.locator('[aria-label="Variant canvas preview"] [data-device-preview="iphone"]')).toHaveCount(1);
  expect(state.requests).toHaveLength(0);expect(state.source().timeline.labels[1].text).toBe("Original headline");
  await modal.getByLabel("Variant texts",{exact:true}).evaluate(element=>{element.scrollTop=0;});
  await modal.evaluate(element=>{element.scrollTop=0;});
  await modal.screenshot({path:`/tmp/relay-bulk-text-${testInfo.project.name}.png`,animations:"disabled"});
  await modal.getByLabel("Render MP4s after creating",{exact:true}).uncheck();
  await modal.getByRole("button",{name:"Create 10 videos",exact:true}).click();
  await expect(modal.getByRole("heading",{name:"10 videos created",exact:true})).toBeVisible();
  expect(state.requests[0]).toMatchObject({hooks:headlines,labelId:"headline",render:false});
  expect(state.source().timeline.labels[0].text).toBe("Brand intact");expect(state.source().timeline.labels[1].text).toBe("Original headline");
  for(const [index,variant] of state.variants.entries()){const expected=structuredClone(state.source().timeline);expected.labels[1].text=headlines[index];expect(variant.timeline).toEqual(expected);}
  await modal.getByLabel("Label to vary",{exact:true}).selectOption("brand");
  await expect(modal.locator(".video-variant-result-heading b").first()).toHaveText(headlines[0]);
  await modal.getByRole("button",{name:"Close text variants",exact:true}).click();
  await page.getByLabel("Label text",{exact:true}).fill("Brand revision after batch");
  await page.getByRole("button",{name:"Bulk text",exact:true}).click();
  await modal.getByRole("button",{name:"Edit video 10",exact:true}).click();
  await expect(page.getByLabel("Video project name",{exact:true})).toHaveValue("Connected app launch · 10");
  expect(state.source().timeline.labels[0].text).toBe("Brand revision after batch");
  await page.locator(".video-label-tabs").getByRole("button").nth(1).click();
  await expect(page.getByLabel("Label text",{exact:true})).toHaveValue(headlines[9]);
  await expect(page.getByLabel("Label entrance animation",{exact:true})).toHaveValue("typewriter");
  await expect(page.getByRole("button",{name:"Back to videos",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Back to videos",exact:true}).click();
  await expect(page.locator(".video-project-grid article")).toHaveCount(11);
  expect(state.errors).toEqual([]);
});

test("bulk input limits, keyboard dismissal and network retry keep the source and batch identity",async({page})=>{
  const state=await editor(page);await page.getByRole("button",{name:"Bulk text",exact:true}).click();const modal=panel(page);
  await expect(modal.getByRole("button",{name:"Create & render videos",exact:true})).toBeDisabled();
  await modal.getByLabel("Variant texts",{exact:true}).fill(Array(21).fill("A hook").join("\n"));
  await expect(modal.getByRole("alert")).toHaveText("Use up to 20 texts in one batch.");
  await expect(modal.getByRole("button",{name:"Create & render 21 videos",exact:true})).toBeDisabled();
  await modal.getByLabel("Variant texts",{exact:true}).fill("x".repeat(501));await expect(modal.getByRole("alert")).toHaveText("Each text can contain up to 500 characters.");
  expect(state.requests).toHaveLength(0);
  await page.keyboard.press("Escape");await expect(modal).not.toBeVisible();await expect(page.getByRole("button",{name:"Bulk text",exact:true})).toBeFocused();
  await page.getByRole("button",{name:"Bulk text",exact:true}).click();await modal.getByLabel("Variant texts",{exact:true}).fill("First hook\nSecond hook");state.fail();
  await modal.getByRole("button",{name:"Create & render 2 videos",exact:true}).click();await expect(modal.getByRole("alert")).toContainText("interrupted");
  await modal.getByRole("button",{name:"Create & render 2 videos",exact:true}).click();await expect(modal.getByRole("heading",{name:"2 videos created",exact:true})).toBeVisible();
  expect(state.requests).toHaveLength(2);expect(state.requests[0].clientRequestId).toBe(state.requests[1].clientRequestId);expect(state.source().timeline.labels[0].text).toBe("Brand stays");
  expect(state.errors).toEqual([]);
});

test("queued bulk exports expose individual retry, playable previews, downloads and post handoff",async({page})=>{
  const state=await editor(page);state.partial();await page.getByRole("button",{name:"Bulk text",exact:true}).click();const modal=panel(page);
  await modal.getByLabel("Label to vary",{exact:true}).selectOption("headline");await modal.getByLabel("Variant texts",{exact:true}).fill("First promotion\nSecond promotion\nThird promotion");
  await modal.getByRole("button",{name:"Create & render 3 videos",exact:true}).click();
  const items=modal.getByRole("region",{name:"Created video variants",exact:true}).locator("ol > li");await expect(items).toHaveCount(3);
  await expect(items.nth(1)).toContainText("Queue temporarily unavailable");await items.nth(1).getByRole("button",{name:"Retry export",exact:true}).click();
  await expect(items.nth(1)).toContainText("queued");state.complete();
  await expect(modal.getByRole("link",{name:/Download video/})).toHaveCount(3);
  await items.first().getByText("Preview exported video 1",{exact:true}).click();
  const video=items.first().getByLabel("Exported variant 1",{exact:true});await video.evaluate(element=>{const video=element as HTMLVideoElement;video.muted=true;video.load();});
  await expect.poll(()=>video.evaluate(element=>(element as HTMLVideoElement).videoWidth)).toBeGreaterThan(0);await video.evaluate(element=>(element as HTMLVideoElement).play());
  await expect.poll(()=>video.evaluate(element=>(element as HTMLVideoElement).currentTime)).toBeGreaterThan(.1);
  const download=page.waitForEvent("download");await items.first().getByRole("link",{name:"Download video 1",exact:true}).click();expect((await download).suggestedFilename()).toBe("variant.mp4");
  await items.nth(1).getByRole("button",{name:"Create post for video 2",exact:true}).click();
  await expect(page.getByRole("dialog",{name:"Create post",exact:true})).toBeVisible();await expect(page.locator(".composer textarea").first()).toHaveValue("Discover Second promotion");
  expect(state.errors).toEqual([]);
});
