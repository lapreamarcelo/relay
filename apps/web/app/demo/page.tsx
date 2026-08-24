import { notFound } from "next/navigation";

import { demoAccounts, demoBrands, demoPosts } from "../../lib/demo-data";
import RelayApp from "../relay-app";
import { parseRelayView } from "../../lib/app-navigation";

export const dynamic = "force-dynamic";

export default async function DemoPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  if (process.env.RELAY_DEMO_MODE !== "true") notFound();
  const query = await searchParams;
  return <RelayApp initialBrands={demoBrands} initialAccounts={demoAccounts} initialPosts={demoPosts} initialNow="2026-08-23T11:00:00.000Z" initialView={query.view ? parseRelayView(query.view) : "analytics"} user={{ name: "Mara Silva", email: "mara@example.com", role: "OWNER" }} />;
}
