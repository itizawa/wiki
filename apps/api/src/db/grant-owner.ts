import { ensureOwnerByEmail } from "../users/service";
import { createPostgresDb } from "./postgres";

// 締め出されたとき（オーナー全員がログインできなくなった等）に、DB に直接つないでオーナーを付ける。
// DATABASE_URL を持つ人だけが実行できる：pnpm db:grant-owner you@example.com
// 同じメールアドレスのユーザーがいればオーナーにし、いなければメールアドレスだけの行を作る（最初の Google ログインで結びつく）。
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const email = process.argv.slice(2).find((a) => !a.startsWith("-"));
if (!email || !email.includes("@")) {
  console.error("usage: pnpm db:grant-owner <email>");
  process.exit(1);
}

const { db, close } = createPostgresDb(url, process.env.DATABASE_SSL === "require" ? { ssl: "require" } : {});
try {
  const user = await ensureOwnerByEmail(db, email);
  console.log(`${user.email} is now an owner${user.googleSub ? "" : " (linked on the first Google login)"}`);
} finally {
  await close();
}
