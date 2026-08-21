import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { OAuthFlow } from "@relay/providers/oauth";

export const OAUTH_STATE_COOKIE = "relay_oauth_state";
const STATE_TTL_SECONDS = 10 * 60;

interface OAuthStatePayload {
  userId: string;
  brandId: string;
  flow: OAuthFlow;
  nonce: string;
  expiresAt: number;
}

function secret(): string {
  const value = process.env.BETTER_AUTH_SECRET;
  if (!value || value.length < 32) throw new Error("BETTER_AUTH_SECRET must be configured before OAuth can start");
  return value;
}

function signature(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function createOAuthState(userId: string, brandId: string, flow: OAuthFlow): string {
  const payload: OAuthStatePayload = { userId, brandId, flow, nonce: randomBytes(24).toString("base64url"), expiresAt: Math.floor(Date.now() / 1_000) + STATE_TTL_SECONDS };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${signature(encoded)}`;
}

export function verifyOAuthState(token: string, cookieToken: string | undefined, expectedFlow: string, expectedUserId: string): OAuthStatePayload {
  if (!cookieToken || cookieToken !== token) throw new Error("OAuth state cookie did not match");
  const [encoded, receivedSignature] = token.split(".");
  if (!encoded || !receivedSignature) throw new Error("OAuth state was malformed");
  const expectedSignature = signature(encoded);
  const received = Buffer.from(receivedSignature); const expected = Buffer.from(expectedSignature);
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw new Error("OAuth state signature was invalid");
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Partial<OAuthStatePayload>;
  if (!payload.userId || !payload.brandId || !payload.flow || !payload.nonce || !payload.expiresAt) throw new Error("OAuth state payload was incomplete");
  if (payload.userId !== expectedUserId || payload.flow !== expectedFlow) throw new Error("OAuth state context did not match");
  if (payload.expiresAt < Math.floor(Date.now() / 1_000)) throw new Error("OAuth state expired");
  return payload as OAuthStatePayload;
}

export function oauthCookieOptions() {
  const secure = (process.env.APP_URL ?? process.env.BETTER_AUTH_URL ?? "").startsWith("https://");
  return { httpOnly: true, secure, sameSite: "lax" as const, path: "/api/oauth", maxAge: STATE_TTL_SECONDS };
}
