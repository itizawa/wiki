import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import { adoptUnplacedPages, bootstrapStructure } from "../structure/repo";
import { bootstrapOwners } from "../users/service";
import { createPostgresDb } from "./postgres";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");

// DATABASE_SSL=require なら、接続文字列に sslmode が無くても必ずTLSでつなぐ（デプロイ時に指定する）
const { db, close } = createPostgresDb(url, process.env.DATABASE_SSL === "require" ? { ssl: "require" } : {});
await migrate(db as any, { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });
await bootstrapStructure(db);
await adoptUnplacedPages(db);
// ADMIN_EMAILS からの移行：ユーザーが1人もいないときだけ、そのメールアドレスをオーナーにし、最初の wiki の管理者にする。
// 移行が本番に入ったら、環境変数 ADMIN_EMAILS は消してよい（2回目からは読まない）
const owners = await bootstrapOwners(db, (process.env.ADMIN_EMAILS ?? "").split(","));
if (owners > 0) console.log(`registered ${owners} owners from ADMIN_EMAILS`);
await close();
console.log("migrated");
