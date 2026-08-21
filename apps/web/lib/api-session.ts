import { auth } from "./auth";

export async function requireApiSession(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return { session: null, response: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  return { session, response: null };
}
