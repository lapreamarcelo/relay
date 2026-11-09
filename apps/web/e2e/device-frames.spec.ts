import { expect, test } from "@playwright/test";

const screen = "https://media.example.test/screen.png";
const artwork = '<svg xmlns="http://www.w3.org/2000/svg" width="390" height="844"><rect width="390" height="844" fill="#dce8e0"/><rect x="30" y="120" width="330" height="140" rx="20" fill="#376456"/><text x="35" y="90" font-size="34">Your app</text></svg>';

test("device frame survives video autosave and reopening", async ({page}) => {
  let project:any={id:"frame-video",name:"Product demo",caption:"",brandId:"",labels:[],revision:1,createdAt:"2026-09-22T00:00:00Z",updatedAt:"2026-09-22T00:00:00Z",timeline:{version:1,aspectRatio:"9:16",clips:[{id:"screen",name:"Screenshot",sourceUrl:screen,kind:"image",inMs:0,outMs:5000,fit:"contain",x:.5,y:.5,zoom:1,volume:1}],labels:[],music:{url:"",volume:1,offsetMs:0,fadeInMs:0,fadeOutMs:0},coverMs:0}};
  await page.route("https://media.example.test/**",r=>r.fulfill({contentType:"image/svg+xml",body:artwork}));
  await page.route("**/api/v1/videos",r=>{if(r.request().method()==="PATCH"){project={...r.request().postDataJSON(),revision:project.revision+1};return r.fulfill({json:{data:project}});}return r.fulfill({json:{data:[project]}});});
  for(const path of ["videos/templates","brands/kit","videos/jobs*"]) await page.route(`**/api/v1/${path}`,r=>r.fulfill({json:{data:[]}}));
  await page.goto("/demo?view=videos");
  await page.getByRole("button",{name:/^Product demo/}).click();
  await page.getByRole("group",{name:"Device frame",exact:true}).getByRole("button",{name:"Phone",exact:true}).click();
  await page.getByLabel("Device background color",{exact:true}).fill("#abc123");
  await expect(page.locator('[data-device-preview="phone"]')).toBeVisible();
  await expect.poll(()=>project.timeline.clips[0].deviceFrame?.background.toLowerCase()).toBe("#abc123");
  await page.reload();
  await page.getByRole("button",{name:/^Product demo/}).click();
  await expect(page.getByRole("group",{name:"Device frame",exact:true}).getByRole("button",{name:"Phone",exact:true})).toHaveAttribute("aria-pressed","true");
  await expect(page.getByLabel("Device background color",{exact:true})).toHaveValue("#abc123");
  await page.screenshot({path:`/tmp/relay-device-video-${test.info().project.name}.png`,fullPage:true});
  await page.getByRole("group",{name:"Device frame",exact:true}).getByRole("button",{name:"None",exact:true}).click();
  await expect.poll(()=>project.timeline.clips[0].deviceFrame).toBeUndefined();
});

