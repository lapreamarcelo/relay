import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getR2Client,getR2Config } from "../lib/r2";
import { sql } from "@relay/database";
import type { VideoProject } from "@relay/core";
import { renderVideoArtifactDetails } from "../lib/video-renderer";
import { transcribeTimeline } from "../lib/video-captions";
import { setTimeout as delay } from "node:timers/promises";
const shutdown=new AbortController();
for(const signal of ["SIGINT","SIGTERM"])process.on(signal,()=>shutdown.abort());
const rendererId=`renderer-${process.env.HOSTNAME??crypto.randomUUID()}`;
const reportHealth=async()=>{await sql`INSERT INTO worker_heartbeat(id,worker_id,metrics,checked_at) VALUES('renderer',${rendererId},'{}'::jsonb,now()) ON CONFLICT(id) DO UPDATE SET worker_id=EXCLUDED.worker_id,checked_at=now()`;};
const healthTimer=setInterval(()=>{void reportHealth().catch(()=>{});},20000);
try {
 await reportHealth();
 while(!shutdown.signal.aborted){
  const lease=crypto.randomUUID();
  const [job]=await sql<{id:string;project_id:string;revision:number;kind:string;snapshot:VideoProject}[]>`UPDATE video_render_job SET status='running',attempts=attempts+1,lease_token=${lease},lease_until=now()+interval '60 seconds',updated_at=now() WHERE id=(SELECT id FROM video_render_job WHERE (status='queued' OR (status='running' AND lease_until<now())) AND attempts<3 ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`;
  if(!job){await sql`UPDATE video_render_job SET status='failed',error='Render worker lease expired after three attempts.',lease_token=NULL WHERE status='running' AND lease_until<now() AND attempts>=3`; await delay(2000,undefined,{signal:shutdown.signal}).catch(()=>{});continue;}
  const abort=new AbortController(); const stop=()=>abort.abort(); shutdown.signal.addEventListener("abort",stop,{once:true});
  let checking=false;
  const heartbeat=setInterval(()=>{if(checking)return;checking=true;void sql`UPDATE video_render_job SET lease_until=now()+interval '60 seconds',updated_at=now() WHERE id=${job.id} AND lease_token=${lease} AND status='running' RETURNING id`.then(rows=>{if(!rows.length)abort.abort();}).catch(()=>abort.abort()).finally(()=>{checking=false;});},10000);
  try{
   const project=job.snapshot;
   if(job.kind === "captions") {
    if(!project.timeline?.clips.length)throw new Error("Convert the recipe to a timeline before generating captions.");
    const captions=await transcribeTimeline(project.timeline,abort.signal,async progress=>{await sql`UPDATE video_render_job SET progress=${progress} WHERE id=${job.id} AND lease_token=${lease} AND status='running'`;});
    abort.signal.throwIfAborted();
    await sql`UPDATE video_render_job SET status='completed',progress=100,captions=${JSON.stringify(captions)}::jsonb,lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=${job.id} AND lease_token=${lease} AND status='running'`;
    continue;
   }
   await getR2Client().send(new PutObjectCommand({Bucket:getR2Config().bucket,Key:`media-projects/${job.id}/.project.json`,Body:JSON.stringify({id:job.id,name:project.name,kind:"media",ownerId:(await sql<{owner_id:string}[]>`SELECT owner_id FROM video_render_job WHERE id=${job.id}`)[0].owner_id,createdAt:new Date().toISOString()}),ContentType:"application/json"}));
   const artifact=await renderVideoArtifactDetails({projectId:project.id,sourceUrl:project.sourceUrl,musicUrl:project.musicUrl,labels:project.labels,timeline:project.timeline,signal:abort.signal,targetKey:`media-projects/${job.id}/media/${lease}.mp4`,onProgress:async progress=>{abort.signal.throwIfAborted();await sql`UPDATE video_render_job SET progress=${progress} WHERE id=${job.id} AND lease_token=${lease} AND status='running'`;}});
   const renderedUrl=artifact.url;
   abort.signal.throwIfAborted();
   await sql.begin(async tx=>{
    const done=await tx`UPDATE video_render_job SET status='completed',progress=100,rendered_url=${renderedUrl},cover_url=${artifact.coverUrl??null},lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=${job.id} AND lease_token=${lease} AND status='running' RETURNING id`;
    if(done.length)await tx`UPDATE video_project SET rendered_url=${renderedUrl},rendered_cover_url=${artifact.coverUrl??null} WHERE id=${job.project_id} AND revision=${job.revision}`;
   });
  }catch(error){await sql`UPDATE video_render_job SET status='failed',error=${error instanceof Error?error.message.slice(0,1200):"Rendering failed"},lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=${job.id} AND lease_token=${lease} AND status='running'`;}
  finally{clearInterval(heartbeat);shutdown.signal.removeEventListener("abort",stop);}
 }
}finally{clearInterval(healthTimer);await sql.end();}
