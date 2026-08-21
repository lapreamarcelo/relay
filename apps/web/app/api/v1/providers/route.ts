import { providerRegistry } from "@relay/providers";
import { requireApiSession } from "../../../../lib/api-session";

export async function GET(request: Request) {
  const authorization = await requireApiSession(request);
  if (authorization.response) return authorization.response;
  return Response.json({ data: providerRegistry.list() });
}
