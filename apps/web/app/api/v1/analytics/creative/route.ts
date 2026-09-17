import { sql } from "@relay/database";
import { requireApiSession } from "../../../../../lib/api-session";
export const runtime="nodejs";
export async function GET(request:Request){const auth=await requireApiSession(request,{apiKeyScope:"analytics:read"});if(auth.response)return auth.response;
 const url=new URL(request.url);const hours=Number(url.searchParams.get("hours")??72);if(![24,72,168].includes(hours))return Response.json({error:"Choose a 24, 72 or 168 hour observation window."},{status:400});
 const brandId=url.searchParams.get("brandId")||null;
 const rows=await sql<{post_id:string;provider:string;account_id:string;origin:{projectId:string;revision:number;name:string;templateId:string|null;hook:string};views:number|null;likes:number|null;saves:number|null;watch_time_seconds:number|null;captured_at:Date|null}[]>`
 SELECT p.id AS post_id,t.provider,t.social_account_id AS account_id,p.creative_origin AS origin,m.views::float8,m.likes::float8,m.saves::float8,m.watch_time_seconds::float8,m.captured_at
 FROM post p JOIN post_target t ON t.post_id=p.id LEFT JOIN LATERAL (
 SELECT views,likes,saves,watch_time_seconds,captured_at FROM post_metric_snapshot WHERE target_id=t.id
 AND captured_at>=p.published_at+(${hours*.8}*interval '1 hour') AND captured_at<=p.published_at+(${hours}*interval '1 hour') ORDER BY captured_at DESC LIMIT 1
 ) m ON true WHERE p.owner_id=${auth.session.user.id} AND p.creative_origin IS NOT NULL AND p.published_at<=now()-(${hours}*interval '1 hour') AND (${brandId}::text IS NULL OR p.brand_id=${brandId}) ORDER BY p.published_at DESC LIMIT 1000`;
 const grouped=new Map<string,{templateId:string;provider:string;accountId:string;posts:number;measured:number;views:number[];saves:number[];watch:number[]}>();
 for(const r of rows){const templateId=r.origin.templateId??"custom";const key=JSON.stringify([templateId,r.provider,r.account_id]);const group=grouped.get(key)??{templateId,provider:r.provider,accountId:r.account_id,posts:0,measured:0,views:[],saves:[],watch:[]};group.posts++;if(r.captured_at)group.measured++;if(r.views!==null)group.views.push(r.views);if(r.saves!==null)group.saves.push(r.saves);if(r.watch_time_seconds!==null)group.watch.push(r.watch_time_seconds);grouped.set(key,group);}
 const mean=(v:number[])=>v.length?v.reduce((a,b)=>a+b,0)/v.length:null;
 return Response.json({data:{observationHours:hours,note:"Observational comparisons within each account and platform. Snapshots use the final 20% of the selected post-age window. Missing observations are excluded, not treated as zero.",groups:[...grouped.values()].map(g=>({templateId:g.templateId,provider:g.provider,accountId:g.accountId,posts:g.posts,measured:g.measured,meanViews:mean(g.views),viewsSample:g.views.length,meanSaves:mean(g.saves),savesSample:g.saves.length,meanWatchTimeSeconds:mean(g.watch),watchSample:g.watch.length})),posts:rows.map(r=>({postId:r.post_id,provider:r.provider,accountId:r.account_id,...r.origin,views:r.views,saves:r.saves,capturedAt:r.captured_at}))}});
}
