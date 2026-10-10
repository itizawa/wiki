import { grantOwnerByEmail } from "../users/service";
import { createPostgresDb } from "./postgres";

// 締め出されたとき用（オーナー全員がログインできなくなった等）。DB に直接つないで、メールアドレスのユーザーをオーナーにする。
// まだ登録されていなければメールアドレスだけの行を作り、その Google アカウントで最初にログインしたときに結びつく。
// 使い方：DATABASE_URL=... pnpm --filter @wiki/api owner:grant someone@example.com
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const email = process.argv[2];
if (!email || !email.includes("@")) throw new Error("usage: owner:grant <email>");

const { db, close } = createPostgresDb(url, process.env.DATABASE_SSL === "require" ? { ssl: "require" } : {});
try {
  const user = await grantOwnerByEmail(db, email);
  console.log(`${user.email} is now an owner (user ${user.id})`);
} finally {
  await close();
}
