import { notFound } from "next/navigation";

import { demoAccounts, demoBrands, demoPosts } from "../../lib/demo-data";
import RelayApp from "../relay-app";

export const dynamic = "force-dynamic";

export default function DemoPage() {
  if (process.env.RELAY_DEMO_MODE !== "true") notFound();
  return <RelayApp initialBrands={demoBrands} initialAccounts={demoAccounts} initialPosts={demoPosts} initialNow="2026-08-23T11:00:00.000Z" initialView="analytics" user={{ name: "Mara Silva", email: "mara@example.com", role: "OWNER" }} />;
}
