import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { createGoogleOidc } from "./auth/google";
import { loadConfig } from "./config";
import { createPostgresDb } from "./db/postgres";
import { bootstrapStructure } from "./structure/repo";
import { dirImageStore } from "./images/dir";
import { imageTypeOfName } from "@wiki/shared";

const config = loadConfig(process.env);
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const { db } = createPostgresDb(databaseUrl);
await bootstrapStructure(db);

const google = config.google
  ? createGoogleOidc({ ...config.google, redirectUri: config.googleRedirectUri })
  : null;

const port = Number(process.env.PORT ?? 8787);
// 手元の開発では、アップロードした画像をディレクトリに置く（既定は apps/api/.data/images）
const images = dirImageStore(process.env.IMAGES_DIR ?? ".data/images", imageTypeOfName);

serve({ fetch: createApp({ db, config, google, images }).fetch, port }, (info) => {
  console.log(`api listening on http://localhost:${info.port}`);
});
