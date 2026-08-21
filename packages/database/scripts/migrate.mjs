import { readdir, readFile } from "node:fs/promises";

import postgres from "postgres";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required to migrate Relay");

const client = postgres(connectionString, { max: 1, prepare: false });
const migrationDirectory = new URL("../drizzle/", import.meta.url);

try {
  const migrations = (await readdir(migrationDirectory)).filter((name) => name.endsWith(".sql")).sort();
  for (const migration of migrations) await client.unsafe(await readFile(new URL(migration, migrationDirectory), "utf8"));
  console.info("Relay database is ready.");
} finally {
  await client.end();
}
