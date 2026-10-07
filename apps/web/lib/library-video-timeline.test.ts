import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { emptyTimeline } from "./video-timeline.ts";

let writes=0;
let queries=0;
Object.assign(process.env,{R2_ACCOUNT_ID:"local",R2_ACCESS_KEY_ID:"local",R2_SECRET_ACCESS_KEY:"local",R2_BUCKET_NAME:"local",R2_PUBLIC_URL:"https://media.example.test/library"});
Object.assign(globalThis,{__relayLibraryTimelineTest:{sql:async(strings:TemplateStringsArray,...values:unknown[])=>{
 queries++;
 const statement=strings.join("");
 assert.match(statement,/^(INSERT|UPDATE)/);
 assert.ok(values.includes("owner"));
 writes++;
 const timeline=JSON.parse(String(values.find(value=>typeof value==="string"&&value.startsWith('{"version":1'))));
 if(statement.includes("creative_template"))return [{id:"template",name:"Demo",description:"",timeline}];
 return [{id:"project",brand_id:null,name:"Demo",caption:"",source_url:"",source_folder_id:null,music_url:null,music_folder_id:null,labels:[],timeline,revision:2,rendered_url:null,created_at:new Date(0),updated_at:new Date(0)}];
}}});
registerHooks({resolve(specifier,context,next){
 let code:string|undefined;
 if(specifier==="server-only")code="export{}";
 else if(specifier==="@relay/database")code="export const sql=globalThis.__relayLibraryTimelineTest.sql";
 else if(specifier.endsWith("/api-session"))code="export async function requireApiSession(request,options){const token=request.headers.get('authorization');if(!token)return{response:Response.json({error:'Unauthorized'},{status:401})};if(token!=='Bearer write'||options.apiKeyScope!=='videos:write')return{response:Response.json({error:'Missing write scope'},{status:403})};return{session:{user:{id:'owner'}}}}";
 if(code)return{url:`data:text/javascript,${encodeURIComponent(code)}`,shortCircuit:true};
 try{return next(specifier,context)}catch(error){if(specifier.startsWith(".")&&!/\.[a-z]+$/i.test(specifier))return next(specifier+".ts",context);throw error;}
}});
const {normalizeLibraryVideoTimeline}=await import("./library-video-timeline.ts");
const project=await import("../app/api/v1/videos/route.ts");
const templates=await import("../app/api/v1/videos/templates/route.ts");
const timeline=(imageUrl="https://media.example.test/library/backdrop%20photo.png")=>({...emptyTimeline(),background:{color:"#112233",imageUrl,imageFit:"contain"}});
const endpoints=[{name:"project POST",method:"POST",handle:project.POST},{name:"project PATCH",method:"PATCH",handle:project.PATCH},{name:"template POST",method:"POST",handle:templates.POST}];
const request=(method:string,document:unknown,token="write")=>new Request("https://relay.test/api/v1/videos",{method,headers:token?{authorization:`Bearer ${token}`}:{},body:JSON.stringify({id:"project",revision:1,name:"Demo",timeline:document})});

test("library normalizer leaves legacy backgrounds unchanged and accepts a library object path",()=>{
 assert.deepEqual(normalizeLibraryVideoTimeline({...emptyTimeline(),background:{color:"#112233"}}).background,{color:"#112233"});
 assert.deepEqual(normalizeLibraryVideoTimeline(timeline()).background,timeline().background);
});

test("project and template persistence reject third-party and ambiguous image URLs before database writes",async()=>{
 for(const endpoint of endpoints)for(const imageUrl of ["https://outside.example/backdrop.png","https://media.example.test/library-neighbor/backdrop.png","https://media.example.test/library/../private.png","https://media.example.test/library/background.png?redirect=https://outside.example","https://user:password@media.example.test/library/background.png","https://media.example.test/library/folder%2Fprivate.png"]) {
  writes=0;queries=0;
  const response=await endpoint.handle(request(endpoint.method,timeline(imageUrl)));
  assert.equal(response.status,400,`${endpoint.name}: ${imageUrl}`);
  assert.match((await response.json()).error,/Relay R2 library/);
  assert.equal(writes,0);assert.equal(queries,0);
 }
});

test("project and template persistence retain an allowed image background in the saved document",async()=>{
 for(const endpoint of endpoints) {
  writes=0;queries=0;
  const response=await endpoint.handle(request(endpoint.method,timeline()));
  assert.equal(response.status,endpoint.method==="POST"?201:200,endpoint.name);
  assert.deepEqual((await response.json()).data.timeline.background,timeline().background);
  assert.equal(writes,1);
 }
});

test("image validation preserves write authorization before database access or request parsing",async()=>{
 for(const endpoint of endpoints)for(const [token,status]of [["",401],["read-only",403]]as const) {
  writes=0;queries=0;
  const response=await endpoint.handle(new Request("https://relay.test/api/v1/videos",{method:endpoint.method,headers:token?{authorization:`Bearer ${token}`}:{},body:"malformed-json"}));
  assert.equal(response.status,status,endpoint.name);assert.equal(writes,0);assert.equal(queries,0);
 }
});
