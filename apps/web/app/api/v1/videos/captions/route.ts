import { requireApiSession } from "../../../../../lib/api-session";
import { enqueueRender } from "../../../../../lib/render-jobs";
export const runtime="nodejs";
export async function POST(request:Request){const auth=await requireApiSession(request,{apiKeyScope:"videos:write"});if(auth.response)return auth.response;if(!process.env.OPENAI_API_KEY)return Response.json({error:"Automatic captions require OPENAI_API_KEY on the web and render services."},{status:503});try{const body=await request.json();if(typeof body.id!=="string")throw new Error("Project id required.");return Response.json(await enqueueRender(auth.session.user.id,body.id,"captions"),{status:202});}catch(e){return Response.json({error:(e as Error).message},{status:400});}}
