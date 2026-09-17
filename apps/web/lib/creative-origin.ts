import { sql } from "@relay/database";
export async function creativeOrigin(ownerId:string,url:string|null){
 if(!url)return null;
 const [job]=await sql<{project_id:string;revision:number;snapshot:{name?:string;templateId?:string;timeline?:{labels?:Array<{text:string}>};labels?:Array<{text:string}>}}[]>`SELECT project_id,revision,snapshot FROM video_render_job WHERE owner_id=${ownerId} AND rendered_url=${url} AND status='completed' ORDER BY updated_at DESC LIMIT 1`;
 return job?{projectId:job.project_id,revision:job.revision,name:job.snapshot.name??"Video",templateId:job.snapshot.templateId??null,hook:job.snapshot.timeline?.labels?.[0]?.text??job.snapshot.labels?.[0]?.text??""}:null;
}
