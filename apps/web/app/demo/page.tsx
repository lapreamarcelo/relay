import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { defaultPublishingDefaults } from "@relay/core";

import { demoAccounts, demoBrands, demoPosts } from "../../lib/demo-data";
import RelayApp from "../relay-app";
import { parseRelayView } from "../../lib/app-navigation";

export const dynamic = "force-dynamic";

export default async function DemoPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const requestHeaders = await headers();
  const host = (requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "").split(",")[0].trim().toLowerCase();
  const local = host === "localhost" || host.startsWith("localhost:") || host === "127.0.0.1" || host.startsWith("127.0.0.1:") || host === "[::1]" || host.startsWith("[::1]:");
  if (!local) notFound();
  const query = await searchParams;
  return <RelayApp demoMode initialBrands={demoBrands} initialAccounts={demoAccounts} initialPosts={demoPosts} initialPublishingDefaults={defaultPublishingDefaults} initialNow="2026-08-23T11:00:00.000Z" initialView={query.view ? parseRelayView(query.view) : "analytics"} user={{ name: "Mara Silva", email: "mara@example.com", role: "OWNER" }} />;
}
