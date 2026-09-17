import { sql } from "@relay/database";
import type { VideoRenderJob } from "@relay/core";
import { serializeVideoProject, type VideoProjectRow } from "./videos";
export interface RenderJobRow { cover_url?:string|null; snapshot?:import("@relay/core").VideoProject; kind?: "render" | "captions"; captions?: import("@relay/core").TimedVideoLabel[] | null; id:string; project_id:string; revision:number; status:VideoRenderJob["status"]; progress:number; rendered_url:string|null; error:string|null }
export const serializeRenderJob=(r:RenderJobRow):VideoRenderJob=>({coverUrl:r.cover_url??undefined,coverMs:r.snapshot?.timeline?.coverMs,kind:r.kind??"render",captions:r.captions??undefined,id:r.id,projectId:r.project_id,revision:r.revision,status:r.status,progress:r.progress,renderedUrl:r.rendered_url??undefined,error:r.error??undefined});
export async function enqueueRender(ownerId:string,id:string,kind: "render" | "captions" = "render") {
  return sql.begin(async tx=>{
    const [row]=await tx<VideoProjectRow[]>`SELECT * FROM video_project WHERE id=${id} AND owner_id=${ownerId} FOR UPDATE`;
    if(!row) throw new Error("Video project not found.");
    const project=serializeVideoProject(row);
    if(!project.timeline?.clips.length && !project.sourceUrl) throw new Error("Add a source clip before rendering.");
    const [job]=await tx<RenderJobRow[]>`INSERT INTO video_render_job(id,owner_id,project_id,revision,snapshot,kind) VALUES(${crypto.randomUUID()},${ownerId},${id},${row.revision??1},${JSON.stringify(project)}::jsonb,${kind}) ON CONFLICT(project_id,revision,kind) DO UPDATE SET updated_at=video_render_job.updated_at RETURNING *`;
    return {job:serializeRenderJob(job),data:project};
  });
}
