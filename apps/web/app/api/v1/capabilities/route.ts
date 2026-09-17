import { sql } from "@relay/database";
import { auth } from "../../../../lib/auth";
import { agentApiKeyScopes,hashApiKey,readBearerToken } from "../../../../lib/api-keys";
export const runtime="nodejs";
export async function GET(request:Request){
 let scopes:readonly string[]=agentApiKeyScopes;const token=readBearerToken(request);
 if(token){const [key]=await sql<{scopes:string[]}[]>`SELECT scopes FROM api_key WHERE key_hash=${hashApiKey(token)} AND revoked_at IS NULL`;if(!key)return Response.json({error:"Invalid or revoked API key."},{status:401});scopes=key.scopes;}
 else if(!await auth.api.getSession({headers:request.headers}))return Response.json({error:"Unauthorized"},{status:401});
 return Response.json({data:{apiVersion:"v1",timelineVersion:1,automaticCaptions:Boolean(process.env.OPENAI_API_KEY),scopes,features:["video-timeline","timed-labels","video-templates","render-jobs","weekly-queues","campaign-operations","idea-inbox","brand-kits","caption-jobs","creative-analytics","posting-time-observations","campaign-recipes"],limits:{clips:50,timelineDurationMs:900000,timedLabels:200,queueSlots:50,bulkPosts:100},renderWorkflow:{enqueue:"POST /api/v1/videos/render with {id,async:true}",poll:"GET /api/v1/videos/jobs?id=…",cancelOrRetry:"PATCH /api/v1/videos/jobs",completion:"Use completed job.renderedUrl in POST /api/v1/posts"}}});
}
