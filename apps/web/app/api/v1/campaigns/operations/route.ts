import { sql } from "@relay/database";
import { requireApiSession } from "../../../../../lib/api-session";
export const runtime="nodejs";
export async function POST(request:Request){const auth=await requireApiSession(request,{apiKeyScope:"posts:write"});if(auth.response)return auth.response;
 try{const body=await request.json();if(typeof body.id!=="string"||!["shift","pause","resume"].includes(body.action))throw new Error("Supply campaign id and shift, pause, or resume action.");if(body.action==="shift"&&(!Number.isInteger(body.minutes)||Math.abs(body.minutes)>525600))throw new Error("Shift minutes must be an integer within one year.");
 const result=await sql.begin(async tx=>{const [campaign]=await tx`SELECT id FROM campaign WHERE id=${body.id} AND owner_id=${auth.session.user.id} FOR UPDATE`;if(!campaign)throw new Error("Campaign not found.");
 const posts=await tx<{id:string;scheduled_at:Date}[]>`SELECT id,scheduled_at FROM post WHERE campaign_id=${body.id} AND status='scheduled' FOR UPDATE`;
 const targets=posts.length?await tx<{status:string;publish_lease_owner:string|null}[]>`SELECT status,publish_lease_owner FROM post_target WHERE post_id=ANY(${posts.map(p=>p.id)}) FOR UPDATE`:[];
 if(targets.some(t=>t.status!=="scheduled"||t.publish_lease_owner))throw new Error("Some posts have started publishing. Reload before modifying the campaign.");
 if(body.action!=="shift"){await tx`UPDATE campaign SET paused=${body.action==="pause"},updated_at=now() WHERE id=${body.id}`;return {paused:body.action==="pause",pendingPosts:posts.length};}
 const updates=posts.map(p=>({id:p.id,previous:new Date(p.scheduled_at).toISOString(),scheduledAt:new Date(new Date(p.scheduled_at).getTime()+body.minutes*60000).toISOString()}));if(updates.some(u=>Date.parse(u.scheduledAt)<=Date.now()))throw new Error("All shifted posts must remain in the future.");
 if(body.preview!==false)return {updates,preview:true,spacing:"elapsed-time",note:"Local clock times may change across daylight-saving boundaries."};
 for(const u of updates){await tx`UPDATE post SET scheduled_at=${u.scheduledAt},updated_at=now() WHERE id=${u.id}`;await tx`UPDATE post_target SET publish_after=${u.scheduledAt},updated_at=now() WHERE post_id=${u.id}`;}return {updates,preview:false};});return Response.json({data:result});
 }catch(e){return Response.json({error:(e as Error).message},{status:400});}}
