import { sql } from "@relay/database";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "../lib/auth";
import RelayApp from "./relay-app";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function HomePage() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) redirect("/login");

  const brandRows = await sql<{ id: string; name: string; monogram: string; color: string; timezone: string }[]>`
    SELECT id, name, monogram, color, timezone FROM "brand" WHERE "owner_id" = ${session.user.id} ORDER BY "created_at" ASC
  `;
  const brands = brandRows.map((brand) => ({ id: brand.id, name: brand.name, monogram: brand.monogram, color: brand.color, timezone: brand.timezone }));

  return <RelayApp initialBrands={brands} user={{ name: session.user.name, email: session.user.email, role: session.user.role ?? "MEMBER" }} />;
}
