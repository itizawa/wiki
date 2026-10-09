import { createPostgresDb } from "./postgres";
import { resetDatabase, seedDatabase } from "./seed-data";

// テスト用データの投入（ローカル開発専用）。`--reset` を付けると、いまあるデータをすべて消してから入れる。
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
if (process.env.NODE_ENV === "production") throw new Error("db:seed is not available in production");

const reset = process.argv.includes("--reset");
const { db, close } = createPostgresDb(url);
try {
  if (reset) await resetDatabase(db);
  const result = await seedDatabase(db);
  console.log(`seeded ${result.pages} pages${reset ? " (after reset)" : ""}`);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await close();
}
