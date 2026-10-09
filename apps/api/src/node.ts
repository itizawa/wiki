import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { createGoogleOidc } from "./auth/google";
import { loadConfig } from "./config";
import { createPostgresDb } from "./db/postgres";
import { bootstrapStructure } from "./structure/repo";

const config = loadConfig(process.env);
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const { db } = createPostgresDb(databaseUrl);
await bootstrapStructure(db);

const google = config.google
  ? createGoogleOidc({ ...config.google, redirectUri: config.googleRedirectUri })
  : null;

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: createApp({ db, config, google }).fetch, port }, (info) => {
  console.log(`api listening on http://localhost:${info.port}`);
});
