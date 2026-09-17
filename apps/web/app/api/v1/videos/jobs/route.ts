import { sql } from "@relay/database";
import { requireApiSession } from "../../../../../lib/api-session";
import { serializeRenderJob, type RenderJobRow } from "../../../../../lib/render-jobs";
export const runtime="nodejs";
export async function GET(request:Request){
 const auth=await requireApiSession(request,{apiKeyScope:"videos:read"}); if(auth.response)return auth.response;
 const id=new URL(request.url).searchParams.get("id");
 const rows=id?await sql<RenderJobRow[]>`SELECT * FROM video_render_job WHERE owner_id=${auth.session.user.id} AND id=${id}`:await sql<RenderJobRow[]>`SELECT * FROM video_render_job WHERE owner_id=${auth.session.user.id} ORDER BY created_at DESC LIMIT 100`;
 if(id&&!rows.length)return Response.json({error:"Render job not found."},{status:404});
 return Response.json({data:id?serializeRenderJob(rows[0]):rows.map(serializeRenderJob)});
}
export async function PATCH(request:Request){
 const auth=await requireApiSession(request,{apiKeyScope:"videos:write"}); if(auth.response)return auth.response;
 const body=await request.json().catch(()=>null); if(typeof body?.id!=="string"||!["cancel","retry"].includes(body.action))return Response.json({error:"Supply a job id and cancel or retry action."},{status:400});
 const rows=body.action==="cancel"?await sql<RenderJobRow[]>`UPDATE video_render_job SET status='cancelled',lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=${body.id} AND owner_id=${auth.session.user.id} AND status IN ('queued','running') RETURNING *`:await sql<RenderJobRow[]>`UPDATE video_render_job SET status='queued',progress=0,error=NULL,attempts=0,lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=${body.id} AND owner_id=${auth.session.user.id} AND status IN ('failed','cancelled') RETURNING *`;
 return rows[0]?Response.json({data:serializeRenderJob(rows[0])}):Response.json({error:"Job cannot perform that transition."},{status:409});
}