test("slideshow saves a framed screenshot and invalidates the old render",async({page})=>{
  let saved:any;
  let project={id:"frame-slides",name:"Framed screenshots",caption:"",brandId:"",createdAt:"2026-09-22T00:00:00Z",updatedAt:"2026-09-22T00:00:00Z",slides:[{id:"slide",mediaUrl:screen,renderedUrl:screen,fit:"contain",textPosition:"bottom",textSize:64,textColor:"#FFFFFF",textBackground:"none"}]};
  await page.route("https://media.example.test/**",r=>r.fulfill({contentType:"image/svg+xml",body:artwork}));
  await page.route("**/api/v1/slideshows",r=>{if(r.request().method()!=="GET"){saved=r.request().postDataJSON();project={...project,...saved};return r.fulfill({json:{data:project}});}return r.fulfill({json:{data:[project]}});});
  const backdrop = "https://media.example.test/background.png";
  await page.route("**/api/v1/media?*", r => r.fulfill({json:{data:[{key:"background",name:"Background.png",url:backdrop}]}}));
  await page.route("**/api/v1/media/projects?*", r => r.fulfill({json:{data:[]}}));
  await page.route("**/api/v1/media/sources", r => r.fulfill({json:{configured:false}}));
  await page.goto("/demo?view=slideshows");
  await page.getByRole("button",{name:/Framed screenshots/}).first().click();
  await page.getByRole("group",{name:"Device frame",exact:true}).getByRole("button",{name:"Tablet",exact:true}).click();
  await page.getByLabel("Device background color",{exact:true}).fill("#123456");
  await expect(page.locator(".slide-stage .slide-rendered")).toHaveCount(0);
  await expect(page.locator('.slide-stage [data-device-preview="tablet"]')).toBeVisible();
  await page.getByRole("button",{name:"Save",exact:true}).click();
  await expect.poll(()=>saved?.slides[0].deviceFrame).toMatchObject({device:"tablet",background:"#123456"});
  expect(saved.slides[0].renderedUrl).toBeUndefined();
  await page.getByLabel("Canvas background style",{exact:true}).selectOption("image");
  await page.getByRole("dialog").getByRole("button",{name:/Background.png/}).click();
  await page.getByLabel("Background image fit",{exact:true}).selectOption("contain");
  await expect(page.locator('.slide-stage [data-device-preview="tablet"]')).toHaveCSS("background-size","contain, auto");
  await expect(page.locator(".slide-stage .slide-rendered")).toHaveCount(0);
  await page.getByRole("button",{name:"Save",exact:true}).click();
  await expect.poll(()=>saved?.slides[0].background).toEqual({color:"#123456",imageUrl:backdrop,imageFit:"contain"});
  expect(saved.slides).toHaveLength(1);
  expect(saved.slides[0].mediaUrl).toBe(screen);
  await page.reload();
  await page.getByRole("button",{name:/Framed screenshots/}).first().click();
  await expect(page.getByLabel("Canvas background style",{exact:true})).toHaveValue("image");
  await expect(page.getByLabel("Background image fit",{exact:true})).toHaveValue("contain");
  await page.screenshot({path:`/tmp/relay-device-image-background-${test.info().project.name}.png`,fullPage:true});
  await page.getByRole("button",{name:"Remove background image",exact:true}).click();
  await expect(page.getByLabel("Canvas background style",{exact:true})).toHaveValue("solid");
  await page.getByLabel("Canvas background style",{exact:true}).selectOption("default");
  await expect(page.getByLabel("Device background color",{exact:true})).toHaveValue("#123456");
  await page.screenshot({path:`/tmp/relay-device-slide-${test.info().project.name}.png`,fullPage:true});
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
});

test("uploaded slideshow backgrounds are committed without adding or replacing a screen",async({page})=>{
  let saved:any;
  const staged="https://media.example.test/staged/background.png",permanent="https://media.example.test/library/background.png";
  const project={id:"upload-background",name:"Background upload",caption:"",brandId:"",createdAt:"2026-11-06T00:00:00Z",updatedAt:"2026-11-06T00:00:00Z",slides:[{id:"slide",mediaUrl:screen,fit:"contain",textPosition:"bottom",textSize:64,textColor:"#FFFFFF",textBackground:"none",deviceFrame:{device:"phone",background:"#123456",color:"#171717"}}]};
  await page.route("https://media.example.test/**",r=>r.fulfill({contentType:"image/svg+xml",body:artwork}));
  await page.route("**/api/v1/slideshows",r=>{if(r.request().method()!=="GET"){saved=r.request().postDataJSON();return r.fulfill({json:{data:{...project,...saved}}});}return r.fulfill({json:{data:[project]}});});
  await page.route("**/api/v1/media?*",r=>r.fulfill({json:{data:[]}}));
  await page.route("**/api/v1/media/projects?*",r=>r.fulfill({json:{data:[]}}));
  await page.route("**/api/v1/media/sources",r=>r.fulfill({json:{configured:false}}));
  await page.route("https://upload.example.test/background",r=>r.fulfill({status:200}));
  let committed=false;
  await page.route("**/api/v1/media",r=>{
    if(r.request().method()==="PATCH"){expect(r.request().postDataJSON()).toMatchObject({key:"staged/background.png",commit:true});committed=true;return r.fulfill({json:{url:permanent}});}
    return r.fulfill({json:{key:"staged/background.png",url:staged,uploadUrl:"https://upload.example.test/background"}});
  });
  await page.goto("/demo?view=slideshows");
  await page.getByRole("button",{name:/Background upload/}).first().click();
  await page.getByLabel("Canvas background style",{exact:true}).selectOption("image");
  const input=page.getByRole("dialog").locator('input[type="file"]');
  await expect(input).not.toHaveAttribute("multiple");
  await input.setInputFiles({name:"background.png",mimeType:"image/png",buffer:Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2ZCEAAAAASUVORK5CYII=","base64")});
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button",{name:"Save",exact:true}).click();
  await expect.poll(()=>committed).toBe(true);
  await expect.poll(()=>saved?.slides[0].background?.imageUrl).toBe(permanent);
  expect(saved.slides).toHaveLength(1);
  expect(saved.slides[0].mediaUrl).toBe(screen);
});
