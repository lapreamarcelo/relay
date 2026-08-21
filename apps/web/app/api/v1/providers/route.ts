import { providerRegistry } from "@relay/providers";
import { requireApiSession } from "../../../../lib/api-session";
import { getOAuthRegistry } from "../../../../lib/social-oauth";

export async function GET(request: Request) {
  const authorization = await requireApiSession(request);
  if (authorization.response) return authorization.response;
  const oauth = getOAuthRegistry();
  return Response.json({ data: providerRegistry.list().map((provider) => ({
    ...provider,
    configured: oauth.list().some((adapter) => adapter.provider === provider.id && adapter.configured),
    connectionOptions: oauth.list().filter((adapter) => adapter.provider === provider.id).map((adapter) => ({ flow: adapter.flow, configured: adapter.configured, callbackUrl: adapter.callbackUrl })),
  })) });
}
