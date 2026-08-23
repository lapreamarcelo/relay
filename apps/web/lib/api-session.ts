import { sql } from "@relay/database";

import { auth } from "./auth";
import { hashApiKey, readBearerToken, type AgentApiKeyScope } from "./api-keys";

interface ApiKeyRow { id: string; owner_id: string; scopes: string[] }
type BrowserSession = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;
type AuthorizationResult<T> = { session: T; response: null } | { session: null; response: Response };

export function requireApiSession(request: Request): Promise<AuthorizationResult<BrowserSession>>;
export function requireApiSession(request: Request, options: { apiKeyScope: AgentApiKeyScope }): Promise<AuthorizationResult<{ user: { id: string } }>>;
export async function requireApiSession(request: Request, options: { apiKeyScope?: AgentApiKeyScope } = {}) {
  const token = readBearerToken(request);
  if (token) {
    if (!options.apiKeyScope) return { session: null, response: Response.json({ error: "API keys cannot perform this operation." }, { status: 403 }) };
    const [key] = await sql<ApiKeyRow[]>`
      SELECT id, owner_id, scopes FROM "api_key"
      WHERE key_hash = ${hashApiKey(token)} AND revoked_at IS NULL
    `;
    if (!key) return { session: null, response: Response.json({ error: "Invalid or revoked API key." }, { status: 401 }) };
    if (!key.scopes.includes(options.apiKeyScope)) return { session: null, response: Response.json({ error: `API key is missing the ${options.apiKeyScope} scope.` }, { status: 403 }) };
    await sql`UPDATE "api_key" SET last_used_at = NOW() WHERE id = ${key.id} AND (last_used_at IS NULL OR last_used_at < NOW() - INTERVAL '5 minutes')`;
    return { session: { user: { id: key.owner_id } }, response: null };
  }
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return { session: null, response: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  return { session, response: null };
}
