import { createHash, randomBytes } from "node:crypto";

export const agentApiKeyScopes = ["posts:read", "posts:write", "accounts:read", "brands:read", "media:read", "media:write", "analytics:read", "analytics:write", "slideshows:read", "slideshows:write", "videos:read", "videos:write"] as const;
export type AgentApiKeyScope = (typeof agentApiKeyScopes)[number];

export function hashApiKey(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function createApiKeySecret(): { secret: string; prefix: string; hash: string } {
  const secret = `relay_sk_${randomBytes(32).toString("base64url")}`;
  return { secret, prefix: `${secret.slice(0, 17)}…`, hash: hashApiKey(secret) };
}

export function readBearerToken(request: Request): string | null {
  const value = request.headers.get("authorization");
  if (!value) return null;
  const match = /^Bearer\s+(relay_sk_[A-Za-z0-9_-]+)$/i.exec(value.trim());
  return match?.[1] ?? null;
}
