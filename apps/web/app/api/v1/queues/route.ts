import type { ProviderId,ProviderPostSettings } from "@relay/core";
import { sql } from "@relay/database";
import { requireApiSession } from "../../../../lib/api-session";
import { upcomingQueueSlots,validateQueueSlots,type QueueSlot } from "../../../../lib/queue-slots";
import { listPostsForOwner } from "../../../../lib/post-repository";
import { validatePostPlan } from "@relay/core/post-validation";
export const runtime="nodejs";
export async function GET(request:Request){
 const auth=await requireApiSession(request,{apiKeyScope:"posts:read"});if(auth.response)return auth.response;
 const rows=await sql<{account_id:string;timezone:string;slots:QueueSlot[];paused:boolean}[]>`SELECT account_id,timezone,slots,paused FROM publishing_queue WHERE owner_id=${auth.session.user.id}`;
 return Response.json({data:rows.map(r=>({accountId:r.account_id,timezone:r.timezone,slots:r.slots,paused:r.paused,upcoming:upcomingQueueSlots(r.slots,r.timezone,new Date(),20)}))});
}
export async function PUT(request:Request){
 const auth=await requireApiSession(request,{apiKeyScope:"posts:write"});if(auth.response)return auth.response;
 try{const body=await request.json();if(typeof body.accountId!=="string"||typeof body.timezone!=="string"||typeof body.paused!=="boolean")throw new Error("Supply accountId, timezone, slots, and paused.");new Intl.DateTimeFormat("en",{timeZone:body.timezone}).format();const slots=validateQueueSlots(body.slots);
 const [account]=await sql`SELECT id FROM social_account WHERE id=${body.accountId} AND owner_id=${auth.session.user.id}`;if(!account)throw new Error("Account not found.");
 await sql.begin(async tx=>{await tx`SELECT id FROM post_target WHERE social_account_id=${body.accountId} AND status='scheduled' FOR UPDATE`;await tx`INSERT INTO publishing_queue(account_id,owner_id,timezone,slots,paused) VALUES(${body.accountId},${auth.session.user.id},${body.timezone},${JSON.stringify(slots)}::jsonb,${body.paused}) ON CONFLICT(account_id) DO UPDATE SET timezone=EXCLUDED.timezone,slots=EXCLUDED.slots,paused=EXCLUDED.paused,updated_at=now()`;});
 return Response.json({data:{accountId:body.accountId,timezone:body.timezone,slots,paused:body.paused}});
 }catch(e){return Response.json({error:(e as Error).message},{status:400});}
}
export async function POST(request:Request){
 const auth=await requireApiSession(request,{apiKeyScope:"posts:write"});if(auth.response)return auth.response;
 try{const body=await request.json();if(typeof body.accountId!=="string"||!Array.isArray(body.postIds)||!body.postIds.length||body.postIds.length>100||body.postIds.some((v:unknown)=>typeof v!=="string")||new Set(body.postIds).size!==body.postIds.length)throw new Error("Supply accountId and 1–100 unique draft postIds.");
 const posts=await listPostsForOwner(auth.session.user.id);const chosen=(body.postIds as string[]).map((id:string)=>posts.find(p=>p.id===id));
 for(const p of chosen){if(!p||p.status!=="draft"||p.targets.length!==1||p.targets[0].accountId!==body.accountId)throw new Error("Queue filling requires drafts with exactly this account as their destination.");const issues=validatePostPlan({text:p.text,mediaType:p.mediaType,mediaCount:p.mediaUrls?.length??(p.mediaUrl?1:0),scheduledAt:null,destinations:p.targets.map(t=>({provider:t.provider,settings:t.settings,textOverride:t.textOverride}))});if(issues.length)throw new Error(issues[0].message);}
 const result=await sql.begin(async tx=>{
 const [queue]=await tx<{slots:QueueSlot[];timezone:string}[]>`SELECT slots,timezone FROM publishing_queue WHERE account_id=${body.accountId} AND owner_id=${auth.session.user.id} FOR UPDATE`;if(!queue)throw new Error("Create weekly slots first.");
 const drafts=await tx<{id:string;status:string;text:string;media_type:"none"|"image"|"video";media_url:string|null;media_urls:string[]}[]>`SELECT id,status,text,media_type,media_url,media_urls FROM post WHERE id=ANY(${body.postIds}) AND owner_id=${auth.session.user.id} FOR UPDATE`;if(drafts.length!==body.postIds.length||drafts.some(p=>p.status!=="draft"))throw new Error("Drafts changed; reload before filling the queue.");
 const targets=await tx<{post_id:string;social_account_id:string;status:string;provider:ProviderId;settings:ProviderPostSettings;text_override:string|null}[]>`SELECT post_id,social_account_id,status,provider,settings,text_override FROM post_target WHERE post_id=ANY(${body.postIds}) FOR UPDATE`;if(targets.length!==drafts.length||targets.some(t=>t.social_account_id!==body.accountId||t.status!=="draft"))throw new Error("Destinations changed; reload before filling the queue.");
 for(const draft of drafts){const issues=validatePostPlan({text:draft.text,mediaType:draft.media_type,mediaCount:draft.media_urls?.length??(draft.media_url?1:0),scheduledAt:null,destinations:targets.filter(t=>t.post_id===draft.id).map(t=>({provider:t.provider,settings:t.settings,textOverride:t.text_override??undefined}))});if(issues.length)throw new Error(issues[0].message);}
 const occupied=await tx<{scheduled_at:Date}[]>`SELECT p.scheduled_at FROM post p JOIN post_target t ON t.post_id=p.id WHERE t.social_account_id=${body.accountId} AND t.status='scheduled' AND p.scheduled_at>now()`;
 const used=new Set(occupied.map(p=>new Date(p.scheduled_at).toISOString()));const slots=upcomingQueueSlots(queue.slots,queue.timezone,new Date(),500).filter(s=>!used.has(s.scheduledAt)&&(!body.category||s.category===body.category));if(slots.length<drafts.length)throw new Error("Not enough free matching slots in the next 90 days.");
 const updates=body.postIds.map((id:string,i:number)=>({id,scheduledAt:slots[i].scheduledAt}));
 if(body.preview!==false)return {updates,preview:true};
 for(const u of updates){await tx`UPDATE post SET status='scheduled',scheduled_at=${u.scheduledAt},updated_at=now() WHERE id=${u.id}`;await tx`UPDATE post_target SET status='scheduled',publish_after=${u.scheduledAt},updated_at=now() WHERE post_id=${u.id}`;}
 return {updates,preview:false};});return Response.json({data:result});
 }catch(e){return Response.json({error:(e as Error).message},{status:400});}
}
