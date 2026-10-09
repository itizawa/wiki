import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { Db } from "./client";
import * as schema from "./schema";

export function createPostgresDb(url: string): { db: Db; close: () => Promise<void> } {
  const sql = postgres(url, { max: 10 });
  return { db: drizzle(sql, { schema }) as unknown as Db, close: () => sql.end() };
}
