import "server-only";

import { S3Client } from "@aws-sdk/client-s3";

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  region: string;
  endpoint: string;
  publicUrl: string;
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
  cachedConfig = {
    accountId,
    accessKeyId: required("R2_ACCESS_KEY_ID"),
    secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
    bucket: required("R2_BUCKET_NAME"),
    region: process.env.R2_REGION?.trim() || "auto",
    endpoint: process.env.R2_ENDPOINT?.trim() || `https://${accountId}.r2.cloudflarestorage.com`,
    publicUrl: required("R2_PUBLIC_URL").replace(/\/$/, ""),
  };
  return cachedConfig;
}

export function getR2Client(): S3Client {
  if (client) return client;
  const config = getR2Config();
  client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
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
