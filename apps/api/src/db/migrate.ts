import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import { bootstrapStructure } from "../structure/repo";
import { createPostgresDb } from "./postgres";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");

const { db, close } = createPostgresDb(url);
await migrate(db as any, { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });
await bootstrapStructure(db);
await close();
console.log("migrated");
