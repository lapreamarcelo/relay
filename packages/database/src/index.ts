import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { schema } from "./schema";

const connectionString = process.env.DATABASE_URL ?? "postgresql://relay:relay@localhost:5432/relay";

export const sql = postgres(connectionString, {
  max: Number(process.env.DATABASE_POOL_SIZE ?? 5),
  prepare: false,
});

export const db = drizzle(sql, { schema });
export * from "./schema";
