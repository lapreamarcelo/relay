// Run only against an isolated database after migrations. Never starts a publisher.
import assert from "node:assert/strict";
import { sql } from "@relay/database";
import { createApiKeySecret,agentApiKeyScopes } from "../lib/api-keys";
import * as videos from "../app/api/v1/videos/route";
import * as rendering from "../app/api/v1/videos/render/route";
import * as jobs from "../app/api/v1/videos/jobs/route";
import * as queues from "../app/api/v1/queues/route";
import * as ideas from "../app/api/v1/ideas/route";
import * as campaigns from "../app/api/v1/campaigns/route";
import * as operations from "../app/api/v1/campaigns/operations/route";
import * as recipes from "../app/api/v1/campaigns/recipes/route";
import * as variants from "../app/api/v1/videos/variants/route";
import { emptyTimeline } from "../lib/video-timeline";
if(!process.env.DATABASE_URL?.includes("127.0.0.1:55439/"))throw new Error("This test is restricted to the isolated port 55439 test database.");
const owner=crypto.randomUUID(),other=crypto.randomUUID(),account=crypto.randomUUID();const key=createApiKeySecret(),otherKey=createApiKeySecret();
const request=(path:string,method:string,body?:unknown,secret=key.secret)=>new Request(`http://localhost/api/v1/${path}`,{method,headers:{Authorization:`Bearer ${secret}`,"Content-Type":"application/json"},...(body===undefined?{}:{body:JSON.stringify(body)})});
const data=async(response:Response,status=200)=>{const payload=await response.json();assert.equal(response.status,status,JSON.stringify(payload));return payload.data;};
try{
 for(const [id,k] of [[owner,key],[other,otherKey]] as const){await sql`INSERT INTO "user"(id,name,email) VALUES(${id},'Test',${`${id}@example.test`})`;await sql`INSERT INTO api_key(id,owner_id,name,key_prefix,key_hash,scopes) VALUES(${crypto.randomUUID()},${id},'Test',${k.prefix},${k.hash},${JSON.stringify(agentApiKeyScopes)}::jsonb)`;}
 await sql`INSERT INTO social_account(id,owner_id,provider,auth_method,provider_account_id,username,display_name,access_token_encrypted) VALUES(${account},${owner},'facebook','facebook',${account},'test','Test account','not-a-real-token')`;
 const timeline=emptyTimeline();timeline.clips=[{id:"a",sourceUrl:"https://media.example/a.mp4",name:"Test",kind:"video",inMs:0,outMs:2000,fit:"cover",x:.5,y:.5,zoom:1,volume:1}];
 const project=await data(await videos.POST(request("videos","POST",{name:"Timeline",sourceUrl:"",labels:[],timeline})),201);assert.equal(project.timeline.clips.length,1);
 const saved=await data(await videos.PATCH(request("videos","PATCH",{...project,name:"Changed"})));assert.equal(saved.revision,2);
 await data(await videos.PATCH(request("videos","PATCH",{...project,name:"Stale"})),409);
 await data(await videos.GET(request(`videos?id=${project.id}`,"GET",undefined,otherKey.secret)),404);
 const response=await rendering.POST(request("videos/render","POST",{id:project.id,async:true}));assert.equal(response.status,202);const first=(await response.json()).job;
 const response2=await rendering.POST(request("videos/render","POST",{id:project.id,async:true}));assert.equal((await response2.json()).job.id,first.id);
 await data(await jobs.GET(request(`videos/jobs?id=${first.id}`,"GET",undefined,otherKey.secret)),404);
 assert.equal((await data(await jobs.PATCH(request("videos/jobs","PATCH",{id:first.id,action:"cancel"})))).status,"cancelled");
 assert.equal((await data(await jobs.PATCH(request("videos/jobs","PATCH",{id:first.id,action:"retry"})))).status,"queued");
 const batch={id:project.id,hooks:["First hook","Second hook"],clientRequestId:"smoke-batch"};const one=await data(await variants.POST(request("videos/variants","POST",batch)),201);const two=await data(await variants.POST(request("videos/variants","POST",batch)),201);assert.deepEqual(one.map((e:{project:{id:string}})=>e.project.id),two.map((e:{project:{id:string}})=>e.project.id));
 await data(await queues.PUT(request("queues","PUT",{accountId:account,timezone:"Europe/Madrid",paused:true,slots:[{day:1,time:"09:00"}]})));
 const post=crypto.randomUUID();await sql`INSERT INTO post(id,owner_id,text,media_type,status) VALUES(${post},${owner},'Draft text','none','draft')`;await sql`INSERT INTO post_target(id,post_id,social_account_id,provider,account_display_name,account_handle,status,settings) VALUES(${crypto.randomUUID()},${post},${account},'facebook','Test','test','draft','{"kind":"facebook","publishType":"feed"}'::jsonb)`;
 const planned=await data(await queues.POST(request("queues","POST",{accountId:account,postIds:[post],preview:true})));assert.equal(planned.preview,true);assert.equal((await sql`SELECT status FROM post WHERE id=${post}`)[0].status,"draft");
 await data(await queues.POST(request("queues","POST",{accountId:account,postIds:[post],preview:false})));assert.equal((await sql`SELECT status FROM post WHERE id=${post}`)[0].status,"scheduled");
 const idea=await data(await ideas.POST(request("ideas","POST",{title:"A useful idea"})),201);await data(await ideas.DELETE(request("ideas","DELETE",{id:idea.id},otherKey.secret)),404);
 const recipeRequest={action:"apply",recipeId:"launch",clientRequestId:"smoke-launch",accountIds:[account],startAt:new Date(Date.now()+86400000).toISOString()};
 const recipeOne=await data(await recipes.POST(request("campaigns/recipes","POST",recipeRequest)),201);
 const recipeTwo=await data(await recipes.POST(request("campaigns/recipes","POST",recipeRequest)),201);
 await data(await operations.POST(request("campaigns/operations","POST",{id:recipeOne.campaignId,action:"pause"})));
 const campaignList=await data(await campaigns.GET(request("campaigns","GET")));
 assert.equal(campaignList.find((c:{id:string})=>c.id===recipeOne.campaignId).paused,true);
 assert.equal(recipeOne.posts.length,5);assert.deepEqual(recipeOne.posts.map((p:{postId:string})=>p.postId),recipeTwo.posts.map((p:{postId:string})=>p.postId));
 assert.equal((await sql`SELECT count(*)::int AS count FROM post WHERE campaign_id=${recipeOne.campaignId} AND status='draft'`)[0].count,5);
 await data(await recipes.POST(request("campaigns/recipes","POST",recipeRequest,otherKey.secret)),400);
 console.log("PASS: campaign recipe draft creation and idempotency,  real PostgreSQL project revisions, owner isolation, durable render dedup/cancel/retry, variant idempotency, queue preview/commit, and idea ownership");
}finally{await sql`DELETE FROM "user" WHERE id=ANY(${[owner,other]})`;await sql.end();}
