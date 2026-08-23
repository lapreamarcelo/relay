import { AesGcmTokenCipher } from "@relay/core/token-encryption";
import { sql } from "@relay/database";
import { createProviderRefreshRegistry } from "@relay/providers/refresh-registry";
import { ProviderPublishRegistry } from "@relay/providers/publish";
import { ProviderAnalyticsRegistry } from "@relay/providers/analytics";
import type { OAuthEnvironment } from "@relay/providers/oauth";
import { PostgresAccountCredentialRepository } from "./postgres-account-credential-repository.ts";
import { TokenLifecycleService } from "./token-lifecycle.ts";
import { runTokenMaintenanceLoop } from "./token-maintenance-loop.ts";
import { PostPublishingService } from "./post-publishing.ts";
import { runPublishingLoop } from "./publishing-loop.ts";
import { PostAnalyticsService } from "./post-analytics.ts";
import { runAnalyticsLoop } from "./analytics-loop.ts";

const encryptionKey = process.env.ENCRYPTION_KEY;
if (!encryptionKey) throw new Error("ENCRYPTION_KEY is required by the Relay worker");
const appUrl = process.env.APP_URL ?? "http://localhost:3000";
const abortController = new AbortController();
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => abortController.abort());

const lifecycle = new TokenLifecycleService(
  new PostgresAccountCredentialRepository(),
  AesGcmTokenCipher.fromBase64Key(encryptionKey),
  createProviderRefreshRegistry(process.env as OAuthEnvironment, appUrl),
  { workerId: process.env.HOSTNAME ? `worker-${process.env.HOSTNAME}` : undefined },
);

try {
  await Promise.all([
    runTokenMaintenanceLoop(lifecycle, { intervalMs: Number(process.env.TOKEN_REFRESH_INTERVAL_MS ?? 300_000), signal: abortController.signal }),
    runPublishingLoop(new PostPublishingService(lifecycle, new ProviderPublishRegistry(), process.env.HOSTNAME ? `publisher-${process.env.HOSTNAME}` : undefined), { intervalMs: Number(process.env.PUBLISH_INTERVAL_MS ?? 5_000), signal: abortController.signal }),
    runAnalyticsLoop(new PostAnalyticsService(lifecycle, new ProviderAnalyticsRegistry(), process.env.HOSTNAME ? `analytics-${process.env.HOSTNAME}` : undefined), { intervalMs: Number(process.env.ANALYTICS_INTERVAL_MS ?? 60_000), signal: abortController.signal }),
  ]);
} finally {
  await sql.end();
}
