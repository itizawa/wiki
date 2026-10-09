import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { createApp } from "../app";
import type { GoogleOidc } from "../auth/google";
import { SESSION_COOKIE, signSession } from "../auth/session";
import type { AppConfig } from "../config";
import type { Db } from "../db/client";
import * as schema from "../db/schema";
import { bootstrapStructure } from "../structure/repo";

export const ADMIN = "admin@example.com";

export const testConfig: AppConfig = {
  adminEmails: [ADMIN],
  sessionSecret: "test-secret-test-secret-test-secret!!",
  adminOrigin: "http://admin.test",
  googleRedirectUri: "http://admin.test/api/auth/google/callback",
  google: null,
  secureCookies: false,
  siteOrigin: "http://site.test",
  internalToken: "internal-token",
};

export async function setup(opts: { google?: GoogleOidc; config?: Partial<AppConfig> } = {}) {
  const client = new PGlite();
  const db = drizzle(client, { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });
  await bootstrapStructure(db);
  const config = { ...testConfig, ...opts.config };
  const app = createApp({ db, config, google: opts.google ?? null });
  const cookie = `${SESSION_COOKIE}=${await signSession(config.sessionSecret, ADMIN)}`;

  async function call<T = any>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await app.request(path, {
      method,
      headers: {
        cookie,
        origin: config.adminOrigin,
        ...(body !== undefined && { "content-type": "application/json" }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T, headers: res.headers };
  }

  return { app, db, client, config, call, close: () => client.close() };
}

/** 複数ツリー時代のデータを再現する：primary以外のツリーを現在のheadコミットに直接足す。 */
export async function addLegacyTree(client: PGlite, key = "by-theme") {
  const id = `t_${key}`;
  await client.query(`insert into trees (id, key, name, is_public, is_primary) values ($1, $2, $3, true, false)`, [id, key, key]);
  const snap = await client.query<{ id: string }>(`insert into tree_snapshots (tree_id) values ($1) returning id`, [id]);
  await client.query(
    `insert into commit_trees (commit_id, tree_id, snapshot_id)
     select head_commit_id, $1, $2 from structure_branches where name = 'main'`,
    [id, snap.rows[0]!.id],
  );
  return id;
}
