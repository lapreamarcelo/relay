import { sql } from "@relay/database";

import { requireApiSession } from "../../../../lib/api-session";

export async function DELETE(request: Request) {
  const authorization = await requireApiSession(request);
  if (authorization.response) return authorization.response;

  const body = await request.json().catch(() => null) as { confirmation?: unknown } | null;
  const confirmation = typeof body?.confirmation === "string" ? body.confirmation.trim().toLowerCase() : "";
  const email = authorization.session.user.email.trim().toLowerCase();
  if (!confirmation || confirmation !== email) {
    return Response.json({ error: "Enter your account email exactly to confirm deletion." }, { status: 400 });
  }

  const deleted = await sql.begin(async (tx) => {
    // Verification records are keyed by identifier rather than a foreign key.
    await tx`DELETE FROM "verification" WHERE LOWER("identifier") = ${email}`;
    const [user] = await tx<{ id: string }[]>`
      DELETE FROM "user"
      WHERE "id" = ${authorization.session.user.id} AND LOWER("email") = ${email}
      RETURNING "id"
    `;
    return user;
  });

  if (!deleted) return Response.json({ error: "Account not found." }, { status: 404 });
  return Response.json({ data: { deleted: true } });
}
