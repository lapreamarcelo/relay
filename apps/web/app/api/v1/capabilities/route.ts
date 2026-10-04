import { deviceFrameCatalog } from "../../../../lib/device-frame-catalog";
import { videoAnimationCatalog } from "../../../../lib/video-animation-catalog";
import { videoComposerCatalog } from "../../../../lib/video-composition";
import { sql } from "@relay/database";
import { auth } from "../../../../lib/auth";
import { agentApiKeyScopes,hashApiKey,readBearerToken } from "../../../../lib/api-keys";
export const runtime="nodejs";
export async function GET(request:Request){
 let scopes:readonly string[]=agentApiKeyScopes;const token=readBearerToken(request);
 if(token){const [key]=await sql<{scopes:string[]}[]>`SELECT scopes FROM api_key WHERE key_hash=${hashApiKey(token)} AND revoked_at IS NULL`;if(!key)return Response.json({error:"Invalid or revoked API key."},{status:401});scopes=key.scopes;}
 else if(!await auth.api.getSession({headers:request.headers}))return Response.json({error:"Unauthorized"},{status:401});
 const deviceFrames = deviceFrameCatalog();
 const videoAnimations = videoAnimationCatalog();
 const videoComposer = videoComposerCatalog(Boolean(process.env.OPENAI_API_KEY?.trim()));
 if (new URL(request.url).searchParams.get("section") === "video-composer") return Response.json({data:videoComposer});
 if (new URL(request.url).searchParams.get("section") === "video-animation") return Response.json({data:videoAnimations});
 if (new URL(request.url).searchParams.get("section") === "device-frames") return Response.json({data:deviceFrames});
 return Response.json({data:{deviceFrames,videoAnimations,videoComposer,apiVersion:"v1",timelineVersion:1,automaticCaptions:Boolean(process.env.OPENAI_API_KEY),scopes,features:["parallel-device-layers","video-composer","device-frames","device-motion","duo-folding","canvas-backgrounds","video-animations","clip-transitions","animation-keyframes","video-timeline","timed-labels","video-templates","render-jobs","weekly-queues","campaign-operations","idea-inbox","brand-kits","caption-jobs","creative-analytics","posting-time-observations","campaign-recipes"],limits:{clips:50,deviceLayers:12,timelineDurationMs:900000,timedLabels:200,queueSlots:50,bulkPosts:100},renderWorkflow:{enqueue:"POST /api/v1/videos/render with {id,async:true}",poll:"GET /api/v1/videos/jobs?id=…",cancelOrRetry:"PATCH /api/v1/videos/jobs",completion:"Use completed job.renderedUrl in POST /api/v1/posts"}}});
}
