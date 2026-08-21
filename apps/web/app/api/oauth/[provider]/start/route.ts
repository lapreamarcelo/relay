import { sql } from "@relay/database";
import { NextResponse } from "next/server";

import { requireApiSession } from "../../../../../lib/api-session";
import { createOAuthState, OAUTH_STATE_COOKIE, oauthCookieOptions } from "../../../../../lib/oauth-state";
import { getOAuthRegistry } from "../../../../../lib/social-oauth";

export async function GET(request: Request, context: { params: Promise<{ provider: string }> }) {
  const authorization = await requireApiSession(request);
  if (authorization.response) return NextResponse.redirect(new URL("/login", process.env.APP_URL ?? request.url));
  const { provider } = await context.params;
  let adapter;
  try { adapter = getOAuthRegistry().get(provider); }
  catch { return Response.json({ error: "Unsupported social provider." }, { status: 404 }); }
  if (!adapter.configured) return Response.json({ error: `${adapter.provider} OAuth credentials are not configured on the server.` }, { status: 503 });

  const brandId = new URL(request.url).searchParams.get("brandId")?.trim() ?? "";
  const [brand] = await sql<{ id: string }[]>`SELECT id FROM "brand" WHERE "id" = ${brandId} AND "owner_id" = ${authorization.session.user.id}`;
  if (!brand) return Response.json({ error: "Choose a brand you own before connecting an account." }, { status: 400 });

  const state = createOAuthState(authorization.session.user.id, brand.id, adapter.flow);
  const response = NextResponse.redirect(adapter.authorizationUrl(state));
  response.cookies.set(OAUTH_STATE_COOKIE, state, oauthCookieOptions());
  return response;
}
