import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { Db } from "./client";
import * as schema from "./schema";

export function createPostgresDb(
  url: string,
  options: { max?: number; fetch_types?: boolean; ssl?: "require" } = {},
): { db: Db; close: () => Promise<void> } {
  const sql = postgres(url, { max: 10, ...options });
  return { db: drizzle(sql, { schema }) as unknown as Db, close: () => sql.end() };
}
