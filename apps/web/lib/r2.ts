import "server-only";

import { S3Client } from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { isIP } from "node:net";
import https from "node:https";

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  region: string;
  endpoint: string;
  publicUrl: string;
  resolvedIp?: string;
}

let client: S3Client | undefined;
let cachedConfig: R2Config | undefined;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for Cloudflare R2 media storage`);
  return value;
}

export function getR2Config(): R2Config {
  if (cachedConfig) return cachedConfig;

  const accountId = required("R2_ACCOUNT_ID");
  const resolvedIp = process.env.R2_RESOLVED_IP?.trim() || undefined;
  if (resolvedIp && !isIP(resolvedIp)) throw new Error("R2_RESOLVED_IP must be a valid IPv4 or IPv6 address");

  cachedConfig = {
    accountId,
    accessKeyId: required("R2_ACCESS_KEY_ID"),
    secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
    bucket: required("R2_BUCKET_NAME"),
    region: process.env.R2_REGION?.trim() || "auto",
    endpoint: process.env.R2_ENDPOINT?.trim() || `https://${accountId}.r2.cloudflarestorage.com`,
    publicUrl: required("R2_PUBLIC_URL").replace(/\/$/, ""),
    resolvedIp,
  };
  return cachedConfig;
}

export function getR2Client(): S3Client {
  if (client) return client;
  const config = getR2Config();
  const httpsAgent = config.resolvedIp
    ? new https.Agent({
        lookup: (_hostname, options, callback) => {
          const family = isIP(config.resolvedIp!) as 4 | 6;
          if (options.all) callback(null, [{ address: config.resolvedIp!, family }]);
          else callback(null, config.resolvedIp!, family);
        },
      })
    : undefined;
  client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: Boolean(config.resolvedIp),
    maxAttempts: 2,
    requestHandler: new NodeHttpHandler({
      connectionTimeout: 5_000,
      requestTimeout: 20_000,
      ...(httpsAgent ? { httpsAgent } : {}),
    }),
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
  return client;
}

export function publicObjectUrl(key: string): string {
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  return `${getR2Config().publicUrl}/${encodedKey}`;
}
